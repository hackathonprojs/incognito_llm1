import { NextRequest, NextResponse } from 'next/server';
import { google } from '@ai-sdk/google';
import { streamText, convertToCoreMessages, UIMessage } from 'ai';

// --- Monad Testnet Configuration ---
const MONAD_TESTNET_RPC = 'https://testnet-rpc.monad.xyz';
const MONAD_TESTNET_CHAIN_ID = 10143;

// Price per query in Monad's native token (MON)
const QUERY_PRICE_MON = '0.001';
const QUERY_PRICE_WEI = BigInt('1000000000000000'); // 0.001 * 10^18

// Verify a transaction on Monad testnet
async function verifyPayment(txHash: string, expectedRecipient: string): Promise<boolean> {
    try {
        console.log('🔍 Verifying payment tx:', txHash);

        // Fetch transaction receipt from Monad RPC
        const response = await fetch(MONAD_TESTNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getTransactionReceipt',
                params: [txHash],
                id: 1,
            }),
        });

        const data = await response.json();
        const receipt = data.result;

        if (!receipt) {
            console.log('❌ Transaction receipt not found');
            return false;
        }

        // Check if transaction was successful
        if (receipt.status !== '0x1') {
            console.log('❌ Transaction failed');
            return false;
        }

        // Fetch the actual transaction to check value and recipient
        const txResponse = await fetch(MONAD_TESTNET_RPC, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'eth_getTransactionByHash',
                params: [txHash],
                id: 2,
            }),
        });

        const txData = await txResponse.json();
        const tx = txData.result;

        if (!tx) {
            console.log('❌ Transaction not found');
            return false;
        }

        // Verify recipient (case-insensitive comparison)
        const txTo = tx.to?.toLowerCase();
        const expected = expectedRecipient.toLowerCase();

        if (txTo !== expected) {
            console.log(`❌ Wrong recipient. Expected: ${expected}, Got: ${txTo}`);
            return false;
        }

        // Verify payment amount (at least the required amount)
        const txValue = BigInt(tx.value || '0');
        if (txValue < QUERY_PRICE_WEI) {
            console.log(`❌ Insufficient payment. Required: ${QUERY_PRICE_WEI}, Got: ${txValue}`);
            return false;
        }

        console.log('✅ Payment verified successfully!');
        return true;

    } catch (error) {
        console.error('Payment verification error:', error);
        return false;
    }
}

export async function POST(request: NextRequest) {
    try {
        const paymentData = request.headers.get('x-payment');
        const serverWallet = process.env.SERVER_WALLET;

        if (!serverWallet) {
            console.error('SERVER_WALLET not configured');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        // If no payment provided, return 402 with payment requirements
        if (!paymentData) {
            return new NextResponse(
                JSON.stringify({
                    x402Version: 1,
                    error: 'X-PAYMENT header is required',
                    accepts: [{
                        scheme: 'exact',
                        network: `eip155:${MONAD_TESTNET_CHAIN_ID}`,
                        maxAmountRequired: QUERY_PRICE_WEI.toString(),
                        resource: `${process.env.NEXT_PUBLIC_APP_URL}/api/chat`,
                        description: 'AI Query Payment',
                        mimeType: 'application/json',
                        payTo: serverWallet,
                        maxTimeoutSeconds: 86400,
                        asset: 'native', // Native MON token
                        outputSchema: { input: { type: 'http', method: 'POST', discoverable: true } },
                        extra: {
                            recipientAddress: serverWallet,
                            name: 'MON',
                            symbol: 'MON',
                            decimals: 18,
                            priceFormatted: QUERY_PRICE_MON + ' MON',
                        },
                    }],
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Verify the payment on-chain
        const isValid = await verifyPayment(paymentData, serverWallet);

        if (!isValid) {
            return new NextResponse(
                JSON.stringify({
                    x402Version: 1,
                    error: 'Payment verification failed. Please ensure the transaction is confirmed on Monad testnet.',
                }),
                {
                    status: 402,
                    headers: { 'Content-Type': 'application/json' },
                }
            );
        }

        // Payment successful - process the LLM request
        const body = await request.json();
        console.log('📥 Chat Request Body:', JSON.stringify(body, null, 2));

        const { messages = [], model } = body;

        // Select model based on user choice
        const selectedModel = getGoogleModel(model);

        // Ensure messages is an array
        if (!Array.isArray(messages)) {
            throw new Error('Messages must be an array');
        }

        const coreMessages = messages.map((msg: any) => ({
            role: msg.role as 'user' | 'assistant' | 'system',
            content: msg.content
        }));

        const result = streamText({
            model: selectedModel,
            messages: coreMessages,
            system: 'You are a helpful AI assistant. Provide clear, accurate, and concise responses.',
        });

        // Return streaming response with payment receipt
        const response = result.toTextStreamResponse();
        response.headers.set('X-Payment-Receipt', JSON.stringify({ txHash: paymentData, verified: true }));

        return response;

    } catch (error: any) {
        console.error('Chat API error:', error);
        return NextResponse.json(
            { error: error?.message || 'Internal server error', details: JSON.stringify(error, Object.getOwnPropertyNames(error)) },
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

