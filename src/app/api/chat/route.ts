import { NextRequest, NextResponse } from 'next/server';
import { createThirdwebClient } from 'thirdweb';
import { facilitator, settlePayment } from 'thirdweb/x402';
import { defineChain } from 'thirdweb/chains';
import { google } from '@ai-sdk/google';
import { streamText, convertToCoreMessages, UIMessage } from 'ai';

// --- Monad Testnet Configuration ---
// Note: We define the chain here explicitly for server-side usage.
const monadTestnet = defineChain({
    id: 10143,
    name: 'Monad Testnet',
    nativeCurrency: {
        name: 'MON',
        symbol: 'MON',
        decimals: 18,
    },
    rpcUrls: {
        default: { http: ['https://testnet-rpc.monad.xyz'] },
        public: { http: ['https://testnet-rpc.monad.xyz'] },
    },
    blockExplorers: {
        default: { name: 'Monad Explorer', url: 'https://testnet.monadexplorer.com' },
    },
    testnet: true,
});

const client = createThirdwebClient({
    secretKey: process.env.SECRET_KEY!
});

const thirdwebFacilitator = facilitator({
    client,
    serverWalletAddress: process.env.SERVER_WALLET!,
});

// Price per query in Monad's native token (MON) - Using MON as payment per user request
// Set a small price, e.g., 0.001 MON
const QUERY_PRICE_MON = '0.001';

export async function POST(request: NextRequest) {
    try {
        const paymentData = request.headers.get('x-payment');

        // Settle x402 payment
        const paymentResult = await settlePayment({
            resourceUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/chat`,
            method: 'POST',
            paymentData,
            network: monadTestnet,
            // Use 'price' for the cost in native currency
            price: QUERY_PRICE_MON,
            // Explicitly set payToken to null for native currency payments
            payTo: process.env.SERVER_WALLET!,
            facilitator: thirdwebFacilitator,
        });

        // If payment not settled, return 402 Payment Required
        if (paymentResult.status !== 200) {
            return new NextResponse(
                JSON.stringify(paymentResult.responseBody),
                {
                    status: paymentResult.status,
                    headers: {
                        'Content-Type': 'application/json',
                        ...(paymentResult.responseHeaders || {}),
                    },
                }
            );
        }

        // Payment successful - process the LLM request
        const { messages, model } = await request.json();

        // Select model based on user choice
        const selectedModel = getGoogleModel(model);

        const result = streamText({
            model: selectedModel,
            messages: convertToCoreMessages(messages as UIMessage[]),
            system: 'You are a helpful AI assistant. Provide clear, accurate, and concise responses.',
        });

        // Return streaming response with payment receipt
        const response = result.toDataStreamResponse();
        // Payment receipt contains the transaction hash
        response.headers.set('X-Payment-Receipt', JSON.stringify(paymentResult.paymentReceipt));

        return response;

    } catch (error) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: 'Internal server error' },
            { status: 500 }
        );
    }
}

function getGoogleModel(modelId: string) {
    const models: Record<string, ReturnType<typeof google>> = {
        'gemini-2.5-flash': google('gemini-2.5-flash'),
        'gemini-2.0-flash': google('gemini-2.0-flash'),
        'gemini-1.5-pro': google('gemini-1.5-pro'),
    };
    return models[modelId] || google('gemini-2.5-flash');
}
