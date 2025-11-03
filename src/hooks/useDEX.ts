import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits, type Address, isAddress } from 'viem';
import { DEX_CONFIG } from '../config/dex';
import { ERC20_ABI, POOL_ABI, FACTORY_ABI } from '../config/abis';

export type TokenSymbol = 'RAC' | 'RACD' | 'RACA' | 'USDC';

export interface TokenInfo {
  symbol: TokenSymbol;
  address: Address;
  decimals: number;
}

// USDC ERC-20 interface address on Arc Testnet (uses 6 decimals)
// Native USDC and ERC-20 interface share the same balance
// See: https://docs.arc.network/contract-addresses
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as Address;

export const TOKENS: Record<TokenSymbol, TokenInfo> = {
  RAC: { symbol: 'RAC', address: DEX_CONFIG.TOKENS.RAC as Address, decimals: 18 },
  RACD: { symbol: 'RACD', address: DEX_CONFIG.TOKENS.RACD as Address, decimals: 18 },
  RACA: { symbol: 'RACA', address: DEX_CONFIG.TOKENS.RACA as Address, decimals: 18 },
  USDC: { symbol: 'USDC', address: USDC_ADDRESS, decimals: 6 }, // USDC ERC-20 uses 6 decimals
};

// Get pool address for a token pair from factory
export function usePoolAddress(tokenA: Address | TokenSymbol, tokenB: Address | TokenSymbol) {
  const publicClient = usePublicClient();
  
  // Convert TokenSymbol to Address if needed
  const tokenAAddr: Address | undefined = typeof tokenA === 'string' && isAddress(tokenA)
    ? tokenA
    : typeof tokenA === 'string' && TOKENS[tokenA as TokenSymbol]
    ? TOKENS[tokenA as TokenSymbol].address
    : undefined;
    
  const tokenBAddr: Address | undefined = typeof tokenB === 'string' && isAddress(tokenB)
    ? tokenB
    : typeof tokenB === 'string' && TOKENS[tokenB as TokenSymbol]
    ? TOKENS[tokenB as TokenSymbol].address
    : undefined;

  // Sort tokens by address (factory stores pools with lower address first)
  const [sortedTokenA, sortedTokenB] = tokenAAddr && tokenBAddr
    ? tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase()
      ? [tokenAAddr, tokenBAddr]
      : [tokenBAddr, tokenAAddr]
    : [tokenAAddr, tokenBAddr];

  const { data: poolAddress } = useReadContract({
    address: DEX_CONFIG.FACTORY_ADDRESS as Address,
    abi: FACTORY_ABI,
    functionName: 'getPool',
    args: sortedTokenA && sortedTokenB ? [sortedTokenA, sortedTokenB] : undefined,
    query: { enabled: !!sortedTokenA && !!sortedTokenB && !!publicClient },
  });

  return (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') 
    ? (poolAddress as Address) 
    : null;
}

// Synchronous version for use in callbacks (requires publicClient)
export async function getPoolAddress(
  tokenA: Address | TokenSymbol,
  tokenB: Address | TokenSymbol,
  publicClient: any
): Promise<Address | null> {
  // Convert TokenSymbol to Address if needed
  const tokenAAddr: Address = typeof tokenA === 'string' && isAddress(tokenA)
    ? tokenA
    : typeof tokenA === 'string' && TOKENS[tokenA as TokenSymbol]
    ? TOKENS[tokenA as TokenSymbol].address
    : tokenA as Address;
    
  const tokenBAddr: Address = typeof tokenB === 'string' && isAddress(tokenB)
    ? tokenB
    : typeof tokenB === 'string' && TOKENS[tokenB as TokenSymbol]
    ? TOKENS[tokenB as TokenSymbol].address
    : tokenB as Address;

  if (!publicClient) return null;

  // Sort tokens by address (factory stores pools with lower address first)
  const [sortedTokenA, sortedTokenB] = tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase()
    ? [tokenAAddr, tokenBAddr]
    : [tokenBAddr, tokenAAddr];

  try {
    const poolAddress = await publicClient.readContract({
      address: DEX_CONFIG.FACTORY_ADDRESS as Address,
      abi: FACTORY_ABI,
      functionName: 'getPool',
      args: [sortedTokenA, sortedTokenB],
    }) as Address;

    return (poolAddress && poolAddress !== '0x0000000000000000000000000000000000000000') 
      ? poolAddress 
      : null;
  } catch (error) {
    return null;
  }
}

export function useDEX() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  // Approve token for swap (separate function)
  const approveForSwap = useCallback((token: TokenSymbol, poolAddress: Address) => {
    if (!address || !isConnected) throw new Error('Wallet not connected');
    
    const tokenInfo = TOKENS[token];
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    try {
      writeContract({
        address: tokenInfo.address,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [poolAddress, maxApproval],
      });
    } catch (err: any) {
      const errorStr = err.message || err.toString() || '';
      if (errorStr.includes('User rejected') || 
          errorStr.includes('User denied') || 
          errorStr.includes('rejected the request') ||
          errorStr.includes('denied transaction signature')) {
        throw new Error('User rejected approval');
      }
      throw err;
    }
  }, [address, isConnected, writeContract]);

  // Swap tokens (only performs swap, assumes approval is already done)
  const swap = useCallback(async (
    tokenA: TokenSymbol,
    tokenB: TokenSymbol,
    amountIn: string
  ) => {
    if (!address || !isConnected || !publicClient) throw new Error('Wallet not connected');
    
    const poolAddress = await getPoolAddress(tokenA, tokenB, publicClient);
    if (!poolAddress) throw new Error('Pool not found. Create the pool first.');

    const tokenAInfo = TOKENS[tokenA];
    const tokenBInfo = TOKENS[tokenB];
    const amountInWei = parseUnits(amountIn, tokenAInfo.decimals);

    // Determine which swap function to use based on token address order (same as pool stores them)
    const isTokenAFirst = tokenAInfo.address.toLowerCase() < tokenBInfo.address.toLowerCase();

    // Verify allowance before swapping
    const currentAllowance = await publicClient.readContract({
      address: tokenAInfo.address,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, poolAddress],
    });

    if (currentAllowance < amountInWei) {
      throw new Error('Insufficient allowance. Please approve first.');
    }

    // Perform swap using the correct function
    try {
      if (isTokenAFirst) {
        writeContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'swapAToB',
          args: [amountInWei, 0n, address], // 0 min output, send to user
        });
      } else {
        writeContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'swapBToA',
          args: [amountInWei, 0n, address], // 0 min output, send to user
        });
      }
    } catch (err: any) {
      const errorStr = err.message || err.toString() || '';
      if (errorStr.includes('User rejected') || 
          errorStr.includes('User denied') || 
          errorStr.includes('rejected the request') ||
          errorStr.includes('denied transaction signature')) {
        throw new Error('User rejected swap');
      }
      throw err;
    }
  }, [address, isConnected, writeContract, publicClient]);

  // Approve token for pool
  const approveToken = useCallback((token: TokenSymbol, poolAddress: Address) => {
    if (!address || !isConnected) throw new Error('Wallet not connected');
    
    const tokenInfo = TOKENS[token];
    const maxApproval = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');

    writeContract({
      address: tokenInfo.address,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [poolAddress, maxApproval],
    });
  }, [address, isConnected, writeContract]);

  // Add liquidity
  const addLiquidity = useCallback(async (
    tokenA: TokenSymbol,
    tokenB: TokenSymbol,
    amountA: string,
    amountB: string
  ) => {
    if (!address || !isConnected || !publicClient) throw new Error('Wallet not connected');
    
    const poolAddress = await getPoolAddress(tokenA, tokenB, publicClient);
    if (!poolAddress) throw new Error('Pool not found. Create the pool first.');

    const tokenAInfo = TOKENS[tokenA];
    const tokenBInfo = TOKENS[tokenB];
    const amountAWei = parseUnits(amountA, tokenAInfo.decimals);
    const amountBWei = parseUnits(amountB, tokenBInfo.decimals);

    // Check current allowances
    const [allowanceA, allowanceB] = await Promise.all([
      publicClient.readContract({
        address: tokenAInfo.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, poolAddress],
      }),
      publicClient.readContract({
        address: tokenBInfo.address,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [address, poolAddress],
      }),
    ]);

    // Check if approvals are needed
    if (allowanceA < amountAWei) {
      throw new Error('NEED_APPROVE_A');
    }

    if (allowanceB < amountBWei) {
      throw new Error('NEED_APPROVE_B');
    }

    // Both tokens approved, proceed with adding liquidity
    writeContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'addLiquidity',
      args: [amountAWei, amountBWei, 0n, 0n], // 0 min amounts for simplicity
    });
  }, [address, isConnected, writeContract, publicClient]);

  // Remove liquidity
  const removeLiquidity = useCallback(async (
    tokenA: TokenSymbol,
    tokenB: TokenSymbol,
    lpAmount: string
  ) => {
    if (!address || !isConnected || !publicClient) throw new Error('Wallet not connected');
    
    const poolAddress = await getPoolAddress(tokenA, tokenB, publicClient);
    if (!poolAddress) throw new Error('Pool not found. Create the pool first.');

    // Validate LP amount - parseUnits can't handle scientific notation or very small numbers
    const lpAmountNum = parseFloat(lpAmount);
    if (isNaN(lpAmountNum) || lpAmountNum <= 0) {
      throw new Error('Invalid LP amount. Please enter a valid amount.');
    }
    
    // Convert to fixed decimal string to avoid scientific notation issues
    // Use enough decimal places (18 for LP tokens) but avoid excessive precision
    const lpAmountFixed = lpAmountNum.toFixed(18).replace(/\.?0+$/, ''); // Remove trailing zeros
    if (parseFloat(lpAmountFixed) <= 0) {
      throw new Error('LP amount is too small. Please enter a larger amount.');
    }

    let lpAmountWei: bigint;
    try {
      lpAmountWei = parseUnits(lpAmountFixed, 18);
    } catch (error: any) {
      // If parseUnits still fails, provide a better error message
      if (error.message?.includes('InvalidDecimalNumberError') || error.message?.includes('not a valid decimal')) {
        throw new Error(`InvalidDecimalNumberError: Number \`${lpAmount}\` is not a valid decimal number. Please enter a valid amount.`);
      }
      throw error;
    }

    writeContract({
      address: poolAddress,
      abi: POOL_ABI,
      functionName: 'removeLiquidity',
      args: [lpAmountWei, 0n, 0n, address], // 0 min amounts, send tokens to user
    });
  }, [address, isConnected, writeContract, publicClient]);

  return {
    swap,
    addLiquidity,
    removeLiquidity,
    approveToken,
    approveForSwap,
    isPending,
    isConfirming,
    isSuccess,
    error,
    hash,
  };
}

// Hook versions for reading pool data
export function usePoolReserves(tokenA: Address | TokenSymbol, tokenB: Address | TokenSymbol) {
  const poolAddress = usePoolAddress(tokenA, tokenB);
  const publicClient = usePublicClient();
  
  // CRITICAL: Read actual token addresses from pool (pool stores tokens sorted by address)
  // Pool's tokenA = lower address, tokenB = higher address
  const { data: poolTokenA } = useReadContract({
    address: poolAddress || undefined,
    abi: POOL_ABI,
    functionName: 'tokenA',
    query: { enabled: !!poolAddress },
  });

  const { data: poolTokenB } = useReadContract({
    address: poolAddress || undefined,
    abi: POOL_ABI,
    functionName: 'tokenB',
    query: { enabled: !!poolAddress },
  });

  // Fetch decimals for the ACTUAL pool tokens (not function parameters!)
  const { data: tokenADecimalsRaw } = useReadContract({
    address: poolTokenA as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!poolTokenA },
  });

  const { data: tokenBDecimalsRaw } = useReadContract({
    address: poolTokenB as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!poolTokenB },
  });

  // Get decimals from TOKENS map if available, otherwise use fetched or default to 18
  const poolTokenALower = poolTokenA ? (poolTokenA as string).toLowerCase() : '';
  const poolTokenBLower = poolTokenB ? (poolTokenB as string).toLowerCase() : '';
  
  // Find token info from TOKENS map - MUST match exactly including case normalization
  const poolTokenAInfo = Object.values(TOKENS).find(t => {
    const tokenAddrLower = t.address.toLowerCase();
    return tokenAddrLower === poolTokenALower;
  });
  const poolTokenBInfo = Object.values(TOKENS).find(t => {
    const tokenAddrLower = t.address.toLowerCase();
    return tokenAddrLower === poolTokenBLower;
  });
  
  // Priority: 1) TOKENS map, 2) Fetched from contract, 3) Default 18
  // BUT: If we fetched decimals from contract, use them as fallback
  const finalTokenADecimals = poolTokenAInfo?.decimals ?? (tokenADecimalsRaw ? Number(tokenADecimalsRaw) : 18);
  const finalTokenBDecimals = poolTokenBInfo?.decimals ?? (tokenBDecimalsRaw ? Number(tokenBDecimalsRaw) : 18);
  
  // CRITICAL: Read ACTUAL token balances from ERC20 contracts (same as indexer does)
  // This is the source of truth - balances are always accurate!
  // Stored reserves might be stale if _update() wasn't called
  const { data: balanceA } = useReadContract({
    address: poolTokenA as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: poolAddress ? [poolAddress] : undefined,
    query: { enabled: !!poolAddress && !!poolTokenA },
  });

  const { data: balanceB } = useReadContract({
    address: poolTokenB as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: poolAddress ? [poolAddress] : undefined,
    query: { enabled: !!poolAddress && !!poolTokenB },
  });

  return {
    reserveA: balanceA ? formatUnits(balanceA, finalTokenADecimals) : '0',
    reserveB: balanceB ? formatUnits(balanceB, finalTokenBDecimals) : '0',
    poolAddress,
  };
}

export function useSwapOutput(tokenA: Address | TokenSymbol, tokenB: Address | TokenSymbol, amountIn: string) {
  const poolAddress = usePoolAddress(tokenA, tokenB);
  
  // Get actual reserves (from ERC20 balances, not stale pool state)
  const poolReserves = usePoolReserves(tokenA, tokenB);
  
  // Get token decimals
  const tokenAAddr: Address | undefined = typeof tokenA === 'string' && isAddress(tokenA)
    ? tokenA
    : typeof tokenA === 'string' && TOKENS[tokenA as TokenSymbol]
    ? TOKENS[tokenA as TokenSymbol].address
    : undefined;

  const tokenADecimals = typeof tokenA === 'string' && TOKENS[tokenA as TokenSymbol]
    ? TOKENS[tokenA as TokenSymbol].decimals
    : 18;
  
  const amountInValue = amountIn && !isNaN(parseFloat(amountIn)) && parseFloat(amountIn) > 0
    ? parseFloat(amountIn)
    : 0;

  // Determine if we're swapping tokenA (true) or tokenB (false)
  const tokenBAddr: Address | undefined = typeof tokenB === 'string' && isAddress(tokenB)
    ? tokenB
    : typeof tokenB === 'string' && TOKENS[tokenB as TokenSymbol]
    ? TOKENS[tokenB as TokenSymbol].address
    : undefined;
    
  const isTokenAFirst = tokenAAddr && tokenBAddr
    ? tokenAAddr.toLowerCase() < tokenBAddr.toLowerCase()
    : false;

  // Get decimals for output token
  const tokenBDecimals = typeof tokenB === 'string' && TOKENS[tokenB as TokenSymbol]
    ? TOKENS[tokenB as TokenSymbol].decimals
    : 18;

  // Calculate swap output using actual reserves (Uniswap V2 formula)
  // Formula: amountOut = (amountIn * 9970 * reserveOut) / (reserveIn * 10000 + amountIn * 9970)
  const calculatedAmountOut = useMemo(() => {
    if (!amountInValue || amountInValue <= 0 || !poolReserves.reserveA || !poolReserves.reserveB) {
      return '0';
    }

    const reserveA = parseFloat(poolReserves.reserveA);
    const reserveB = parseFloat(poolReserves.reserveB);
    
    if (reserveA <= 0 || reserveB <= 0) {
      return '0';
    }

    // Determine which reserve is input and which is output
    const reserveIn = isTokenAFirst ? reserveA : reserveB;
    const reserveOut = isTokenAFirst ? reserveB : reserveA;

    // Uniswap V2 formula with 0.3% fee (30 bps = 9970/10000)
    const FEE_BPS = 30; // 0.3%
    const amountInWithFee = amountInValue * (10000 - FEE_BPS); // 9970
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 10000) + amountInWithFee;
    const amountOut = numerator / denominator;

    return amountOut.toFixed(18); // Return as string with enough precision
  }, [amountInValue, poolReserves.reserveA, poolReserves.reserveB, isTokenAFirst, tokenA, tokenB, poolAddress]);

  return calculatedAmountOut;
}

export function useLPBalance(tokenA: Address | TokenSymbol, tokenB: Address | TokenSymbol) {
  const { address, isConnected } = useAccount();
  const poolAddress = usePoolAddress(tokenA, tokenB);
  
  const { data: balance } = useReadContract({
    address: poolAddress || undefined,
    abi: POOL_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!poolAddress && !!address && isConnected },
  });

  return balance ? formatUnits(balance, 18) : '0';
}

// Separate hooks for reading data
export function useTokenBalance(token: TokenSymbol | null | undefined) {
  const { address, isConnected, chainId } = useAccount();
  const tokenInfo = token ? TOKENS[token as TokenSymbol] : null;
  const isArcTestnet = chainId === 5042002;
  
  const { data: balance } = useReadContract({
    address: tokenInfo?.address as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && isConnected && !!tokenInfo && isArcTestnet },
  });

  if (!tokenInfo || !balance) return '0';
  return formatUnits(balance, tokenInfo.decimals);
}

export function useTokenAllowance(token: TokenSymbol, spender: Address | null) {
  const { address, isConnected } = useAccount();
  const tokenInfo = TOKENS[token];
  const { data: allowance } = useReadContract({
    address: tokenInfo.address,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: address && spender ? [address, spender] : undefined,
    query: { enabled: !!address && !!spender && isConnected },
  });

  return allowance || 0n;
}

