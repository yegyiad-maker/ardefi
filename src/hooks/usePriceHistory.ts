import { useState, useEffect } from 'react';
import { type Address } from 'viem';
import { TOKENS, type TokenSymbol } from './useDEX';

export interface PriceDataPoint {
  time: string; // ISO date string
  value: number; // Price value
}

/**
 * Hook to fetch price history for a token pair from Supabase
 * Returns price data formatted for TradingView Lightweight Charts
 */
export function usePriceHistory(
  fromToken: TokenSymbol,
  toToken: TokenSymbol,
  poolAddress: Address | null,
  timeRange: '1H' | '1D' | '1W' | '1M' = '1D'
) {
  const [priceData, setPriceData] = useState<PriceDataPoint[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!poolAddress || !fromToken || !toToken) {
      setPriceData([]);
      return;
    }

    const fetchPriceHistory = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
        const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

        if (!supabaseUrl || !supabaseKey) {
          setError('Supabase not configured');
          setIsLoading(false);
          return;
        }

        // Calculate time range
        const now = new Date();
        let fromTime: Date;
        switch (timeRange) {
          case '1H':
            fromTime = new Date(now.getTime() - 60 * 60 * 1000);
            break;
          case '1D':
            fromTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            break;
          case '1W':
            fromTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case '1M':
            fromTime = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          default:
            fromTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        }

        const fromTokenAddr = TOKENS[fromToken].address.toLowerCase();
        const toTokenAddr = TOKENS[toToken].address.toLowerCase();
        const poolAddr = poolAddress.toLowerCase();

        // Fetch price history from Supabase
        const response = await fetch(
          `${supabaseUrl}/rest/v1/price_history?pool_address=eq.${poolAddr}&timestamp=gte.${fromTime.toISOString()}&order=timestamp.asc`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
            },
          }
        );

        if (!response.ok) {
          throw new Error('Failed to fetch price history');
        }

        const data = await response.json();

        if (!Array.isArray(data)) {
          setPriceData([]);
          setIsLoading(false);
          return;
        }

        // Transform data for chart
        // Determine which price to use based on token pair
        // If fromToken is tokenA, use price_b_per_a (price of tokenB in terms of tokenA)
        // If fromToken is tokenB, use price_a_per_b (price of tokenA in terms of tokenB)
        const transformedData: PriceDataPoint[] = data.map((item: any) => {
          const tokenA = item.token_a?.toLowerCase();
          const tokenB = item.token_b?.toLowerCase();
          
          // Determine which price to use
          // From indexer: price_a_per_b = reserveB/reserveA (how many tokenB per tokenA)
          //               price_b_per_a = reserveA/reserveB (how many tokenA per tokenB)
          // Chart shows "fromToken / toToken" meaning "how many toToken per fromToken"
          
          let price: number;
          
          // Try matching by address first (most reliable)
          const fromMatchesA = tokenA === fromTokenAddr;
          const fromMatchesB = tokenB === fromTokenAddr;
          const toMatchesA = tokenA === toTokenAddr;
          const toMatchesB = tokenB === toTokenAddr;
          
          if (fromMatchesA && toMatchesB) {
            // fromToken is tokenA, toToken is tokenB
            // We want: how many tokenB per tokenA = reserveB/reserveA = price_a_per_b
            // BUT: Calculate directly from reserves since indexer might have wrong data
            const reserveARaw = parseFloat(item.reserve_a) || 0;
            const reserveBRaw = parseFloat(item.reserve_b) || 0;
            
            // Get decimals from TOKENS (fallback to 18 if not found)
            const tokenADecimals = TOKENS[fromToken as TokenSymbol]?.decimals || 18;
            const tokenBDecimals = TOKENS[toToken as TokenSymbol]?.decimals || 18;
            
            const reserveAFormatted = reserveARaw / (10 ** tokenADecimals);
            const reserveBFormatted = reserveBRaw / (10 ** tokenBDecimals);
            
            // Calculate price directly from reserves (correct method)
            if (reserveAFormatted > 0) {
              price = reserveBFormatted / reserveAFormatted;
            } else {
              price = parseFloat(item.price_a_per_b) || 0;
            }
          } else if (fromMatchesB && toMatchesA) {
            // fromToken is tokenB, toToken is tokenA
            // We want: how many tokenA per tokenB = reserveA/reserveB = price_b_per_a
            // BUT: Calculate directly from reserves since indexer might have wrong data
            const reserveARaw = parseFloat(item.reserve_a) || 0;
            const reserveBRaw = parseFloat(item.reserve_b) || 0;
            
            // Get decimals from TOKENS (fallback to 18 if not found)
            const tokenADecimals = TOKENS[toToken as TokenSymbol]?.decimals || 18; // toToken is tokenA
            const tokenBDecimals = TOKENS[fromToken as TokenSymbol]?.decimals || 18; // fromToken is tokenB
            
            const reserveAFormatted = reserveARaw / (10 ** tokenADecimals);
            const reserveBFormatted = reserveBRaw / (10 ** tokenBDecimals);
            
            // Calculate price directly from reserves (correct method)
            if (reserveBFormatted > 0) {
              price = reserveAFormatted / reserveBFormatted;
            } else {
              price = parseFloat(item.price_b_per_a) || 0;
            }
          } else {
            // Fallback: match by symbol
            const fromMatchesASymbol = item.token_a_symbol === fromToken;
            const fromMatchesBSymbol = item.token_b_symbol === fromToken;
            const toMatchesASymbol = item.token_a_symbol === toToken;
            const toMatchesBSymbol = item.token_b_symbol === toToken;
            
            if (fromMatchesASymbol && toMatchesBSymbol) {
              // fromToken is tokenA (by symbol), toToken is tokenB
              price = parseFloat(item.price_a_per_b) || 0;
            } else if (fromMatchesBSymbol && toMatchesASymbol) {
              // fromToken is tokenB (by symbol), toToken is tokenA
              price = parseFloat(item.price_b_per_a) || 0;
            } else {
              // Last resort: calculate directly from reserves if we have them
              const reserveA = parseFloat(item.reserve_a) || 0;
              const reserveB = parseFloat(item.reserve_b) || 0;
              if (reserveA > 0 && reserveB > 0) {
                // Try to determine from reserves by matching symbols
                if (item.token_a_symbol === fromToken || item.token_b_symbol === fromToken) {
                  // We know which reserve is fromToken, calculate toToken per fromToken
                  if (item.token_a_symbol === fromToken) {
                    // fromToken is tokenA, so we want reserveB/reserveA
                    price = reserveB / reserveA;
                  } else {
                    // fromToken is tokenB, so we want reserveA/reserveB
                    price = reserveA / reserveB;
                  }
                } else {
                  // Can't determine - this is a problem
                  price = parseFloat(item.price_a_per_b) || 0;
                }
              } else {
                // No reserves available, default to price_a_per_b
                price = parseFloat(item.price_a_per_b) || 0;
              }
            }
          }

          // Format date for TradingView
          // For hourly data, use Unix timestamp (seconds)
          // For daily/weekly/monthly, use YYYY-MM-DD format
          const date = new Date(item.timestamp);
          let timeValue: string | number;
          
          if (timeRange === '1H') {
            // Use Unix timestamp in seconds for intraday data
            timeValue = Math.floor(date.getTime() / 1000);
          } else {
            // Use date string for daily data
            timeValue = date.toISOString().split('T')[0];
          }

          return {
            time: timeValue as any,
            value: price,
          };
        });

        // Filter out invalid data points
        const validData = transformedData.filter((point) => {
          const isValid = point.value > 0 && !isNaN(point.value);
          return isValid;
        });

        // Sort by time (ascending) - REQUIRED by TradingView
        validData.sort((a, b) => {
          // Compare time values (could be string dates or Unix timestamps)
          const timeA = typeof a.time === 'number' ? a.time : new Date(a.time).getTime();
          const timeB = typeof b.time === 'number' ? b.time : new Date(b.time).getTime();
          return timeA - timeB;
        });

        // Remove duplicates (keep last one for same timestamp)
        const uniqueData: PriceDataPoint[] = [];
        const seenTimes = new Set<string | number>();
        
        // Process in reverse to keep the latest point for each timestamp
        for (let i = validData.length - 1; i >= 0; i--) {
          const point = validData[i];
          if (!seenTimes.has(point.time)) {
            seenTimes.add(point.time);
            uniqueData.unshift(point); // Add to beginning to maintain order
          }
        }

        setPriceData(uniqueData);
      } catch (err: any) {
        setError(err.message || 'Failed to load price data');
        setPriceData([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPriceHistory();
  }, [fromToken, toToken, poolAddress, timeRange]);

  return { priceData, isLoading, error };
}

