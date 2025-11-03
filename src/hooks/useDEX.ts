import { useState, useCallback, useEffect, useMemo } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi';
import { formatUnits, parseUnits, type Address, isAddress } from 'viem';
import { DEX_CONFIG } from '../config/dex';
import { ERC20_ABI, POOL_ABI, FACTORY_ABI } from '../config/abis';

export type TokenSymbol = 'SRAC' | 'RACS' | 'SACS' | 'USDC';

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
  SRAC: { symbol: 'SRAC', address: DEX_CONFIG.TOKENS.SRAC as Address, decimals: 18 },
  RACS: { symbol: 'RACS', address: DEX_CONFIG.TOKENS.RACS as Address, decimals: 18 },
  SACS: { symbol: 'SACS', address: DEX_CONFIG.TOKENS.SACS as Address, decimals: 18 },
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
    
    // CRITICAL: Read actual token addresses from pool (pool stores tokens sorted by address)
    // Pool's tokenA = lower address, tokenB = higher address
    const [poolTokenA, poolTokenB] = await Promise.all([
      publicClient.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'tokenA',
      }),
      publicClient.readContract({
        address: poolAddress,
        abi: POOL_ABI,
        functionName: 'tokenB',
      }),
    ]) as [Address, Address];

    // Determine which swap function to use based on pool's actual token order
    // Pool.tokenA = lower address, Pool.tokenB = higher address
    const userTokenAAddr = tokenAInfo.address.toLowerCase();
    const userTokenBAddr = tokenBInfo.address.toLowerCase();
    const poolTokenAAddr = (poolTokenA as string).toLowerCase();
    const poolTokenBAddr = (poolTokenB as string).toLowerCase();

    // Check if user's tokenA matches pool's tokenA or tokenB
    const isSwappingPoolTokenA = userTokenAAddr === poolTokenAAddr;
    const isSwappingPoolTokenB = userTokenAAddr === poolTokenBAddr;

    if (!isSwappingPoolTokenA && !isSwappingPoolTokenB) {
      throw new Error('Token mismatch: Input token does not match pool tokens');
    }

    // Convert amount to wei using input token decimals
    const amountInWei = parseUnits(amountIn, tokenAInfo.decimals);

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

    // Perform swap using the correct function based on pool's token order
    try {
      if (isSwappingPoolTokenA) {
        // User is swapping pool's tokenA for pool's tokenB
        writeContract({
          address: poolAddress,
          abi: POOL_ABI,
          functionName: 'swapAToB',
          args: [amountInWei, 0n, address], // 0 min output, send to user
        });
      } else {
        // User is swapping pool's tokenB for pool's tokenA
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
  const publicClient = usePublicClient();
  
  // WORKAROUND: Use contract's stored reserves instead of actual balances
  // This matches what the contract will actually calculate (even if reserves are stale)
  // The contract's swap functions use stored reserves, not actual balances
  const { data: contractReserveA } = useReadContract({
    address: poolAddress || undefined,
    abi: POOL_ABI,
    functionName: 'reserveA',
    query: { enabled: !!poolAddress },
  });

  const { data: contractReserveB } = useReadContract({
    address: poolAddress || undefined,
    abi: POOL_ABI,
    functionName: 'reserveB',
    query: { enabled: !!poolAddress },
  });
  
  // Read pool's token addresses to map reserves correctly
  
  // Get token addresses
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

  // CRITICAL: Read pool's actual tokenA and tokenB to match reserves correctly
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

  // Get decimals for pool tokens to format contract reserves
  const poolTokenAInfo = poolTokenA ? Object.values(TOKENS).find(t => 
    t.address.toLowerCase() === (poolTokenA as string).toLowerCase()
  ) : null;
  const poolTokenBInfo = poolTokenB ? Object.values(TOKENS).find(t => 
    t.address.toLowerCase() === (poolTokenB as string).toLowerCase()
  ) : null;

  const poolTokenADecimals = poolTokenAInfo?.decimals ?? 18;
  const poolTokenBDecimals = poolTokenBInfo?.decimals ?? 18;

  const tokenADecimals = typeof tokenA === 'string' && TOKENS[tokenA as TokenSymbol]
    ? TOKENS[tokenA as TokenSymbol].decimals
    : 18;
  
  const amountInValue = amountIn && !isNaN(parseFloat(amountIn)) && parseFloat(amountIn) > 0
    ? parseFloat(amountIn)
    : 0;

  // Get decimals for output token
  const tokenBDecimals = typeof tokenB === 'string' && TOKENS[tokenB as TokenSymbol]
    ? TOKENS[tokenB as TokenSymbol].decimals
    : 18;

  // CRITICAL: Determine which reserve is input and which is output based on pool's actual token order
  // poolReserves.reserveA corresponds to pool's tokenA, reserveB to pool's tokenB
  const isSwappingPoolTokenA = useMemo(() => {
    if (!tokenAAddr || !poolTokenA) return false;
    return (tokenAAddr as string).toLowerCase() === (poolTokenA as string).toLowerCase();
  }, [tokenAAddr, poolTokenA]);

  // CRITICAL: Use contract's stored reserves (what contract will actually use)
  // Not actual ERC20 balances, because contract's swap uses stored reserves!
  const calculatedAmountOut = useMemo(() => {
    if (!amountInValue || amountInValue <= 0 || !contractReserveA || !contractReserveB || !poolTokenA || !poolTokenB) {
      return '0';
    }

    // Contract reserves are in raw wei format - need to format them
    const reserveA = parseFloat(formatUnits(contractReserveA, poolTokenADecimals));
    const reserveB = parseFloat(formatUnits(contractReserveB, poolTokenBDecimals));
    
    if (reserveA <= 0 || reserveB <= 0) {
      return '0';
    }

    // CRITICAL: Match reserves to pool's token order, not user's input order
    // Contract's reserveA = pool's tokenA, reserveB = pool's tokenB
    const reserveIn = isSwappingPoolTokenA ? reserveA : reserveB;
    const reserveOut = isSwappingPoolTokenA ? reserveB : reserveA;

    // Uniswap V2 formula with 0.3% fee (30 bps = 9970/10000)
    const FEE_BPS = 30; // 0.3%
    const amountInWithFee = amountInValue * (10000 - FEE_BPS); // 9970
    const numerator = amountInWithFee * reserveOut;
    const denominator = (reserveIn * 10000) + amountInWithFee;
    const amountOut = numerator / denominator;

    return amountOut.toFixed(18); // Return as string with enough precision
  }, [amountInValue, contractReserveA, contractReserveB, isSwappingPoolTokenA, poolTokenA, poolTokenB, poolTokenADecimals, poolTokenBDecimals, poolAddress]);

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

