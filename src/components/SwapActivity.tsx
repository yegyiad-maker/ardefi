import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { ArrowUpRight, ArrowDownRight, ExternalLink, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import { usePublicClient } from 'wagmi';
import { TOKENS, type TokenSymbol } from '../hooks/useDEX';
import TokenLogo from './TokenLogo';

interface SwapEvent {
  tx_hash: string;
  pool_address: string;
  token_in: string;
  token_out: string;
  amount_in: string;
  amount_out: string;
  timestamp: string;
}

interface SwapActivityProps {
  fromToken: TokenSymbol;
  toToken: TokenSymbol;
  poolAddress: Address | null;
}

const EVENTS_PER_PAGE = 24;

export default function SwapActivity({ fromToken, toToken, poolAddress }: SwapActivityProps) {
  const [swapEvents, setSwapEvents] = useState<SwapEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [traderAddresses, setTraderAddresses] = useState<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const publicClient = usePublicClient();

  // Supabase configuration
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  // Get token addresses
  const fromTokenAddr = TOKENS[fromToken]?.address.toLowerCase();
  const toTokenAddr = TOKENS[toToken]?.address.toLowerCase();

  // Fetch swap events for this pool
  useEffect(() => {
    if (!poolAddress || !supabaseUrl || !supabaseKey || !fromTokenAddr || !toTokenAddr) {
      setSwapEvents([]);
      return;
    }

    const fetchSwapEvents = async () => {
      setIsLoading(true);
      try {
        const poolAddrLower = poolAddress.toLowerCase();
        const response = await fetch(
          `${supabaseUrl}/rest/v1/swap_events?pool_address=eq.${poolAddrLower}&select=tx_hash,pool_address,token_in,token_out,amount_in,amount_out,timestamp&order=timestamp.desc&limit=1000`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        if (response.ok) {
          const events = await response.json();
          setSwapEvents(events);
        }
      } catch (error) {
        console.error('Error fetching swap events:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchSwapEvents();
  }, [poolAddress, supabaseUrl, supabaseKey, fromTokenAddr, toTokenAddr]);

  // Fetch trader addresses for swap events
  useEffect(() => {
    if (!publicClient || swapEvents.length === 0) return;

    const fetchTraderAddresses = async () => {
      const addresses: Record<string, string> = {};
      
      // Fetch addresses for current page events (to avoid too many requests)
      const startIdx = (currentPage - 1) * EVENTS_PER_PAGE;
      const endIdx = startIdx + EVENTS_PER_PAGE;
      const eventsToFetch = swapEvents.slice(startIdx, endIdx);
      
      await Promise.all(
        eventsToFetch.map(async (event) => {
          try {
            const receipt = await publicClient.getTransactionReceipt({
              hash: event.tx_hash as `0x${string}`,
            });
            addresses[event.tx_hash] = receipt.from;
          } catch {
            // If we can't get receipt, use truncated hash
            addresses[event.tx_hash] = event.tx_hash.slice(0, 6) + '...' + event.tx_hash.slice(-4);
          }
        })
      );
      
      setTraderAddresses(addresses);
    };

    fetchTraderAddresses();
  }, [publicClient, swapEvents, currentPage]);

  // Pagination calculations
  const totalPages = Math.ceil(swapEvents.length / EVENTS_PER_PAGE);
  const paginatedEvents = useMemo(() => {
    const startIdx = (currentPage - 1) * EVENTS_PER_PAGE;
    const endIdx = startIdx + EVENTS_PER_PAGE;
    return swapEvents.slice(startIdx, endIdx);
  }, [swapEvents, currentPage]);

  // Reset to page 1 when pool changes
  useEffect(() => {
    setCurrentPage(1);
  }, [poolAddress]);

  // Get token symbol from address
  const getTokenSymbol = (address: string): TokenSymbol | string => {
    const tokenEntry = Object.entries(TOKENS).find(
      ([_, info]) => info.address.toLowerCase() === address.toLowerCase()
    );
    return tokenEntry ? (tokenEntry[0] as TokenSymbol) : address.slice(0, 6) + '...';
  };

  // Get token decimals from address
  const getTokenDecimals = (address: string): number => {
    const tokenEntry = Object.entries(TOKENS).find(
      ([_, info]) => info.address.toLowerCase() === address.toLowerCase()
    );
    return tokenEntry ? tokenEntry[1].decimals : 18;
  };

  // Format amount
  const formatAmount = (amount: string, decimals: number): string => {
    try {
      const formatted = formatUnits(BigInt(amount), decimals);
      const num = parseFloat(formatted);
      if (num >= 1000000) return `${(num / 1000000).toFixed(2)}M`;
      if (num >= 1000) return `${(num / 1000).toFixed(2)}K`;
      if (num < 0.0001) return num.toExponential(2);
      return num.toFixed(4);
    } catch {
      return '0';
    }
  };

  // Format timestamp
  const formatTime = (timestamp: string): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Determine if swap is a buy or sell
  // Buy: swapping from USDC (or base token) to the other token
  // Sell: swapping from the other token to USDC (or base token)
  const getSwapType = (tokenIn: string, tokenOut: string): 'buy' | 'sell' => {
    const tokenInLower = tokenIn.toLowerCase();
    const tokenOutLower = tokenOut.toLowerCase();
    
    // If swapping from fromToken to toToken, it's a buy of toToken
    // If swapping from toToken to fromToken, it's a sell of toToken
    if (tokenInLower === fromTokenAddr && tokenOutLower === toTokenAddr) {
      return 'buy'; // Buying toToken with fromToken
    } else if (tokenInLower === toTokenAddr && tokenOutLower === fromTokenAddr) {
      return 'sell'; // Selling toToken for fromToken
    }
    
    // Default: if USDC is involved, buying non-USDC is buy, selling non-USDC is sell
    const usdcAddr = TOKENS.USDC.address.toLowerCase();
    if (tokenInLower === usdcAddr) return 'buy';
    if (tokenOutLower === usdcAddr) return 'sell';
    
    return 'buy'; // Default
  };

  if (!poolAddress) {
    return null;
  }

  // Get trader address from transaction
  const getTraderAddress = (txHash: string): string => {
    if (traderAddresses[txHash]) {
      const addr = traderAddresses[txHash];
      // If it's a full address, truncate it
      if (addr.startsWith('0x') && addr.length === 42) {
        return addr.slice(0, 6) + '...' + addr.slice(-4);
      }
      return addr; // Already truncated
    }
    // Fallback to truncated tx hash
    return txHash.slice(0, 6) + '...' + txHash.slice(-4);
  };

  return (
    <div className="bg-white rounded-3xl p-6 border border-orange-200 shadow-xl mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900">Trade History & Traders</h3>
        <div className="text-xs text-gray-500">
          {swapEvents.length} {swapEvents.length === 1 ? 'trade' : 'trades'}
          {totalPages > 1 && ` • Page ${currentPage} of ${totalPages}`}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      ) : swapEvents.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 p-4">
          <p className="text-sm text-gray-500 text-center">
            No swap activity for this pair yet
          </p>
          <p className="text-xs text-gray-400 text-center mt-1">
            Swaps will appear here once trading starts
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto overflow-y-hidden min-h-[600px]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Trader</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Token Amount</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">USDC Amount</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Time</th>
                <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase tracking-wider">Tx</th>
              </tr>
            </thead>
            <tbody>
              {paginatedEvents.map((event, index) => {
                const tokenInSymbol = getTokenSymbol(event.token_in);
                const tokenOutSymbol = getTokenSymbol(event.token_out);
                const tokenInDecimals = getTokenDecimals(event.token_in);
                const tokenOutDecimals = getTokenDecimals(event.token_out);
                const amountInFormatted = formatAmount(event.amount_in, tokenInDecimals);
                const amountOutFormatted = formatAmount(event.amount_out, tokenOutDecimals);
                const swapType = getSwapType(event.token_in, event.token_out);

                return (
                  <motion.tr
                    key={`${event.tx_hash}-${index}`}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                    className="border-b border-gray-100 hover:bg-orange-50/50 transition-colors"
                  >
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          {getTraderAddress(event.tx_hash)}
                        </span>
                        <a
                          href={`https://explorer.arc.network/tx/${event.tx_hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-orange-600 hover:text-orange-700 transition-colors"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold ${
                        swapType === 'buy'
                          ? 'bg-green-100 text-green-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {swapType === 'buy' ? (
                          <ArrowUpRight className="w-3 h-3" />
                        ) : (
                          <ArrowDownRight className="w-3 h-3" />
                        )}
                        {swapType === 'buy' ? 'Buy' : 'Sell'}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          <TokenLogo token={tokenInSymbol as TokenSymbol} size={20} />
                          <span className="text-sm font-medium text-gray-900">
                            {amountInFormatted}
                          </span>
                          <span className="text-sm text-gray-500">{tokenInSymbol}</span>
                        </div>
                        <span className="text-gray-400 mx-1">→</span>
                        <div className="flex items-center gap-1.5">
                          <TokenLogo token={tokenOutSymbol as TokenSymbol} size={20} />
                          <span className="text-sm font-medium text-gray-900">
                            {amountOutFormatted}
                          </span>
                          <span className="text-sm text-gray-500">{tokenOutSymbol}</span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm font-medium text-gray-900">
                        {(() => {
                          const usdcAddr = TOKENS.USDC.address.toLowerCase();
                          const tokenInLower = event.token_in.toLowerCase();
                          const tokenOutLower = event.token_out.toLowerCase();
                          
                          // Determine which amount is USDC
                          if (tokenInLower === usdcAddr) {
                            return `${amountInFormatted} USDC`;
                          } else if (tokenOutLower === usdcAddr) {
                            return `${amountOutFormatted} USDC`;
                          } else {
                            // Neither token is USDC, show the fromToken amount (usually USDC in pairs)
                            return swapType === 'buy' ? `${amountInFormatted} ${fromToken}` : `${amountOutFormatted} ${toToken}`;
                          }
                        })()}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className="text-sm text-gray-600">
                        {formatTime(event.timestamp)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <a
                        href={`https://explorer.arc.network/tx/${event.tx_hash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-orange-600 hover:text-orange-700 transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </a>
                    </td>
                  </motion.tr>
                );
              })}
              {/* Empty rows to maintain consistent height and prevent scrollbar flicker */}
              {Array.from({ length: Math.max(0, EVENTS_PER_PAGE - paginatedEvents.length) }).map((_, idx) => (
                <tr key={`empty-${idx}`} className="border-b border-gray-100" style={{ height: '60px' }}>
                  <td colSpan={6}></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination Controls */}
      {swapEvents.length > EVENTS_PER_PAGE && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200">
          <div className="text-sm text-gray-600">
            Showing {((currentPage - 1) * EVENTS_PER_PAGE) + 1} to {Math.min(currentPage * EVENTS_PER_PAGE, swapEvents.length)} of {swapEvents.length} trades
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={`p-2 rounded-lg transition-colors ${
                currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum;
                if (totalPages <= 5) {
                  pageNum = i + 1;
                } else if (currentPage <= 3) {
                  pageNum = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  pageNum = totalPages - 4 + i;
                } else {
                  pageNum = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === pageNum
                        ? 'bg-orange-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className={`p-2 rounded-lg transition-colors ${
                currentPage === totalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
              }`}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

