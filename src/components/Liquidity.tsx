import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Droplets, Plus, Minus, TrendingUp, Info, AlertCircle, ChevronDown, CheckCircle2, Loader2, X } from 'lucide-react';
import { useAccount, usePublicClient, useReadContract } from 'wagmi';
import { parseUnits, formatUnits, type Address } from 'viem';
import { useDEX, useTokenBalance, usePoolReserves, useLPBalance, useTokenAllowance, TOKENS, type TokenSymbol } from '../hooks/useDEX';
import { ERC20_ABI, FACTORY_ABI, POOL_ABI } from '../config/abis';
import { DEX_CONFIG } from '../config/dex';
import TokenLogo from './TokenLogo';

const AVAILABLE_TOKENS: TokenSymbol[] = ['SRAC', 'RACS', 'SACS', 'USDC'];

export default function Liquidity() {
  const { isConnected, address, chainId } = useAccount();
  const [tokenA, setTokenA] = useState<TokenSymbol>('SRAC');
  const [tokenB, setTokenB] = useState<TokenSymbol>('RACS');
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [lpAmount, setLpAmount] = useState('');
  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add');
  const [showTokenSelector, setShowTokenSelector] = useState<'A' | 'B' | null>(null);
  const [needsApproval, setNeedsApproval] = useState<{ tokenA: boolean; tokenB: boolean }>({ tokenA: false, tokenB: false });
  
  // For Remove Liquidity: Track user's LP positions
  interface UserLPPosition {
    poolAddress: Address;
    tokenA: Address;
    tokenB: Address;
    tokenASymbol: string;
    tokenBSymbol: string;
    lpBalance: string;
  }
  const [userLPPositions, setUserLPPositions] = useState<UserLPPosition[]>([]);
  const [selectedPoolForRemoval, setSelectedPoolForRemoval] = useState<Address | null>(null);

  const { addLiquidity, removeLiquidity, approveToken, isPending, isConfirming, isSuccess, error } = useDEX();
  const [approvalStep, setApprovalStep] = useState<'none' | 'approvingA' | 'approvingB' | 'adding'>('none');
  const [liquiditySuccess, setLiquiditySuccess] = useState(false);
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const publicClient = usePublicClient();

  // Format error message to be user-friendly
  const formatErrorMessage = (err: any): string => {
    if (!err) return 'Unknown error occurred';
    
    const errorStr = err.message || err.toString() || '';
    
    // User rejection errors
    if (errorStr.includes('User rejected') || 
        errorStr.includes('User denied') || 
        errorStr.includes('rejected the request') ||
        errorStr.includes('User rejected the request')) {
      return 'Transaction was cancelled. Please try again when ready.';
    }
    
    // Network errors
    if (errorStr.includes('network') || errorStr.includes('Network')) {
      return 'Network error. Please check your connection and try again.';
    }
    
    // Gas errors
    if (errorStr.includes('gas') || errorStr.includes('insufficient funds')) {
      return 'Insufficient funds for gas. Please ensure you have enough balance.';
    }
    
    // Allowance errors
    if (errorStr.includes('allowance') || errorStr.includes('Allowance')) {
      return 'Token approval failed. Please try approving again.';
    }
    
    // Pool errors
    if (errorStr.includes('Pool not found') || errorStr.includes('pool')) {
      return 'Pool not found. Please create the pool first.';
    }
    
    // Return sanitized error message (remove technical details)
    const cleanError = errorStr
      .replace(/Request Arguments:.*?(\n|$)/g, '')
      .replace(/Contract Call:.*?(\n|$)/g, '')
      .replace(/data:.*?(\n|$)/g, '')
      .replace(/sender:.*?(\n|$)/g, '')
      .replace(/Docs:.*?(\n|$)/g, '')
      .replace(/Version:.*?(\n|$)/g, '')
      .trim();
    
    return cleanError || 'An unexpected error occurred. Please try again.';
  };
  const tokenABalance = useTokenBalance(tokenA);
  const tokenBBalance = useTokenBalance(tokenB);
  const { reserveA, reserveB, poolAddress } = usePoolReserves(tokenA, tokenB);
  const lpBalance = useLPBalance(tokenA, tokenB);
  
  // Check allowances
  const allowanceA = useTokenAllowance(tokenA, poolAddress);
  const allowanceB = useTokenAllowance(tokenB, poolAddress);
  
  const isArcTestnet = chainId === 5042002;

  // Get pool count for fetching user's LP positions
  const { data: poolCount } = useReadContract({
    address: DEX_CONFIG.FACTORY_ADDRESS as Address,
    abi: FACTORY_ABI,
    functionName: 'allPoolsLength',
    query: { enabled: isArcTestnet && isConnected },
  });

  // Fetch all pools where user has LP tokens
  useEffect(() => {
    if (!isArcTestnet || !isConnected || !address || !publicClient || !poolCount || Number(poolCount) === 0) {
      setUserLPPositions([]);
      return;
    }

    const fetchUserLPPositions = async () => {
      const positions: UserLPPosition[] = [];
      const poolCountNum = Number(poolCount);

      for (let i = 0; i < poolCountNum; i++) {
        try {
          const poolAddress = await publicClient.readContract({
            address: DEX_CONFIG.FACTORY_ADDRESS as Address,
            abi: FACTORY_ABI,
            functionName: 'allPools',
            args: [BigInt(i)],
          }) as Address;

          if (!poolAddress || poolAddress === '0x0000000000000000000000000000000000000000') continue;

          // Get user's LP balance
          const lpBalance = await publicClient.readContract({
            address: poolAddress,
            abi: POOL_ABI,
            functionName: 'balanceOf',
            args: [address],
          }) as bigint;

          const lpBalanceStr = formatUnits(lpBalance, 18);
          
          // Only include pools where user has LP tokens
          if (parseFloat(lpBalanceStr) <= 0) continue;

          // Get token addresses
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

          positions.push({
            poolAddress,
            tokenA,
            tokenB,
            tokenASymbol: symbolA || tokenA.slice(0, 6) + '...',
            tokenBSymbol: symbolB || tokenB.slice(0, 6) + '...',
            lpBalance: lpBalanceStr,
          });
        } catch (error) {
          console.error(`Error fetching LP position ${i}:`, error);
        }
      }

      setUserLPPositions(positions);
      
      // Auto-select first pool if none selected and positions exist
      if (positions.length > 0) {
        setSelectedPoolForRemoval(prev => prev || positions[0].poolAddress);
      }
    };

    fetchUserLPPositions();
  }, [isArcTestnet, isConnected, address, publicClient, poolCount]);

  // Update tokenA and tokenB when selectedPoolForRemoval changes
  useEffect(() => {
    if (selectedPoolForRemoval && userLPPositions.length > 0) {
      const position = userLPPositions.find(p => p.poolAddress === selectedPoolForRemoval);
      if (position) {
        // Try to match token addresses to TokenSymbol, otherwise use addresses
        const tokenASymbolMatch = Object.entries(TOKENS).find(([_, info]) => 
          info.address.toLowerCase() === position.tokenA.toLowerCase()
        )?.[0] as TokenSymbol | undefined;
        
        const tokenBSymbolMatch = Object.entries(TOKENS).find(([_, info]) => 
          info.address.toLowerCase() === position.tokenB.toLowerCase()
        )?.[0] as TokenSymbol | undefined;

        if (tokenASymbolMatch) setTokenA(tokenASymbolMatch);
        if (tokenBSymbolMatch) setTokenB(tokenBSymbolMatch);
      }
    }
  }, [selectedPoolForRemoval, userLPPositions]);

  // Get selected pool's data for removal
  const selectedPoolPosition = userLPPositions.find(p => p.poolAddress === selectedPoolForRemoval);
  const selectedPoolLpBalance = selectedPoolPosition?.lpBalance || '0';
  
  // Get reserves directly from the selected pool address with correct decimals
  const { data: reserveARaw } = useReadContract({
    address: selectedPoolForRemoval || undefined,
    abi: POOL_ABI,
    functionName: 'reserveA',
    query: { enabled: !!selectedPoolForRemoval },
  });

  const { data: reserveBRaw } = useReadContract({
    address: selectedPoolForRemoval || undefined,
    abi: POOL_ABI,
    functionName: 'reserveB',
    query: { enabled: !!selectedPoolForRemoval },
  });

  // Get token decimals for proper formatting
  const selectedTokenADecimals = selectedPoolPosition
    ? (Object.entries(TOKENS).find(([_, info]) => 
        info.address.toLowerCase() === selectedPoolPosition.tokenA.toLowerCase()
      )?.[1]?.decimals) || 18
    : 18;

  const selectedTokenBDecimals = selectedPoolPosition
    ? (Object.entries(TOKENS).find(([_, info]) => 
        info.address.toLowerCase() === selectedPoolPosition.tokenB.toLowerCase()
      )?.[1]?.decimals) || 18
    : 18;

  // Format reserves with correct decimals
  const selectedReserveA = reserveARaw ? formatUnits(reserveARaw, selectedTokenADecimals) : '0';
  const selectedReserveB = reserveBRaw ? formatUnits(reserveBRaw, selectedTokenBDecimals) : '0';

  // Check if this is the first liquidity (pool exists but is empty)
  const isFirstLiquidity = !!poolAddress && parseFloat(reserveA) === 0 && parseFloat(reserveB) === 0;

  // Calculate initial price/ratio for first liquidity
  const calculateInitialPrice = () => {
    if (!isFirstLiquidity || !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0) return null;
    const ratio = parseFloat(amountB) / parseFloat(amountA);
    return ratio.toFixed(6);
  };

  // Calculate pool share for add liquidity
  const calculatePoolShare = () => {
    if (!amountA || !amountB || parseFloat(reserveA) === 0) return '0';
    const totalReserveA = parseFloat(reserveA) + parseFloat(amountA);
    const share = (parseFloat(amountA) / totalReserveA) * 100;
    return share.toFixed(2);
  };

  // Close token selector when clicking outside
  useEffect(() => {
    const handleClickOutside = () => {
      if (showTokenSelector) {
        setShowTokenSelector(null);
      }
    };
    if (showTokenSelector) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [showTokenSelector]);

  // Auto-calculate amountB when amountA changes (maintain pool ratio)
  useEffect(() => {
    if (activeTab === 'add' && amountA && parseFloat(reserveA) > 0 && parseFloat(reserveB) > 0) {
      const ratio = parseFloat(reserveB) / parseFloat(reserveA);
      setAmountB((parseFloat(amountA) * ratio).toFixed(6));
    } else if (!amountA) {
      setAmountB('');
    }
  }, [amountA, reserveA, reserveB, activeTab]);

  // Reset approval step when success
  useEffect(() => {
    if (isSuccess && approvalStep === 'adding') {
      setLiquiditySuccess(true);
      setApprovalStep('none');
      setTimeout(() => {
        setAmountA('');
        setAmountB('');
        setLiquiditySuccess(false);
      }, 3000);
    }
  }, [isSuccess, approvalStep]);

  // Auto-proceed after approval completes
  useEffect(() => {
    if (isSuccess && approvalStep !== 'none' && approvalStep !== 'adding' && poolAddress && address && publicClient) {
      // Approval completed, check fresh allowances and proceed
      const checkAndProceed = async () => {
        try {
          const tokenAInfo = TOKENS[tokenA];
          const tokenBInfo = TOKENS[tokenB];
          const amountAWei = parseUnits(amountA, tokenAInfo.decimals);
          const amountBWei = parseUnits(amountB, tokenBInfo.decimals);

          const [currentAllowanceA, currentAllowanceB] = await Promise.all([
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

          const needsA = currentAllowanceA < amountAWei;
          const needsB = currentAllowanceB < amountBWei;

          if (approvalStep === 'approvingA' && needsB) {
            // Need to approve token B
            approveToken(tokenB, poolAddress);
            setApprovalStep('approvingB');
          } else if (approvalStep === 'approvingA' && !needsB) {
            // Both approved, add liquidity
            setApprovalStep('adding');
            addLiquidity(tokenA, tokenB, amountA, amountB);
          } else if (approvalStep === 'approvingB' && !needsA) {
            // Both approved, add liquidity
            setApprovalStep('adding');
            addLiquidity(tokenA, tokenB, amountA, amountB);
          }
        } catch (err) {
          console.error('Error checking allowances:', err);
        }
      };

      const timer = setTimeout(checkAndProceed, 1500); // Wait for allowances to refresh
      return () => clearTimeout(timer);
    }
  }, [isSuccess, approvalStep, poolAddress, address, publicClient, tokenA, tokenB, amountA, amountB, approveToken, addLiquidity]);

  // Check if approvals are needed
  useEffect(() => {
    if (!poolAddress || !amountA || !amountB) {
      setNeedsApproval({ tokenA: false, tokenB: false });
      return;
    }

    const tokenAInfo = TOKENS[tokenA];
    const tokenBInfo = TOKENS[tokenB];
    const amountAWei = parseUnits(amountA, tokenAInfo.decimals);
    const amountBWei = parseUnits(amountB, tokenBInfo.decimals);

    setNeedsApproval({
      tokenA: allowanceA < amountAWei,
      tokenB: allowanceB < amountBWei,
    });
  }, [amountA, amountB, allowanceA, allowanceB, poolAddress, tokenA, tokenB]);

  const selectToken = (token: TokenSymbol, type: 'A' | 'B') => {
    if (type === 'A') {
      if (token === tokenB) {
        setTokenB(tokenA);
      }
      setTokenA(token);
    } else {
      if (token === tokenA) {
        setTokenA(tokenB);
      }
      setTokenB(token);
    }
    setShowTokenSelector(null);
  };

  const handleAmountChange = (value: string, type: 'A' | 'B') => {
    if (type === 'A') {
      setAmountA(value);
    } else {
      setAmountB(value);
    }
  };

  const handleAddLiquidity = async () => {
    if (!isConnected || !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0) return;
    if (!poolAddress) return;
    
    try {
      setErrorMessage(null);
      
      // If approvals needed, start with first approval
      if (needsApproval.tokenA) {
        setApprovalStep('approvingA');
        setShowProgressModal(true);
        approveToken(tokenA, poolAddress);
        return;
      }
      
      if (needsApproval.tokenB) {
        setApprovalStep('approvingB');
        setShowProgressModal(true);
        approveToken(tokenB, poolAddress);
        return;
      }

      // Both approved, add liquidity
      setApprovalStep('adding');
      setShowProgressModal(true);
      await addLiquidity(tokenA, tokenB, amountA, amountB);
    } catch (err: any) {
      console.error('Add liquidity error:', err);
      const friendlyError = formatErrorMessage(err);
      setErrorMessage(friendlyError);
      setApprovalStep('none');
      setShowProgressModal(false);
    }
  };

  const handleRemoveLiquidity = async () => {
    if (!isConnected || !lpAmount || parseFloat(lpAmount) <= 0) return;
    if (!selectedPoolPosition) return;
    
    try {
      // Ensure we don't try to remove more than available (prevent rounding errors)
      const availableBalance = parseFloat(selectedPoolLpBalance);
      const requestedAmount = parseFloat(lpAmount);
      
      // Use the minimum of requested amount and available balance to prevent ERC20InsufficientBalance
      const amountToRemove = Math.min(requestedAmount, availableBalance).toString();
      
      // Get the token symbols/addresses from the selected pool
      const poolTokenA = selectedPoolPosition.tokenASymbol;
      const poolTokenB = selectedPoolPosition.tokenBSymbol;
      
      // Try to match to TokenSymbol, otherwise use address
      const tokenAForRemove: TokenSymbol | Address = Object.entries(TOKENS).find(([_, info]) => 
        info.address.toLowerCase() === selectedPoolPosition.tokenA.toLowerCase()
      )?.[0] as TokenSymbol || selectedPoolPosition.tokenA;
      
      const tokenBForRemove: TokenSymbol | Address = Object.entries(TOKENS).find(([_, info]) => 
        info.address.toLowerCase() === selectedPoolPosition.tokenB.toLowerCase()
      )?.[0] as TokenSymbol || selectedPoolPosition.tokenB;
      
      await removeLiquidity(tokenAForRemove, tokenBForRemove, amountToRemove);
      if (isSuccess) {
        setTimeout(() => {
          setLpAmount('');
        }, 2000);
      }
    } catch (err: any) {
      console.error('Remove liquidity error:', err);
      alert(err.message || 'Remove liquidity failed');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto px-4">
      <motion.div
        className="bg-white rounded-3xl p-6 md:p-8 border border-gray-200 shadow-xl relative"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          boxShadow: `
            inset 0 1px 0 rgba(255, 255, 255, 0.8),
            inset 0 -1px 0 rgba(0, 0, 0, 0.1),
            0 20px 40px rgba(0, 0, 0, 0.1),
            0 8px 16px rgba(0, 0, 0, 0.08)
          `
        }}
      >

        {/* Header */}
        <div className="mb-6 relative z-10">
          <div className="flex items-center gap-2 mb-2">
            <Droplets className="w-6 h-6 md:w-7 md:h-7 text-orange-600" />
            <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Liquidity</h2>
          </div>
          <p className="text-sm md:text-base text-gray-600 flex items-center gap-2">
            <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium">Arc Testnet Only</span>
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex gap-2 mb-6 p-1 bg-gray-100 rounded-xl relative z-10">
          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg font-semibold text-xs sm:text-sm transition-all ${
              activeTab === 'add'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-gray-600 hover:text-gray-900 bg-white'
            }`}
          >
            <div className="flex items-center justify-center gap-1 sm:gap-2">
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>Add</span>
            </div>
          </button>
          <button
            onClick={() => setActiveTab('remove')}
            className={`flex-1 py-2.5 sm:py-3 px-3 sm:px-4 rounded-lg font-semibold text-xs sm:text-sm transition-all ${
              activeTab === 'remove'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-gray-600 hover:text-gray-900 bg-white'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Minus className="w-4 h-4" />
              <span>Remove</span>
            </div>
          </button>
        </div>

        {/* Add Liquidity */}
        {activeTab === 'add' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4 relative z-10"
          >
            {/* Token A */}
            <div className="bg-orange-50 rounded-2xl p-3 sm:p-4 border border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-600 font-medium">Token A</span>
                <span className="text-xs text-gray-500 hidden sm:inline">
                  Balance: {parseFloat(tokenABalance).toFixed(4)}
                </span>
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amountA}
                    onChange={(e) => handleAmountChange(e.target.value, 'A')}
                    placeholder="0.0"
                    className="w-full text-xl md:text-2xl lg:text-3xl font-bold bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
                  />
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTokenSelector(showTokenSelector === 'A' ? null : 'A');
                    }}
                    className="flex items-center justify-between sm:justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 bg-white rounded-xl hover:bg-gray-50 transition-all border border-gray-200 w-full sm:w-auto"
                  >
                    <div className="flex items-center gap-2">
                      <TokenLogo token={tokenA} size={28} className="flex-shrink-0" />
                      <span className="font-semibold text-gray-900 text-xs sm:text-sm">{tokenA}</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-600 hidden sm:block" />
                  </button>
                  {showTokenSelector === 'A' && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 bg-white rounded-xl border border-gray-200 shadow-2xl z-[100] min-w-[200px] w-full sm:w-auto max-h-[300px] overflow-y-auto"
                    >
                      {AVAILABLE_TOKENS.map((token) => (
                        <button
                          key={token}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectToken(token, 'A');
                          }}
                          className={`w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl ${
                            tokenA === token ? 'bg-orange-50' : ''
                          }`}
                        >
                          <TokenLogo token={token} size={32} className="flex-shrink-0" />
                          <span className="font-semibold text-gray-900">{token}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Plus Icon */}
            <div className="flex justify-center -my-2">
              <div className="p-2 bg-white/60 rounded-full border border-white/40">
                <Plus className="w-5 h-5 text-gray-600" />
              </div>
            </div>

            {/* Token B */}
            <div className="bg-orange-50 rounded-2xl p-4 border border-orange-200">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-600 font-medium">Token B</span>
                <span className="text-xs text-gray-500 hidden sm:inline">
                  Balance: {parseFloat(tokenBBalance).toFixed(4)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1">
                  <input
                    type="number"
                    value={amountB}
                    onChange={(e) => handleAmountChange(e.target.value, 'B')}
                    placeholder="0.0"
                    className="w-full text-xl md:text-2xl lg:text-3xl font-bold bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
                  />
                </div>
                <div className="relative">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowTokenSelector(showTokenSelector === 'B' ? null : 'B');
                    }}
                    className="flex items-center justify-between sm:justify-center gap-2 px-3 sm:px-4 py-2.5 sm:py-2 bg-white rounded-xl hover:bg-gray-50 transition-all border border-gray-200 w-full sm:w-auto"
                  >
                    <div className="flex items-center gap-2">
                      <TokenLogo token={tokenB} size={28} className="flex-shrink-0" />
                      <span className="font-semibold text-gray-900 text-xs sm:text-sm">{tokenB}</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-600 hidden sm:block" />
                  </button>
                  {showTokenSelector === 'B' && (
                    <div 
                      onClick={(e) => e.stopPropagation()}
                      className="absolute top-full mt-2 left-0 sm:left-auto sm:right-0 bg-white rounded-xl border border-gray-200 shadow-2xl z-[100] min-w-[200px] w-full sm:w-auto max-h-[300px] overflow-y-auto"
                    >
                      {AVAILABLE_TOKENS.map((token) => (
                        <button
                          key={token}
                          onClick={(e) => {
                            e.stopPropagation();
                            selectToken(token, 'B');
                          }}
                          className={`w-full px-4 py-3 flex items-center gap-2 hover:bg-gray-50 first:rounded-t-xl last:rounded-b-xl ${
                            tokenB === token ? 'bg-orange-50' : ''
                          }`}
                        >
                          <TokenLogo token={token} size={32} className="flex-shrink-0" />
                          <span className="font-semibold text-gray-900">{token}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Initial Price Info (First Liquidity) */}
            {isFirstLiquidity && amountA && amountB && parseFloat(amountA) > 0 && parseFloat(amountB) > 0 && (
              <div className="p-4 bg-orange-50 rounded-xl border-2 border-orange-300">
                <div className="flex items-start gap-2 mb-2">
                  <AlertCircle className="w-5 h-5 text-orange-600 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-orange-900">
                        Setting Initial Price
                      </span>
                    </div>
                    <div className="mt-2 p-2 bg-white rounded-lg border border-orange-200">
                      <div className="text-xs text-gray-600 mb-1">Price Ratio:</div>
                      <div className="text-lg font-bold text-orange-700">
                        1 {tokenA} = {calculateInitialPrice()} {tokenB}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        Or: 1 {tokenB} = {(1 / parseFloat(calculateInitialPrice() || '1')).toFixed(6)} {tokenA}
                      </div>
                    </div>
                    <p className="text-xs text-orange-800 mt-2">
                      ⚠️ You're creating the pool! This ratio will become the initial trading price.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Pool Share Info (Existing Pool) */}
            {!isFirstLiquidity && amountA && amountB && parseFloat(amountA) > 0 && (
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <TrendingUp className="w-4 h-4" />
                    Pool Share
                  </span>
                  <span className="font-bold text-gray-900">{calculatePoolShare()}%</span>
                </div>
                <p className="text-xs text-gray-500">
                  You'll receive LP tokens representing your share of the pool
                </p>
              </div>
            )}

            {/* Warning for wrong network */}
            {isConnected && !isArcTestnet && (
              <div className="p-3 bg-red-50/80 rounded-xl border border-red-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-medium">Wrong Network</p>
                  <p className="text-xs mt-1">Please switch to Arc Testnet</p>
                </div>
              </div>
            )}

            {/* Warning for unconnected wallet */}
            {!isConnected && (
              <div className="p-3 bg-yellow-50/80 rounded-xl border border-yellow-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium">Connect Wallet</p>
                  <p className="text-xs mt-1">Connect your wallet to add liquidity</p>
                </div>
              </div>
            )}

            {/* Success Message - Only show when liquidity is actually added */}
            {liquiditySuccess && (
              <div className="p-3 bg-green-50/80 rounded-xl border border-green-200/50 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-green-800">
                  <p className="font-medium">
                    {isFirstLiquidity ? 'Pool Created Successfully!' : 'Liquidity Added Successfully!'}
                  </p>
                </div>
              </div>
            )}

            {/* Error Message - Only show when not in modal */}
            {errorMessage && !showProgressModal && (
              <div className="p-3 bg-red-50/80 rounded-xl border border-red-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-medium">Transaction Failed</p>
                  <p className="text-xs mt-1">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Info about approvals needed */}
            {(needsApproval.tokenA || needsApproval.tokenB) && approvalStep === 'none' && (
              <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 flex items-start gap-2">
                <Info className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Approval Required</p>
                  <p className="text-xs mt-1">
                    You'll need to approve {needsApproval.tokenA && needsApproval.tokenB ? `both ${tokenA} and ${tokenB}` : needsApproval.tokenA ? tokenA : tokenB} first, then add liquidity.
                  </p>
                </div>
              </div>
            )}

            {/* Single unified button that handles everything */}
            <motion.button
              onClick={handleAddLiquidity}
              disabled={
                !isConnected || 
                !isArcTestnet || 
                !amountA || 
                !amountB || 
                parseFloat(amountA) <= 0 || 
                parseFloat(amountB) <= 0 || 
                isPending || 
                isConfirming ||
                (approvalStep !== 'none' && approvalStep !== 'adding' && !isSuccess)
              }
              className={`w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                !isConnected || 
                !isArcTestnet || 
                !amountA || 
                !amountB || 
                parseFloat(amountA) <= 0 || 
                parseFloat(amountB) <= 0 || 
                isPending || 
                isConfirming ||
                (approvalStep !== 'none' && approvalStep !== 'adding')
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-orange-500 text-white hover:bg-orange-600 hover:shadow-lg active:scale-95'
              }`}
              whileHover={
                !isConnected || 
                !isArcTestnet || 
                !amountA || 
                !amountB || 
                parseFloat(amountA) <= 0 || 
                parseFloat(amountB) <= 0 || 
                isPending || 
                isConfirming ||
                (approvalStep !== 'none' && approvalStep !== 'adding')
                  ? {} 
                  : { scale: 1.02 }
              }
              whileTap={
                !isConnected || 
                !isArcTestnet || 
                !amountA || 
                !amountB || 
                parseFloat(amountA) <= 0 || 
                parseFloat(amountB) <= 0 || 
                isPending || 
                isConfirming ||
                (approvalStep !== 'none' && approvalStep !== 'adding')
                  ? {} 
                  : { scale: 0.98 }
              }
            >
              {(isPending || isConfirming) && <Loader2 className="w-5 h-5 animate-spin" />}
              {!isConnected
                ? 'Connect Wallet'
                : !isArcTestnet
                ? 'Switch to Arc Testnet'
                : !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0
                ? 'Enter Amounts'
                : approvalStep === 'approvingA'
                ? `Approving ${tokenA}...`
                : approvalStep === 'approvingB'
                ? `Approving ${tokenB}...`
                : approvalStep === 'adding'
                ? 'Adding Liquidity...'
                : needsApproval.tokenA || needsApproval.tokenB
                ? 'Approve & Add Liquidity'
                : 'Add Liquidity'}
            </motion.button>

            {/* Progress Modal */}
            <AnimatePresence>
              {showProgressModal && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
                  onClick={() => {
                    // Don't close on background click during transaction
                    if (!isPending && !isConfirming) {
                      setShowProgressModal(false);
                    }
                  }}
                >
                  <motion.div
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl"
                  >
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-xl font-bold text-gray-900">Add Liquidity Progress</h3>
                      {!isPending && !isConfirming && (
                        <button
                          onClick={() => setShowProgressModal(false)}
                          className="text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      )}
                    </div>

                    <div className="space-y-6">
                      {/* Approve Token A Step */}
                      {needsApproval.tokenA && (
                        <div className="flex items-center gap-4">
                          <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                            approvalStep === 'approvingA' && (isPending || isConfirming)
                              ? 'bg-orange-500'
                              : approvalStep === 'approvingB' || approvalStep === 'adding' || isSuccess
                              ? 'bg-green-500'
                              : 'bg-gray-200'
                          }`}>
                            {approvalStep === 'approvingA' && (isPending || isConfirming) ? (
                              <Loader2 className="w-6 h-6 text-white animate-spin" />
                            ) : approvalStep === 'approvingB' || approvalStep === 'adding' || isSuccess ? (
                              <CheckCircle2 className="w-6 h-6 text-white" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className={`font-semibold ${
                              approvalStep === 'approvingA' && (isPending || isConfirming)
                                ? 'text-orange-600'
                                : approvalStep === 'approvingB' || approvalStep === 'adding' || isSuccess
                                ? 'text-green-600'
                                : 'text-gray-500'
                            }`}>
                              Approving {tokenA}
                            </p>
                            <p className="text-sm text-gray-500">
                              Allow the contract to spend your {tokenA} tokens
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Approve Token B Step */}
                      {needsApproval.tokenB && (
                        <div className="flex items-center gap-4">
                          <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                            approvalStep === 'approvingB' && (isPending || isConfirming)
                              ? 'bg-orange-500'
                              : approvalStep === 'adding' || isSuccess
                              ? 'bg-green-500'
                              : 'bg-gray-200'
                          }`}>
                            {approvalStep === 'approvingB' && (isPending || isConfirming) ? (
                              <Loader2 className="w-6 h-6 text-white animate-spin" />
                            ) : approvalStep === 'adding' || isSuccess ? (
                              <CheckCircle2 className="w-6 h-6 text-white" />
                            ) : (
                              <div className="w-6 h-6 rounded-full bg-white" />
                            )}
                          </div>
                          <div className="flex-1">
                            <p className={`font-semibold ${
                              approvalStep === 'approvingB' && (isPending || isConfirming)
                                ? 'text-orange-600'
                                : approvalStep === 'adding' || isSuccess
                                ? 'text-green-600'
                                : 'text-gray-500'
                            }`}>
                              Approving {tokenB}
                            </p>
                            <p className="text-sm text-gray-500">
                              Allow the contract to spend your {tokenB} tokens
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Add Liquidity Step */}
                      <div className="flex items-center gap-4">
                        <div className={`flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center ${
                          approvalStep === 'adding' && (isPending || isConfirming)
                            ? 'bg-orange-500'
                            : isSuccess
                            ? 'bg-green-500'
                            : 'bg-gray-200'
                        }`}>
                          {approvalStep === 'adding' && (isPending || isConfirming) ? (
                            <Loader2 className="w-6 h-6 text-white animate-spin" />
                          ) : isSuccess ? (
                            <CheckCircle2 className="w-6 h-6 text-white" />
                          ) : (
                            <div className="w-6 h-6 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1">
                          <p className={`font-semibold ${
                            approvalStep === 'adding' && (isPending || isConfirming)
                              ? 'text-orange-600'
                              : isSuccess
                              ? 'text-green-600'
                              : 'text-gray-500'
                          }`}>
                            Adding Liquidity
                          </p>
                          <p className="text-sm text-gray-500">
                            {approvalStep === 'adding' && isPending ? 'Waiting for confirmation...' : isSuccess ? 'Liquidity added!' : 'Pending...'}
                          </p>
                        </div>
                      </div>

                      {/* Success Message */}
                      {isSuccess && approvalStep === 'adding' && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 p-4 bg-green-50 rounded-xl border border-green-200"
                        >
                          <p className="text-sm font-medium text-green-800 text-center">
                            {isFirstLiquidity ? 'Pool created and liquidity added successfully! 🎉' : 'Liquidity added successfully! 🎉'}
                          </p>
                        </motion.div>
                      )}

                      {/* Error Message */}
                      {errorMessage && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="mt-4 p-4 bg-red-50 rounded-xl border border-red-200"
                        >
                          <p className="text-sm font-medium text-red-800">
                            Transaction Failed
                          </p>
                          <p className="text-xs text-red-600 mt-1">{errorMessage}</p>
                        </motion.div>
                      )}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Remove Liquidity */}
        {activeTab === 'remove' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4 relative z-10"
          >
            {/* Pool Selection - Show list if user has multiple LP positions */}
            {userLPPositions.length > 1 ? (
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="text-sm text-gray-600 mb-3 font-medium">Select Pool</div>
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {userLPPositions.map((position) => (
                    <button
                      key={position.poolAddress}
                      onClick={() => {
                        setSelectedPoolForRemoval(position.poolAddress);
                        setLpAmount(''); // Reset amount when switching pools
                      }}
                      className={`w-full p-3 rounded-lg border-2 transition-all ${
                        selectedPoolForRemoval === position.poolAddress
                          ? 'bg-orange-50 border-orange-500'
                          : 'bg-white border-gray-200 hover:border-orange-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="flex -space-x-2">
                            <div className="border-2 border-white rounded-full">
                              <TokenLogo token={position.tokenASymbol} size={32} />
                            </div>
                            <div className="border-2 border-white rounded-full">
                              <TokenLogo token={position.tokenBSymbol} size={32} />
                            </div>
                          </div>
                          <div>
                            <div className="text-base font-bold text-gray-900">
                              {position.tokenASymbol} / {position.tokenBSymbol}
                            </div>
                            <div className="text-xs text-gray-500">
                              {parseFloat(position.lpBalance).toFixed(4)} LP
                            </div>
                          </div>
                        </div>
                        {selectedPoolForRemoval === position.poolAddress && (
                          <CheckCircle2 className="w-5 h-5 text-orange-600" />
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : userLPPositions.length === 1 ? (
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="text-sm text-gray-600 mb-2">Pool</div>
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-2">
                    <div className="border-2 border-white rounded-full">
                      <TokenLogo token={userLPPositions[0].tokenASymbol} size={40} />
                    </div>
                    <div className="border-2 border-white rounded-full">
                      <TokenLogo token={userLPPositions[0].tokenBSymbol} size={40} />
                    </div>
                  </div>
                  <div className="text-lg font-bold text-gray-900">
                    {userLPPositions[0].tokenASymbol} / {userLPPositions[0].tokenBSymbol}
                  </div>
                </div>
              </div>
            ) : isConnected && isArcTestnet ? (
              <div className="p-4 bg-yellow-50 rounded-xl border border-yellow-200">
                <div className="flex items-center gap-2 text-yellow-800">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">No LP positions found</span>
                </div>
                <p className="text-xs text-yellow-700 mt-2">You don't have any liquidity positions to remove.</p>
              </div>
            ) : null}

            {/* LP Tokens Input - Only show if pool is selected */}
            {selectedPoolPosition && (
              <div className="bg-orange-50 rounded-2xl p-3 sm:p-4 border border-orange-200">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-600 font-medium">LP Tokens</span>
                  <span className="text-xs text-gray-500 hidden sm:inline">
                    Balance: {parseFloat(selectedPoolLpBalance).toFixed(4)}
                  </span>
                </div>
                <input
                  type="number"
                  value={lpAmount}
                  onChange={(e) => {
                    const value = e.target.value;
                    const numValue = parseFloat(value);
                    // Cap at available balance to prevent rounding errors
                    if (!isNaN(numValue) && selectedPoolPosition) {
                      const maxBalance = parseFloat(selectedPoolLpBalance);
                      if (numValue > maxBalance) {
                        setLpAmount(maxBalance.toString());
                        return;
                      }
                    }
                    setLpAmount(value);
                  }}
                  placeholder="0.0"
                  max={selectedPoolPosition ? parseFloat(selectedPoolLpBalance) : undefined}
                  className="w-full text-xl sm:text-2xl md:text-3xl font-bold bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
                />
                {selectedPoolPosition && (
                  <button
                    onClick={() => setLpAmount(selectedPoolLpBalance)}
                    className="text-xs text-orange-600 hover:text-orange-700 font-medium mt-1"
                  >
                    Max
                  </button>
                )}
              </div>
            )}

            {/* Remove Info */}
            {lpAmount && parseFloat(lpAmount) > 0 && selectedPoolPosition && (
              <div className="p-3 sm:p-4 bg-gray-50 rounded-xl border border-gray-200">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-4 h-4 text-orange-600" />
                  <span className="text-sm font-medium text-gray-700">You'll Receive</span>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenLogo token={selectedPoolPosition.tokenASymbol} size={20} />
                      <span className="text-gray-600">{selectedPoolPosition.tokenASymbol}</span>
                    </div>
                    <span className="font-bold text-gray-900">
                      {parseFloat(selectedPoolLpBalance) > 0 
                        ? ((parseFloat(lpAmount) / parseFloat(selectedPoolLpBalance)) * parseFloat(selectedReserveA)).toFixed(6)
                        : '0.00'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <TokenLogo token={selectedPoolPosition.tokenBSymbol} size={20} />
                      <span className="text-gray-600">{selectedPoolPosition.tokenBSymbol}</span>
                    </div>
                    <span className="font-bold text-gray-900">
                      {parseFloat(selectedPoolLpBalance) > 0 
                        ? ((parseFloat(lpAmount) / parseFloat(selectedPoolLpBalance)) * parseFloat(selectedReserveB)).toFixed(6)
                        : '0.00'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Warning for wrong network */}
            {isConnected && !isArcTestnet && (
              <div className="p-3 bg-red-50/80 rounded-xl border border-red-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-medium">Wrong Network</p>
                  <p className="text-xs mt-1">Please switch to Arc Testnet</p>
                </div>
              </div>
            )}

            {/* Warning for unconnected wallet */}
            {!isConnected && (
              <div className="p-3 bg-yellow-50/80 rounded-xl border border-yellow-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-yellow-800">
                  <p className="font-medium">Connect Wallet</p>
                  <p className="text-xs mt-1">Connect your wallet to remove liquidity</p>
                </div>
              </div>
            )}

            {/* Success Message */}
            {isSuccess && (
              <div className="p-3 bg-green-50/80 rounded-xl border border-green-200/50 flex items-start gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-green-800">
                  <p className="font-medium">Liquidity Removed Successfully!</p>
                </div>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="p-3 bg-red-50/80 rounded-xl border border-red-200/50 flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-red-800">
                  <p className="font-medium">Transaction Failed</p>
                  <p className="text-xs mt-1">{error.message || 'Unknown error'}</p>
                </div>
              </div>
            )}

            {/* Remove Liquidity Button */}
            <motion.button
              onClick={handleRemoveLiquidity}
              disabled={!isConnected || !isArcTestnet || !selectedPoolPosition || !lpAmount || parseFloat(lpAmount) <= 0 || isPending || isConfirming}
              className={`w-full py-3 sm:py-4 rounded-xl font-bold text-base sm:text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                !isConnected || !isArcTestnet || !selectedPoolPosition || !lpAmount || parseFloat(lpAmount) <= 0 || isPending || isConfirming
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-orange-500 text-white hover:bg-orange-600 hover:shadow-lg active:scale-95'
              }`}
              whileHover={!isConnected || !isArcTestnet || !selectedPoolPosition || !lpAmount || parseFloat(lpAmount) <= 0 || isPending || isConfirming ? {} : { scale: 1.02 }}
              whileTap={!isConnected || !isArcTestnet || !selectedPoolPosition || !lpAmount || parseFloat(lpAmount) <= 0 || isPending || isConfirming ? {} : { scale: 0.98 }}
            >
              {(isPending || isConfirming) && <Loader2 className="w-5 h-5 animate-spin" />}
              {!isConnected
                ? 'Connect Wallet'
                : !isArcTestnet
                ? 'Switch to Arc Testnet'
                : !lpAmount || parseFloat(lpAmount) <= 0
                ? 'Enter LP Amount'
                : isPending || isConfirming
                ? 'Processing...'
                : 'Remove Liquidity'}
            </motion.button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
