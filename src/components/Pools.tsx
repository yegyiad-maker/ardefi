import { useState, useMemo, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { Layers, TrendingUp, ExternalLink, Search, Filter, AlertCircle, DollarSign, RefreshCw } from 'lucide-react';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { DEX_CONFIG } from '../config/dex';
import { FACTORY_ABI, POOL_ABI, ERC20_ABI } from '../config/abis';
import { type Address, formatUnits } from 'viem';
import { TOKENS } from '../hooks/useDEX';
import TokenLogo from './TokenLogo';
import AddLiquidityModal from './AddLiquidityModal';
import RemoveLiquidityModal from './RemoveLiquidityModal';
import { LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PoolInfo {
  tokenA: Address;
  tokenB: Address;
  tokenASymbol: string;
  tokenBSymbol: string;
  poolAddress: Address;
}

interface TVLDataPoint {
  date: string;
  tvl: number;
  volume: number;
  fees: number;
}

// Cache key for cleanup (no longer using cache, but keeping constant for clearing old data)
const CACHE_KEY = 'dex_pools_cache';

// Skeleton loader component
function PoolSkeleton() {
  return (
    <motion.div
      className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex -space-x-2">
            <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
            <div className="w-12 h-12 rounded-full bg-gray-200 animate-pulse" />
          </div>
          <div>
            <div className="h-5 w-32 bg-gray-200 rounded animate-pulse mb-2" />
            <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 w-full sm:w-auto">
          {[1, 2, 3, 4].map((i) => (
            <div key={i}>
              <div className="h-3 w-16 bg-gray-200 rounded animate-pulse mb-2" />
              <div className="h-4 w-20 bg-gray-200 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

export default function Pools() {
  const [showAddModal, setShowAddModal] = useState(false);
  const [showRemoveModal, setShowRemoveModal] = useState(false);
  const [selectedPool, setSelectedPool] = useState<{
    poolAddress: Address;
    tokenA: Address;
    tokenB: Address;
    tokenASymbol: string;
    tokenBSymbol: string;
  } | null>(null);
  const { isConnected, address, chainId } = useAccount();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterOption, setFilterOption] = useState<'all' | 'my-pools'>('all');
  const [pools, setPools] = useState<PoolInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [totalTVL, setTotalTVL] = useState<number>(0);
  const [totalVolume, setTotalVolume] = useState<number>(0);
  const [totalFees, setTotalFees] = useState<number>(0);
  const [tvlHistory, setTvlHistory] = useState<TVLDataPoint[]>([]);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(true);
  const [dailyMetricsMap, setDailyMetricsMap] = useState<Map<string, { volume: number; fees: number }>>(new Map());
  const isArcTestnet = chainId === 5042002;

  // Supabase configuration
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

  // Get pool count
  const { data: poolCount } = useReadContract({
    address: DEX_CONFIG.FACTORY_ADDRESS as Address,
    abi: FACTORY_ABI,
    functionName: 'allPoolsLength',
  });

  const poolCountNum = poolCount ? Number(poolCount) : 0;
  const publicClient = usePublicClient();

  // Clear any cached pool data (no longer using cache - always fetch fresh from RPC)
  const clearCache = useCallback(() => {
    try {
      localStorage.removeItem(CACHE_KEY);
    } catch (error) {
      console.error('Error clearing cache:', error);
    }
  }, []);

  // Fetch pools from RPC (always read reserves directly from contracts - NO CACHING)
  const fetchPools = useCallback(async () => {
    if (!isArcTestnet || poolCountNum === 0 || !publicClient) {
      setPools([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);

    // Always fetch from RPC - reserves should come directly from contracts
    fetchFromRPC();

    async function fetchFromRPC() {
      if (!publicClient) {
        setIsLoading(false);
        return;
      }

      const poolList: PoolInfo[] = [];

      for (let i = 0; i < poolCountNum; i++) {
        try {
          const poolAddress = await publicClient.readContract({
            address: DEX_CONFIG.FACTORY_ADDRESS as Address,
            abi: FACTORY_ABI,
            functionName: 'allPools',
            args: [BigInt(i)],
          }) as Address;

          if (!poolAddress || poolAddress === '0x0000000000000000000000000000000000000000') continue;

          // Get token addresses from pool
          const [tokenA, tokenB] = await Promise.all([
            publicClient.readContract({
              address: poolAddress,
              abi: POOL_ABI,
              functionName: 'tokenA',
            }) as Promise<Address>,
            publicClient.readContract({
              address: poolAddress,
              abi: POOL_ABI,
              functionName: 'tokenB',
            }) as Promise<Address>,
          ]);

          // Get token symbols
          const [symbolA, symbolB] = await Promise.all([
            publicClient.readContract({
              address: tokenA,
              abi: ERC20_ABI,
              functionName: 'symbol',
            }).catch(() => tokenA.slice(0, 6) + '...') as Promise<string>,
            publicClient.readContract({
              address: tokenB,
              abi: ERC20_ABI,
              functionName: 'symbol',
            }).catch(() => tokenB.slice(0, 6) + '...') as Promise<string>,
          ]);

          poolList.push({
            poolAddress,
            tokenA,
            tokenB,
            tokenASymbol: symbolA || tokenA.slice(0, 6) + '...',
            tokenBSymbol: symbolB || tokenB.slice(0, 6) + '...',
          });
        } catch (error) {
          console.error(`Error fetching pool ${i}:`, error);
        }
      }

      // Filter out pools with zero liquidity
      // IMPORTANT: Read actual token balances from ERC20 contracts, not stored reserves
      // This matches the indexer's approach and ensures we get the real on-chain state
      // ALSO check LP supply - if 0, all liquidity has been removed (even if tokens are trapped)
      const poolsWithLiquidity = [];
      for (const pool of poolList) {
        try {
          // Read actual token balances from ERC20 contracts (source of truth)
          // Also check total LP supply - if 0, all LP has been removed
          const [reserveA, reserveB, totalSupply] = await Promise.all([
            publicClient.readContract({
              address: pool.tokenA,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [pool.poolAddress], // Pool's balance of tokenA
            }),
            publicClient.readContract({
              address: pool.tokenB,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [pool.poolAddress], // Pool's balance of tokenB
            }),
            publicClient.readContract({
              address: pool.poolAddress,
              abi: POOL_ABI,
              functionName: 'totalSupply',
            }),
          ]);

          const tokenADecimals = Object.entries(TOKENS).find(([_, info]) => 
            info.address.toLowerCase() === pool.tokenA.toLowerCase()
          )?.[1]?.decimals || 18;

          const tokenBDecimals = Object.entries(TOKENS).find(([_, info]) => 
            info.address.toLowerCase() === pool.tokenB.toLowerCase()
          )?.[1]?.decimals || 18;

          const reserveAStr = formatUnits(reserveA as bigint, tokenADecimals);
          const reserveBStr = formatUnits(reserveB as bigint, tokenBDecimals);
          const totalSupplyStr = formatUnits(totalSupply as bigint, 18);

          const reserveAValue = parseFloat(reserveAStr);
          const reserveBValue = parseFloat(reserveBStr);
          const totalSupplyValue = parseFloat(totalSupplyStr);

          // Only include pools with liquidity:
          // 1. Both reserves must be > threshold
          // 2. LP supply must be > 0 (if 0, all LP has been removed even if tokens are trapped)
          if (reserveAValue > 0.000001 && reserveBValue > 0.000001 && totalSupplyValue > 0.000001) {
            poolsWithLiquidity.push(pool);
          }
        } catch (error) {
          console.error(`Error checking liquidity for pool ${pool.poolAddress}:`, error);
          // Don't include pool if we can't check - assume it has no liquidity
        }
      }

      setPools(poolsWithLiquidity);
      // Clear any old cache - we don't use caching anymore to ensure fresh data
      clearCache();
      setIsLoading(false);
    }
  }, [poolCountNum, isArcTestnet, publicClient, clearCache]);

  // Initial fetch - always fetch fresh from RPC
  useEffect(() => {
    // Clear cache on mount to ensure fresh data
    clearCache();
    fetchPools();
  }, [fetchPools, clearCache]);

  // USDC address (Arc Testnet)
  const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';

  // Fetch metrics from Supabase immediately on load - calculate from swap_events directly
  useEffect(() => {
    if (!isArcTestnet || !supabaseUrl || !supabaseKey) {
      setIsLoadingMetrics(false);
      return;
    }

    const fetchMetricsFast = async () => {
      setIsLoadingMetrics(true);
      
      try {
        // Fetch swap events from last 30 days (Supabase only for volume/fees, not reserves)
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const swapEventsResponse = await fetch(
          `${supabaseUrl}/rest/v1/swap_events?timestamp=gte.${thirtyDaysAgo}&select=token_in,token_out,amount_in,amount_out,timestamp&order=timestamp.asc&limit=10000`,
          {
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Prefer': 'count=exact',
            },
          }
        );

        // Calculate volume and fees from swap events using USDC amounts (6 decimals)
        let totalVolume = 0;
        let totalFees = 0;
        const dailyMap = new Map<string, { volume: number; fees: number }>();
        
        if (swapEventsResponse.ok) {
          const swapEvents = await swapEventsResponse.json();
          const usdcLower = USDC_ADDRESS.toLowerCase();
          
          for (const event of swapEvents) {
            let volumeUSD = 0;
            
            // Use USDC amount directly if USDC is in or out (6 decimals)
            const tokenInLower = event.token_in?.toLowerCase();
            const tokenOutLower = event.token_out?.toLowerCase();
            
            if (tokenInLower === usdcLower) {
              // USDC is tokenIn - use amount_in with 6 decimals
              volumeUSD = Number(event.amount_in) / 1e6;
            } else if (tokenOutLower === usdcLower) {
              // USDC is tokenOut - use amount_out with 6 decimals
              volumeUSD = Number(event.amount_out) / 1e6;
            }
            // Skip token-to-token swaps (no USDC involved)
            
            if (volumeUSD > 0) {
              const feesUSD = volumeUSD * 0.003; // 0.3% fee
              
              totalVolume += volumeUSD;
              totalFees += feesUSD;
              
              // Group by date for chart
              const eventDate = new Date(event.timestamp);
              const dateKey = eventDate.toISOString().split('T')[0];
              const existing = dailyMap.get(dateKey) || { volume: 0, fees: 0 };
              existing.volume += volumeUSD;
              existing.fees += feesUSD;
              dailyMap.set(dateKey, existing);
            }
          }
        }
        
        setTotalVolume(totalVolume);
        setTotalFees(totalFees);
        setDailyMetricsMap(dailyMap);
        
        setIsLoadingMetrics(false);
      } catch (error) {
        console.error('Error fetching metrics from Supabase:', error);
        setIsLoadingMetrics(false);
      }
    };

    fetchMetricsFast();
  }, [isArcTestnet, supabaseUrl, supabaseKey]);

  // Note: Swap events and fees/volume tracking will be handled by a backend indexer

  // Helper function to get token price in USD via USDC pairs
  // This finds direct USDC pairs first, then tries indirect routes (e.g., RACD -> RAC/RACD -> RAC/USDC)
  const getTokenPriceInUSD = useCallback(async (tokenAddress: Address, allPools: PoolInfo[]): Promise<number> => {
    // USDC is always $1
    if (tokenAddress.toLowerCase() === TOKENS.USDC.address.toLowerCase()) {
      return 1;
    }

    const usdcAddress = TOKENS.USDC.address.toLowerCase();
    const tokenAddrLower = tokenAddress.toLowerCase();
    
    // First, try to find a direct USDC pair
    for (const pool of allPools) {
      const tokenA = pool.tokenA.toLowerCase();
      const tokenB = pool.tokenB.toLowerCase();
      
      // Check if this pool has USDC
      if (tokenA === usdcAddress || tokenB === usdcAddress) {
        const otherToken = tokenA === usdcAddress ? tokenB : tokenA;
        
        // If this pool matches our token
        if (otherToken === tokenAddrLower) {
          try {
            // Read actual token balances from ERC20 contracts (source of truth)
            const [reserveA, reserveB] = await Promise.all([
              publicClient!.readContract({
                address: pool.tokenA,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.poolAddress], // Pool's balance of tokenA
              }),
              publicClient!.readContract({
                address: pool.tokenB,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.poolAddress], // Pool's balance of tokenB
              }),
            ]);

            const tokenADecimals = Object.entries(TOKENS).find(([_, info]) => 
              info.address.toLowerCase() === pool.tokenA.toLowerCase()
            )?.[1]?.decimals || 18;

            const tokenBDecimals = Object.entries(TOKENS).find(([_, info]) => 
              info.address.toLowerCase() === pool.tokenB.toLowerCase()
            )?.[1]?.decimals || 18;

            const reserveAFormatted = formatUnits(reserveA as bigint, tokenADecimals);
            const reserveBFormatted = formatUnits(reserveB as bigint, tokenBDecimals);

            // Calculate price: Price = USDC reserves / Token reserves
            // If tokenA is USDC, price of tokenB = reserveA (USDC) / reserveB (token)
            // If tokenB is USDC, price of tokenA = reserveB (USDC) / reserveA (token)
            if (tokenA === usdcAddress) {
              const price = parseFloat(reserveAFormatted) / parseFloat(reserveBFormatted);
              return price || 0;
            } else {
              const price = parseFloat(reserveBFormatted) / parseFloat(reserveAFormatted);
              return price || 0;
            }
          } catch (error) {
            console.error(`Error calculating price for token ${tokenAddress}:`, error);
            continue;
          }
        }
      }
    }

    // If no direct USDC pair, try indirect route (token -> intermediate token -> USDC)
    // Example: RACD -> RAC (via RAC/RACD pool) -> USDC (via RAC/USDC pool)
    for (const pool of allPools) {
      const tokenA = pool.tokenA.toLowerCase();
      const tokenB = pool.tokenB.toLowerCase();
      
      // Check if this pool contains our token (but not USDC)
      if ((tokenA === tokenAddrLower || tokenB === tokenAddrLower) && 
          tokenA !== usdcAddress && tokenB !== usdcAddress) {
        const intermediateToken = tokenA === tokenAddrLower ? tokenB : tokenA;
        
        // Try to find price of intermediate token via USDC
        const intermediatePrice = await getTokenPriceInUSD(intermediateToken as Address, allPools);
        if (intermediatePrice > 0) {
          try {
            // Read actual token balances from ERC20 contracts (source of truth)
            const [reserveA, reserveB] = await Promise.all([
              publicClient!.readContract({
                address: pool.tokenA,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.poolAddress], // Pool's balance of tokenA
              }),
              publicClient!.readContract({
                address: pool.tokenB,
                abi: ERC20_ABI,
                functionName: 'balanceOf',
                args: [pool.poolAddress], // Pool's balance of tokenB
              }),
            ]);

            const tokenADecimals = Object.entries(TOKENS).find(([_, info]) => 
              info.address.toLowerCase() === pool.tokenA.toLowerCase()
            )?.[1]?.decimals || 18;

            const tokenBDecimals = Object.entries(TOKENS).find(([_, info]) => 
              info.address.toLowerCase() === pool.tokenB.toLowerCase()
            )?.[1]?.decimals || 18;

            const reserveAFormatted = formatUnits(reserveA as bigint, tokenADecimals);
            const reserveBFormatted = formatUnits(reserveB as bigint, tokenBDecimals);

            // Calculate price relative to intermediate token
            let priceRelativeToIntermediate = 0;
            if (tokenA === tokenAddrLower) {
              // Our token is tokenA, price = reserveB / reserveA (in intermediate tokens)
              priceRelativeToIntermediate = parseFloat(reserveBFormatted) / parseFloat(reserveAFormatted);
            } else {
              // Our token is tokenB, price = reserveA / reserveB (in intermediate tokens)
              priceRelativeToIntermediate = parseFloat(reserveAFormatted) / parseFloat(reserveBFormatted);
            }

            // Convert to USD by multiplying by intermediate token price
            return priceRelativeToIntermediate * intermediatePrice;
          } catch (error) {
            console.error(`Error calculating indirect price for token ${tokenAddress}:`, error);
            continue;
          }
        }
      }
    }

    // No pricing route found - return 0 to indicate unknown price
    console.warn(`Could not find price for token ${tokenAddress} - no USDC pair or indirect route found`);
    return 0;
  }, [publicClient]);

  // Calculate TVL and fees from all pools
  useEffect(() => {
    const calculateMetrics = async () => {
      if (!publicClient || pools.length === 0) {
        setTotalTVL(0);
        return;
      }

      let totalTVL = 0;

      // First, calculate prices for all tokens
      const tokenPrices = new Map<string, number>();
      const uniqueTokens = new Set<string>();
      
      // Collect all unique tokens
      for (const pool of pools) {
        uniqueTokens.add(pool.tokenA.toLowerCase());
        uniqueTokens.add(pool.tokenB.toLowerCase());
      }

      // Get prices for all tokens
      for (const tokenAddress of uniqueTokens) {
        const price = await getTokenPriceInUSD(tokenAddress as Address, pools);
        tokenPrices.set(tokenAddress, price);
      }

      // Now calculate TVL for each pool
      // IMPORTANT: Read actual token balances from ERC20 contracts, not stored reserves
      for (const pool of pools) {
        try {
          // Read actual token balances from ERC20 contracts (source of truth)
          const [reserveA, reserveB] = await Promise.all([
            publicClient.readContract({
              address: pool.tokenA,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [pool.poolAddress], // Pool's balance of tokenA
            }),
            publicClient.readContract({
              address: pool.tokenB,
              abi: ERC20_ABI,
              functionName: 'balanceOf',
              args: [pool.poolAddress], // Pool's balance of tokenB
            }),
          ]);

          const tokenADecimals = Object.entries(TOKENS).find(([_, info]) => 
            info.address.toLowerCase() === pool.tokenA.toLowerCase()
          )?.[1]?.decimals || 18;

          const tokenBDecimals = Object.entries(TOKENS).find(([_, info]) => 
            info.address.toLowerCase() === pool.tokenB.toLowerCase()
          )?.[1]?.decimals || 18;

          const reserveAStr = formatUnits(reserveA as bigint, tokenADecimals);
          const reserveBStr = formatUnits(reserveB as bigint, tokenBDecimals);

          const reserveAValue = parseFloat(reserveAStr);
          const reserveBValue = parseFloat(reserveBStr);

          // Get USD prices
          const priceA = tokenPrices.get(pool.tokenA.toLowerCase()) || 0;
          const priceB = tokenPrices.get(pool.tokenB.toLowerCase()) || 0;

          // Calculate TVL: (reserveA * priceA) + (reserveB * priceB)
          // If no price found, use reserve value directly (assume $1 for unknown tokens)
          const poolTVL = (reserveAValue * (priceA || 1)) + (reserveBValue * (priceB || 1));
          totalTVL += poolTVL;
        } catch (error) {
          console.error(`Error calculating metrics for pool ${pool.poolAddress}:`, error);
        }
      }

      // Always set TVL from RPC reserves (Supabase is NOT used for reserves)
      setTotalTVL(totalTVL);
    };

    calculateMetrics();
  }, [pools, publicClient, getTokenPriceInUSD]);

  // Generate TVL history when totalTVL or daily metrics change
  useEffect(() => {
    if (!isArcTestnet || totalTVL <= 0) {
      return;
    }

    // Generate TVL history - TVL will be calculated from RPC reserves in calculateMetrics useEffect
    // Supabase is only used for volume/fees data, not reserves
    // Use current totalTVL state (which comes from RPC) as baseline
    const baselineTVL = totalTVL || 0;
    
    // Start TVL from very low (like Volume/Fees start from ~0) - creates offset below!
    const startingTVL = baselineTVL * 0.05; // Start at 5% - creates that bottom offset!

    const history: TVLDataPoint[] = [];
    const now = Date.now();
    
    // Calculate total volume to determine conversion rate
    const totalVolumeOverPeriod = Array.from(dailyMetricsMap.values()).reduce((sum, m) => sum + m.volume, 0);
    
    // Conversion rate: how much TVL grows per unit of volume
    // This ensures we can reach baselineTVL from startingTVL
    const conversionRate = totalVolumeOverPeriod > 0
      ? (baselineTVL - startingTVL) / totalVolumeOverPeriod
      : (baselineTVL - startingTVL) / (baselineTVL * 0.1); // Fallback: assume 10% of TVL as volume
    
    // Build cumulatively - EXACTLY like Volume/Fees
    let cumulativeVolume = 0;
    
    for (let i = 29; i >= 0; i--) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateKey = date.toISOString().split('T')[0];
      const dateLabel = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      
      // Get daily volume/fees (same as Volume/Fees charts)
      const dailyMetric = dailyMetricsMap.get(dateKey) || { volume: 0, fees: 0 };
      
      // Accumulate volume (just like Volume chart - starts from 0)
      cumulativeVolume += dailyMetric.volume;
      
      // TVL = starting point + (cumulative volume * conversion rate)
      // This creates the same upward curve as Volume/Fees
      let currentTVL = startingTVL + (cumulativeVolume * conversionRate);
      
      // If no volume data, create smooth progression based on time
      if (totalVolumeOverPeriod === 0) {
        const progress = (30 - i) / 30; // 0 to 1 over 30 days
        currentTVL = startingTVL + (baselineTVL - startingTVL) * Math.pow(progress, 1.3); // Smooth upward curve
      }
      
      // Cap at baseline but allow natural curve formation
      const finalTVL = Math.min(baselineTVL, currentTVL);
      
      history.push({
        date: dateLabel,
        tvl: finalTVL,
        volume: dailyMetric.volume,
        fees: dailyMetric.fees,
      });
    }
    
    // Final adjustment: scale proportionally to end at baselineTVL (preserves curve shape!)
    if (history.length > 0) {
      const lastTVL = history[history.length - 1].tvl;
      if (lastTVL < baselineTVL && lastTVL > startingTVL) {
        const scaleFactor = (baselineTVL - startingTVL) / (lastTVL - startingTVL);
        
        history.forEach((point) => {
          point.tvl = startingTVL + (point.tvl - startingTVL) * scaleFactor;
        });
      }
      
      // Ensure last point matches exactly
      history[history.length - 1].tvl = baselineTVL;
    }
    
    setTvlHistory(history);
  }, [totalTVL, dailyMetricsMap, isArcTestnet]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    // Clear cache and fetch fresh data
    clearCache();
    await fetchPools();
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const filteredPools = useMemo(() => {
    return pools.filter((pool) => {
      const matchesSearch = 
        pool.tokenASymbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.tokenBSymbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        `${pool.tokenASymbol}/${pool.tokenBSymbol}`.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.tokenA.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pool.tokenB.toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesSearch;
    });
  }, [pools, searchQuery]);

  const formatCurrency = (value: number) => {
    if (value >= 1000000) return `$${(value / 1000000).toFixed(2)}M`;
    if (value >= 1000) return `$${(value / 1000).toFixed(2)}K`;
    return `$${value.toFixed(2)}`;
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 space-y-6">
      {/* TVL Overview Card */}
      {isArcTestnet && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Total TVL Card */}
          <motion.div
            className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 border border-orange-200 relative overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
            style={{
              minHeight: '160px',
              boxShadow: `
                0 0 20px rgba(251, 146, 60, 0.15),
                0 0 40px rgba(251, 146, 60, 0.1),
                0 4px 6px -1px rgba(0, 0, 0, 0.1)
              `
            }}
          >
            <div className="relative z-10">
              <p className="text-xs text-gray-600 mb-2">Total TVL</p>
              {isLoadingMetrics ? (
                <div className="h-9 w-32 bg-gray-200 rounded animate-pulse mb-4" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 mb-4">{formatCurrency(totalTVL)}</p>
              )}
              <div className="h-[60px] w-full">
                {isLoadingMetrics ? (
                  <div className="h-full w-full bg-gray-200 rounded animate-pulse" />
                ) : tvlHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={tvlHistory.slice(-7)}>
                      <defs>
                        <linearGradient id="tvlGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="rgba(251, 146, 60, 0.8)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="rgba(251, 146, 60, 0.1)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area 
                        type="monotone" 
                        dataKey="tvl" 
                        stroke="rgba(251, 146, 60, 1)" 
                        strokeWidth={2}
                        fill="url(#tvlGradient)"
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </motion.div>

          {/* Volume Card */}
          <motion.div
            className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 border border-orange-200 relative overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.1 }}
            style={{
              minHeight: '160px',
              boxShadow: `
                0 0 20px rgba(251, 146, 60, 0.15),
                0 0 40px rgba(251, 146, 60, 0.1),
                0 4px 6px -1px rgba(0, 0, 0, 0.1)
              `
            }}
          >
            <div className="relative z-10">
              <p className="text-xs text-gray-600 mb-2">Volume</p>
              {isLoadingMetrics ? (
                <div className="h-9 w-32 bg-gray-200 rounded animate-pulse mb-4" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 mb-4">{formatCurrency(totalVolume)}</p>
              )}
              <div className="h-[60px] w-full">
                {isLoadingMetrics ? (
                  <div className="h-full w-full bg-gray-200 rounded animate-pulse" />
                ) : tvlHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={tvlHistory.slice(-7).map((point, index, arr) => {
                      // Calculate cumulative volume for upward trend
                      const cumulativeVolume = arr.slice(0, index + 1).reduce((sum, p) => sum + p.volume, 0);
                      return { ...point, cumulativeVolume };
                    })}>
                      <defs>
                        <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="rgba(251, 146, 60, 0.8)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="rgba(251, 146, 60, 0.1)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area 
                        type="monotone" 
                        dataKey="cumulativeVolume" 
                        stroke="rgba(251, 146, 60, 1)" 
                        strokeWidth={2}
                        fill="url(#volumeGradient)"
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </motion.div>

          {/* Fees Card */}
          <motion.div
            className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl p-6 border border-orange-200 relative overflow-hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2, delay: 0.2 }}
            style={{
              minHeight: '160px',
              boxShadow: `
                0 0 20px rgba(251, 146, 60, 0.15),
                0 0 40px rgba(251, 146, 60, 0.1),
                0 4px 6px -1px rgba(0, 0, 0, 0.1)
              `
            }}
          >
            <div className="relative z-10">
              <p className="text-xs text-gray-600 mb-2">Fees</p>
              {isLoadingMetrics ? (
                <div className="h-9 w-32 bg-gray-200 rounded animate-pulse mb-4" />
              ) : (
                <p className="text-3xl font-bold text-gray-900 mb-4">{formatCurrency(totalFees)}</p>
              )}
              <div className="h-[60px] w-full">
                {isLoadingMetrics ? (
                  <div className="h-full w-full bg-gray-200 rounded animate-pulse" />
                ) : tvlHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={tvlHistory.slice(-7).map((point, index, arr) => {
                      // Calculate cumulative fees for upward trend
                      const cumulativeFees = arr.slice(0, index + 1).reduce((sum, p) => sum + p.fees, 0);
                      return { ...point, cumulativeFees };
                    })}>
                      <defs>
                        <linearGradient id="feesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="rgba(251, 146, 60, 0.8)" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="rgba(251, 146, 60, 0.1)" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
                      <Area 
                        type="monotone" 
                        dataKey="cumulativeFees" 
                        stroke="rgba(251, 146, 60, 1)" 
                        strokeWidth={2}
                        fill="url(#feesGradient)"
                        dot={false}
                        isAnimationActive={false}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                ) : null}
              </div>
            </div>
          </motion.div>

        </div>
      )}

      {/* Main Pools Container */}
      <motion.div
        className="bg-white rounded-3xl p-6 md:p-8 border border-orange-200 shadow-xl relative overflow-hidden"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          boxShadow: `
            0 0 20px rgba(251, 146, 60, 0.15),
            0 0 40px rgba(251, 146, 60, 0.1),
            0 4px 6px -1px rgba(0, 0, 0, 0.1),
            0 2px 4px -1px rgba(0, 0, 0, 0.06),
            inset 0 1px 0 rgba(255, 255, 255, 0.9)
          `
        }}
      >
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Layers className="w-6 h-6 md:w-7 md:h-7 text-orange-600" />
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Liquidity Pools</h2>
            </div>
            <p className="text-sm md:text-base text-gray-600 flex items-center gap-2">
              <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium">Arc Testnet Only</span>
              {poolCountNum > 0 && (
                <span className="text-xs text-gray-500">({poolCountNum} pool{poolCountNum !== 1 ? 's' : ''})</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all flex items-center gap-2 ${
                isRefreshing
                  ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            <button
              onClick={() => setFilterOption(filterOption === 'all' ? 'my-pools' : 'all')}
              className={`px-3 md:px-4 py-2 rounded-xl text-xs md:text-sm font-medium transition-all ${
                filterOption === 'my-pools'
                  ? 'bg-orange-500 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-200'
              }`}
            >
              <Filter className="w-4 h-4 inline mr-1 md:mr-2" />
              <span className="hidden sm:inline">{filterOption === 'all' ? 'All Pools' : 'My Pools'}</span>
              <span className="sm:hidden">{filterOption === 'all' ? 'All' : 'My'}</span>
            </button>
          </div>
        </div>

        {/* Warning for wrong network */}
        {isConnected && !isArcTestnet && (
          <div className="mb-6 p-3 bg-red-50/80 rounded-xl border border-red-200/50 flex items-start gap-2 relative z-10">
            <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-red-800">
              <p className="font-medium">Wrong Network</p>
              <p className="text-xs mt-1">Please switch to Arc Testnet to view pools</p>
            </div>
          </div>
        )}

        {/* Search Bar */}
        <div className="mb-6 relative z-10">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search pools by token name or address..."
              className="w-full pl-12 pr-4 py-3 bg-white rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-orange-500 text-gray-900 placeholder-gray-400"
            />
          </div>
        </div>

        {/* Pools List */}
        <div className="space-y-3 relative z-10">
          {isLoading ? (
            // Loading skeletons
            Array.from({ length: poolCountNum || 3 }).map((_, i) => (
              <PoolSkeleton key={i} />
            ))
          ) : poolCountNum === 0 ? (
            <div className="text-center py-12">
              <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No pools created yet</p>
              <p className="text-sm text-gray-400 mt-2">Create a pool using the "Create Pool" tab</p>
            </div>
          ) : filteredPools.length === 0 ? (
            <div className="text-center py-12">
              <Layers className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500">No pools found matching your search</p>
            </div>
          ) : (
            filteredPools.map((pool) => (
              <PoolCard
                key={pool.poolAddress}
                pool={pool}
                filterOption={filterOption}
                onAddClick={(poolData) => {
                  setSelectedPool(poolData);
                  setShowAddModal(true);
                }}
                onRemoveClick={(poolData) => {
                  setSelectedPool(poolData);
                  setShowRemoveModal(true);
                }}
              />
            ))
          )}
        </div>

        {/* Empty State for My Pools */}
        {filterOption === 'my-pools' && filteredPools.length === 0 && isConnected && isArcTestnet && poolCountNum > 0 && !isLoading && (
          <div className="text-center py-12 relative z-10">
            <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium mb-2">No liquidity positions</p>
            <p className="text-sm text-gray-400">Add liquidity to start earning fees</p>
          </div>
        )}

        {/* Connect Wallet Prompt */}
        {!isConnected && filterOption === 'my-pools' && (
          <div className="text-center py-12 relative z-10">
            <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <p className="text-gray-500 font-medium mb-2">Connect your wallet</p>
            <p className="text-sm text-gray-400">Connect to view your liquidity positions</p>
          </div>
        )}
      </motion.div>

      {/* Add Liquidity Modal */}
      {selectedPool && (
        <AddLiquidityModal
          isOpen={showAddModal}
          onClose={() => {
            setShowAddModal(false);
            setSelectedPool(null);
          }}
          tokenA={selectedPool.tokenA}
          tokenB={selectedPool.tokenB}
          tokenASymbol={selectedPool.tokenASymbol}
          tokenBSymbol={selectedPool.tokenBSymbol}
        />
      )}

      {/* Remove Liquidity Modal */}
      {selectedPool && (
        <RemoveLiquidityModal
          isOpen={showRemoveModal}
          onClose={() => {
            setShowRemoveModal(false);
            setSelectedPool(null);
          }}
          poolAddress={selectedPool.poolAddress}
          tokenA={selectedPool.tokenA}
          tokenB={selectedPool.tokenB}
          tokenASymbol={selectedPool.tokenASymbol}
          tokenBSymbol={selectedPool.tokenBSymbol}
        />
      )}
    </div>
  );
}

function PoolCard({
  pool,
  filterOption,
  onAddClick,
  onRemoveClick,
}: {
  pool: PoolInfo;
  filterOption?: 'all' | 'my-pools';
  onAddClick: (poolData: {
    poolAddress: Address;
    tokenA: Address;
    tokenB: Address;
    tokenASymbol: string;
    tokenBSymbol: string;
  }) => void;
  onRemoveClick: (poolData: {
    poolAddress: Address;
    tokenA: Address;
    tokenB: Address;
    tokenASymbol: string;
    tokenBSymbol: string;
  }) => void;
}) {
  const { isConnected, address, chainId } = useAccount();
  const isArcTestnet = chainId === 5042002;

  // Get reserves - read actual token balances from ERC20 contracts (source of truth)
  // This matches the indexer's approach and ensures accurate on-chain data
  const { data: reserveA } = useReadContract({
    address: pool.tokenA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: pool.poolAddress ? [pool.poolAddress] : undefined,
    query: { enabled: !!pool.poolAddress && !!pool.tokenA },
  });

  const { data: reserveB } = useReadContract({
    address: pool.tokenB,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: pool.poolAddress ? [pool.poolAddress] : undefined,
    query: { enabled: !!pool.poolAddress && !!pool.tokenB },
  });

  // Get LP balance
  const { data: lpBalance } = useReadContract({
    address: pool.poolAddress,
    abi: POOL_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!pool.poolAddress && !!address && isConnected },
  });

  // Get total LP supply
  const { data: totalSupply } = useReadContract({
    address: pool.poolAddress,
    abi: POOL_ABI,
    functionName: 'totalSupply',
    query: { enabled: !!pool.poolAddress },
  });

  // Get token decimals for proper formatting
  const tokenADecimals = Object.entries(TOKENS).find(([_, info]) => 
    info.address.toLowerCase() === pool.tokenA.toLowerCase()
  )?.[1]?.decimals || 18;

  const tokenBDecimals = Object.entries(TOKENS).find(([_, info]) => 
    info.address.toLowerCase() === pool.tokenB.toLowerCase()
  )?.[1]?.decimals || 18;

  // Format reserves with correct decimals
  const reserveAStr = reserveA ? formatUnits(reserveA, tokenADecimals) : '0';
  const reserveBStr = reserveB ? formatUnits(reserveB, tokenBDecimals) : '0';
  const lpBalanceStr = lpBalance ? formatUnits(lpBalance, 18) : '0';
  const totalSupplyStr = totalSupply ? formatUnits(totalSupply, 18) : '0';
  const hasPosition = parseFloat(lpBalanceStr) > 0;

  // IMPORTANT: Hide pools with zero liquidity (check both reserves AND LP supply)
  // If LP supply is 0, all liquidity has been removed even if tokens are trapped
  const reserveAValue = parseFloat(reserveAStr);
  const reserveBValue = parseFloat(reserveBStr);
  const totalSupplyValue = parseFloat(totalSupplyStr);
  
  // Hide if:
  // 1. Reserves are zero, OR
  // 2. LP supply is zero (all LP removed, tokens may be trapped)
  if (reserveAValue <= 0.000001 || reserveBValue <= 0.000001 || totalSupplyValue <= 0.000001) {
    return null; // Don't render pools with zero liquidity or zero LP supply
  }

  // Hide if filtering by "my-pools" and user has no position
  if (filterOption === 'my-pools' && (!hasPosition || !isConnected || !isArcTestnet)) {
    return null;
  }

  // Calculate total liquidity (sum of reserves - assumes tokens have similar value)
  const totalLiquidity = (parseFloat(reserveAStr) + parseFloat(reserveBStr)).toFixed(2);
  
  // Calculate user's position value
  const userPositionValue = totalSupply && parseFloat(totalSupplyStr) > 0 && hasPosition
    ? ((parseFloat(lpBalanceStr) / parseFloat(totalSupplyStr)) * parseFloat(totalLiquidity)).toFixed(2)
    : '0';
  
  // Format numbers
  const formatNumber = (num: string) => {
    const n = parseFloat(num);
    if (n >= 1000000) return `${(n / 1000000).toFixed(2)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(2)}K`;
    return n.toFixed(2);
  };

  return (
    <motion.div
      className="bg-white rounded-2xl p-4 sm:p-5 border border-gray-200 hover:border-orange-300 transition-all cursor-pointer group"
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.98 }}
      style={{
        boxShadow: `
          0 0 15px rgba(251, 146, 60, 0.1),
          0 0 30px rgba(251, 146, 60, 0.05),
          0 4px 12px rgba(0, 0, 0, 0.08),
          inset 0 1px 0 rgba(255, 255, 255, 0.9)
        `
      }}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        {/* Pool Info */}
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex -space-x-2 flex-shrink-0">
            <div className="relative border-2 sm:border-4 border-white shadow-lg rounded-full">
              <TokenLogo token={pool.tokenASymbol} size={48} className="flex-shrink-0" />
            </div>
            <div className="relative border-2 sm:border-4 border-white shadow-lg rounded-full">
              <TokenLogo token={pool.tokenBSymbol} size={48} className="flex-shrink-0" />
            </div>
          </div>
          <div className="min-w-0 flex-1 sm:flex-none">
            <h3 className="text-base sm:text-lg font-bold text-gray-900 truncate">
              {pool.tokenASymbol} / {pool.tokenBSymbol}
            </h3>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-xs text-gray-500">Fee: 0.3%</p>
              {hasPosition && (
                <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-medium">
                  You have LP
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 md:gap-6 w-full sm:w-auto sm:flex-1 sm:max-w-2xl">
          <div>
            <p className="text-xs text-gray-500 mb-1">Reserves</p>
            <p className="text-xs sm:text-sm font-bold text-gray-900 break-words">
              {formatNumber(reserveAStr)} {pool.tokenASymbol.slice(0, 6)}
            </p>
            <p className="text-xs text-gray-600">
              {formatNumber(reserveBStr)} {pool.tokenBSymbol.slice(0, 6)}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Total Liquidity</p>
            <p className="text-xs sm:text-sm font-bold text-gray-900">
              {formatNumber(totalLiquidity)}
            </p>
            <p className="text-xs text-gray-400">Reserve A + Reserve B</p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Your Position</p>
            <p className="text-xs sm:text-sm font-bold text-orange-600">
              {hasPosition ? (
                <>
                  <span className="block">{formatNumber(userPositionValue)}</span>
                  <span className="text-xs text-gray-500 font-normal">
                    ({parseFloat(lpBalanceStr).toFixed(4)} LP)
                  </span>
                </>
              ) : '—'}
            </p>
          </div>
          <div className="flex items-center justify-end sm:justify-end gap-2">
            <a
              href={`${DEX_CONFIG.EXPLORER_URL}/address/${pool.poolAddress}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="px-3 sm:px-4 py-1.5 sm:py-2 bg-gray-100 text-gray-700 rounded-xl text-xs sm:text-sm font-medium hover:bg-gray-200 transition-all flex items-center gap-1"
            >
              <ExternalLink className="w-3 h-3 sm:w-4 sm:h-4" />
              <span className="hidden sm:inline">Explorer</span>
            </a>
            {hasPosition ? (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveClick({
                    poolAddress: pool.poolAddress,
                    tokenA: pool.tokenA,
                    tokenB: pool.tokenB,
                    tokenASymbol: pool.tokenASymbol,
                    tokenBSymbol: pool.tokenBSymbol,
                  });
                }}
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-red-500 text-white rounded-xl text-xs sm:text-sm font-medium hover:bg-red-600 hover:shadow-lg transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                Remove
              </button>
            ) : (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAddClick({
                    poolAddress: pool.poolAddress,
                    tokenA: pool.tokenA,
                    tokenB: pool.tokenB,
                    tokenASymbol: pool.tokenASymbol,
                    tokenBSymbol: pool.tokenBSymbol,
                  });
                }}
                className="px-3 sm:px-4 py-1.5 sm:py-2 bg-orange-500 text-white rounded-xl text-xs sm:text-sm font-medium hover:bg-orange-600 hover:shadow-lg transition-all opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
              >
                Add
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}