'use client';

import { useState, useCallback } from 'react';
import Web3 from 'web3';
import { Search, Wallet as WalletIcon, Zap, ChevronDown, X } from 'lucide-react';

const MONAD_TESTNET_CHAIN_ID = 10143;
const MONAD_TESTNET_RPC = 'https://testnet-rpc.monad.xyz';
const MONAD_EXPLORER_URL = 'https://testnet.monadexplorer.com';

// Server Wallet Address - MUST match the server's configured wallet
// In a real app, this might be fetched from an API or config
const SERVER_WALLET_ADDRESS = "0xYourReceivingWalletAddress"; // Placeholder, will rely on user env if possible, but hardcoded for now as it needs to be public

const AVAILABLE_MODELS = [
  { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', description: 'Fast & efficient' },
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', description: 'Balanced performance' },
  { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', description: 'Most capable' },
];

// Toast notification interface
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  message: string;
  details?: string;
}

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [web3, setWeb3] = useState<Web3 | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [paymentStatus, setPaymentStatus] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Toast helper functions
  const addToast = useCallback((type: Toast['type'], message: string, details?: string) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev, { id, type, message, details }]);
    // Auto-remove after 30 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 30000);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // Connect wallet using Web3.js
  const connectWallet = async () => {
    setIsConnecting(true);
    if (typeof window !== 'undefined' && (window as any).ethereum) {
      try {
        const web3Instance = new Web3((window as any).ethereum);
        await (window as any).ethereum.request({ method: 'eth_requestAccounts' });
        const accounts = await web3Instance.eth.getAccounts();

        // Switch to Monad Testnet
        try {
          await (window as any).ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: `0x${MONAD_TESTNET_CHAIN_ID.toString(16)}` }],
          });
        } catch (switchError: any) {
          // This error code indicates that the chain has not been added to MetaMask.
          if (switchError.code === 4902) {
            await (window as any).ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: `0x${MONAD_TESTNET_CHAIN_ID.toString(16)}`,
                  chainName: 'Monad Testnet',
                  nativeCurrency: {
                    name: 'MON',
                    symbol: 'MON',
                    decimals: 18,
                  },
                  rpcUrls: [MONAD_TESTNET_RPC],
                  blockExplorerUrls: [MONAD_EXPLORER_URL],
                },
              ],
            });
          } else {
            throw switchError;
          }
        }

        setWeb3(web3Instance);
        setAccount(accounts[0]);
      } catch (error) {
        console.error("Connection failed", error);
        alert("Failed to connect wallet.");
      } finally {
        setIsConnecting(false);
      }
    } else {
      alert("Please install MetaMask!");
      setIsConnecting(false);
    }
  };

  // Manage input state manually (required in AI SDK v5)
  const [inputValue, setInputValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual message management instead of useChat (for better x402 control)
  const [messages, setMessages] = useState<Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
  }>>([]);

  const isLoading = isSubmitting;

  // Custom submit handler with logging
  const handleFormSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    console.log('🔍 Search button clicked!', {
      input: inputValue,
      model: selectedModel,
      account,
      timestamp: new Date().toISOString(),
    });

    setIsSubmitting(true);
    const currentInput = inputValue;
    setInputValue(''); // Clear input immediately

    try {
      // First, check if payment is required by making a preflight request
      if (web3 && account) {
        console.log('🔍 Checking if payment is required...');

        const preflightResponse = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', parts: [{ type: 'text', text: currentInput }] }],
            model: selectedModel
          }),
        });

        // If 402, handle payment flow
        if (preflightResponse.status === 402) {
          console.log('💳 Payment required! Starting x402 flow...');
          setPaymentStatus('pending');
          addToast('info', 'Payment Required', 'Please confirm the transaction in MetaMask...');

          const paymentInfo = await preflightResponse.json();
          console.log('📋 x402 Payment Info:', paymentInfo);

          // Extract payment details
          const accepts = paymentInfo.accepts || [];
          const paymentOption = accepts[0];

          if (!paymentOption) {
            throw new Error('No payment options available');
          }

          const payTo = paymentOption.payTo;
          console.log('💰 Payment to:', payTo);

          addToast('warning', 'Confirm in MetaMask', `Sending 0.001 MON to ${payTo?.slice(0, 10)}...`);

          // Send the native MON transaction via MetaMask
          const paymentAmount = web3.utils.toWei('0.001', 'ether');

          const txHash = await new Promise<string>((resolve, reject) => {
            console.log('📤 Sending transaction...');
            web3.eth.sendTransaction({
              from: account,
              to: payTo,
              value: paymentAmount
            })
              .on('transactionHash', (hash) => {
                console.log('📝 Transaction Hash:', hash);
                addToast('info', 'Transaction Submitted', `Tx: ${hash.slice(0, 20)}...`);
              })
              .on('receipt', (receipt) => {
                console.log('✅ Transaction confirmed:', receipt);
                resolve(receipt.transactionHash.toString());
              })
              .on('error', (error: any) => {
                console.error('❌ Transaction failed:', error);
                reject(error);
              });
          });

          setLastTxHash(txHash);
          setPaymentStatus('success');
          addToast('success', 'Payment Confirmed!', `Now fetching AI response...`);

          // Store txHash for the fetch request
          localStorage.setItem('x402_payment_hash', txHash);
        }
      }

      // Add user message to state
      const userMessageId = Date.now().toString();
      setMessages(prev => [...prev, {
        id: userMessageId,
        role: 'user',
        content: currentInput
      }]);

      // Make the actual chat request
      const storedPaymentHash = localStorage.getItem('x402_payment_hash');
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (storedPaymentHash) {
        headers['x-payment'] = storedPaymentHash;
        localStorage.removeItem('x402_payment_hash');
        console.log('📎 Attaching x-payment header:', storedPaymentHash);
      }

      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          messages: [...messages, { role: 'user', content: currentInput }],
          model: selectedModel
        }),
      });

      if (!chatResponse.ok) {
        const errorText = await chatResponse.text();
        throw new Error(`Chat request failed: ${chatResponse.status} - ${errorText}`);
      }

      // Create assistant message placeholder
      const assistantMessageId = (Date.now() + 1).toString();
      setMessages(prev => [...prev, {
        id: assistantMessageId,
        role: 'assistant',
        content: ''
      }]);

      // Handle streaming response
      const reader = chatResponse.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          // Parse the streaming data - AI SDK sends data in a specific format
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('0:')) {
              // Text chunk from AI SDK format
              try {
                const textContent = JSON.parse(line.slice(2));
                fullContent += textContent;

                // Update the assistant message with accumulated content
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: fullContent }
                    : msg
                ));
              } catch {
                // Not valid JSON, might be raw text
                fullContent += line.slice(2);
                setMessages(prev => prev.map(msg =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: fullContent }
                    : msg
                ));
              }
            }
          }
        }
      }

      console.log('✅ Chat completed. Full response:', fullContent);
      addToast('success', 'Response Received', 'AI response generated successfully!');
      setIsSubmitting(false);

    } catch (error: any) {
      console.error('Failed to send message:', error);
      setInputValue(currentInput); // Restore input on error
      setIsSubmitting(false);

      const errorMessage = error?.message || 'Unknown error';
      if (errorMessage.includes('User denied') || errorMessage.includes('rejected')) {
        addToast('warning', 'Transaction Cancelled', 'You rejected the transaction.');
      } else {
        addToast('error', 'Error', errorMessage);
      }
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] text-white font-sans selection:bg-[#20b8cd] selection:text-white">
      {/* Header */}
      <header className="border-b border-[#3a3a3a] px-6 py-4 sticky top-0 bg-[#1a1a1a]/80 backdrop-blur-md z-10 transition-all duration-300">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-6 h-6 text-[#20b8cd] animate-pulse" />
            <span className="text-xl font-semibold tracking-tight">AI Search</span>
            <span className="text-xs bg-[#20b8cd]/20 text-[#20b8cd] px-2 py-0.5 rounded border border-[#20b8cd]/30">
              x402 Powered
            </span>
          </div>

          {/* Model Selector and Wallet Connection */}
          <div className="flex items-center gap-4">
            <div className="relative group">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="appearance-none bg-[#242424] border border-[#3a3a3a] rounded-lg px-4 py-2 pr-8 text-sm focus:outline-none focus:border-[#20b8cd] transition-colors cursor-pointer hover:border-[#555]"
              >
                {AVAILABLE_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none group-hover:text-white transition-colors" />
            </div>

            {/* Wallet Connection */}
            {account ? (
              <div className="flex items-center gap-2 bg-[#242424] px-3 py-2 rounded-lg border border-[#3a3a3a]">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-sm text-gray-300 font-medium">
                  {account.slice(0, 6)}...{account.slice(-4)}
                </span>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={isConnecting}
                className="flex items-center gap-2 bg-[#20b8cd] hover:bg-[#1aa3b6] px-4 py-2 rounded-lg font-medium transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:hover:scale-100 shadow-[0_0_15px_rgba(32,184,205,0.3)] hover:shadow-[0_0_20px_rgba(32,184,205,0.5)] text-black"
              >
                <WalletIcon className="w-4 h-4" />
                {isConnecting ? 'Connecting...' : 'Connect Wallet (Web3)'}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Chat Area */}
      <main className="max-w-4xl mx-auto px-6 py-8 pb-32">
        {/* Payment Status Banner */}
        {paymentStatus !== 'idle' && (
          <div className={`mb-6 p-4 rounded-lg text-sm flex items-center gap-3 animate-in fade-in slide-in-from-top-2 duration-300 border ${paymentStatus === 'pending' ? 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' :
            paymentStatus === 'success' ? 'bg-green-500/10 text-green-300 border-green-500/20' :
              'bg-red-500/10 text-red-300 border-red-500/20'
            }`}>
            {paymentStatus === 'pending' && <span className="animate-spin">⏳</span>}
            {paymentStatus === 'success' && <span>✓</span>}
            {paymentStatus === 'error' && <span>✗</span>}

            <div className="flex-1">
              {paymentStatus === 'pending' && 'Processing payment (0.001 MON)...'}
              {paymentStatus === 'success' && (
                <span>
                  Payment successful!
                  {lastTxHash && (
                    <a
                      href={`https://testnet.monadexplorer.com/tx/${lastTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline ml-2 hover:text-white transition-colors"
                    >
                      View transaction
                    </a>
                  )}
                </span>
              )}
              {paymentStatus === 'error' && 'Payment failed. Please ensure you have enough MON testnet tokens for payment and gas.'}
            </div>
          </div>
        )}

        {/* Empty State */}
        {messages.length === 0 && (
          <div className="text-center py-20 animate-in zoom-in-95 duration-500 fade-in">
            <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-white to-gray-500 bg-clip-text text-transparent">
              What do you want to know?
            </h1>
            <p className="text-gray-400 mb-2 text-lg">
              Pay <span className="text-[#20b8cd] font-semibold">0.001 MON</span> per query on Monad Testnet
            </p>
            <p className="text-sm text-gray-500">
              Connect your wallet to start searching
            </p>
          </div>
        )}

        {/* Messages */}
        <div className="space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`p-6 rounded-xl transition-all duration-300 ${message.role === 'user'
                ? 'bg-[#242424] border border-[#3a3a3a]'
                : 'bg-transparent'
                }`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${message.role === 'user' ? 'bg-[#20b8cd] text-black' : 'bg-[#3a3a3a] text-white'
                  }`}>
                  {message.role === 'user' ? 'U' : 'AI'}
                </div>
                <span className={`text-sm font-medium ${message.role === 'user' ? 'text-[#20b8cd]' : 'text-gray-400'
                  }`}>
                  {message.role === 'user' ? 'You' : 'Gemini'}
                </span>
              </div>
              <div className="prose prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-[#111] prose-pre:border prose-pre:border-[#333] whitespace-pre-wrap">
                {message.content}
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="p-6 rounded-xl bg-transparent animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-6 h-6 rounded-full bg-[#3a3a3a] text-white flex items-center justify-center text-xs font-bold">AI</div>
                <span className="text-sm font-medium text-gray-400">Gemini</span>
              </div>
              <div className="space-y-2">
                <div className="h-4 bg-[#333] rounded w-3/4"></div>
                <div className="h-4 bg-[#333] rounded w-1/2"></div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <div className="fixed bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-[#1a1a1a] via-[#1a1a1a] to-transparent z-20">
        <form onSubmit={handleFormSubmit} className="max-w-4xl mx-auto relative group">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-[#20b8cd] transition-colors" />
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={account ? "Ask anything..." : "Connect wallet to start..."}
            disabled={!account || isLoading}
            className="w-full bg-[#242424] border border-[#3a3a3a] rounded-xl pl-12 pr-32 py-4 text-lg focus:outline-none focus:border-[#20b8cd] focus:ring-1 focus:ring-[#20b8cd] transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed placeholder:text-gray-600"
          />
          <button
            type="submit"
            disabled={!account || isLoading || !inputValue?.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 bg-[#20b8cd] hover:bg-[#1aa3b6] px-6 py-2 rounded-lg font-medium transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 text-black shadow-md"
          >
            {isLoading ? 'Thinking...' : 'Search'}
          </button>
        </form>
        <p className="text-center text-xs text-gray-500 mt-3">
          Each query costs 0.001 MON on Monad Testnet
        </p>
      </div>

      {/* Toast Notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-3 max-w-md">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`p-4 rounded-xl border shadow-2xl backdrop-blur-md animate-in slide-in-from-right fade-in duration-300 flex items-start gap-3 ${toast.type === 'success' ? 'bg-green-500/20 border-green-500/40 text-green-300' :
              toast.type === 'error' ? 'bg-red-500/20 border-red-500/40 text-red-300' :
                toast.type === 'warning' ? 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' :
                  'bg-blue-500/20 border-blue-500/40 text-blue-300'
              }`}
          >
            <div className="flex-shrink-0 text-lg">
              {toast.type === 'success' && '✓'}
              {toast.type === 'error' && '✗'}
              {toast.type === 'warning' && '⚠'}
              {toast.type === 'info' && 'ℹ'}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{toast.message}</div>
              {toast.details && (
                <div className="text-xs opacity-80 mt-1 break-words">{toast.details}</div>
              )}
            </div>
            <button
              onClick={() => removeToast(toast.id)}
              className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
