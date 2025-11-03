import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react';
import { useAccount, useReadContract, usePublicClient } from 'wagmi';
import { formatUnits, isAddress, parseUnits, type Address } from 'viem';
import { useDEX, useTokenBalance, usePoolReserves, TOKENS, type TokenSymbol } from '../hooks/useDEX';
import { ERC20_ABI } from '../config/abis';
import TokenLogo from './TokenLogo';

interface AddLiquidityModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenA: string; // Token address or symbol
  tokenB: string; // Token address or symbol
  tokenASymbol: string;
  tokenBSymbol: string;
}

export default function AddLiquidityModal({
  isOpen,
  onClose,
  tokenA,
  tokenB,
  tokenASymbol,
  tokenBSymbol,
}: AddLiquidityModalProps) {
  const { address: walletAddress, isConnected: walletConnected, chainId } = useAccount();
  const isArcTestnet = chainId === 5042002;
  const publicClient = usePublicClient();

  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [approvalStep, setApprovalStep] = useState<'none' | 'approvingA' | 'approvingB' | 'adding'>('none');
  const [showProgressModal, setShowProgressModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [liquiditySuccess, setLiquiditySuccess] = useState(false);
  const [modalManuallyClosed, setModalManuallyClosed] = useState(false);

  // Get token symbols (convert addresses to symbols if needed)
  const tokenAInfo = useMemo(() => {
    // Try to find in TOKENS by address or symbol
    const tokenEntry = Object.entries(TOKENS).find(
      ([tokenSymbol, info]) => 
        info.address.toLowerCase() === tokenA.toLowerCase() || 
        tokenSymbol.toLowerCase() === tokenA.toLowerCase()
    );
    return tokenEntry ? { tokenSymbol: tokenEntry[0] as TokenSymbol, ...tokenEntry[1] } : null;
  }, [tokenA]);

  const tokenBInfo = useMemo(() => {
    const tokenEntry = Object.entries(TOKENS).find(
      ([tokenSymbol, info]) => 
        info.address.toLowerCase() === tokenB.toLowerCase() || 
        tokenSymbol.toLowerCase() === tokenB.toLowerCase()
    );
    return tokenEntry ? { tokenSymbol: tokenEntry[0] as TokenSymbol, ...tokenEntry[1] } : null;
  }, [tokenB]);

  const finalTokenA = tokenAInfo?.tokenSymbol || (tokenASymbol as TokenSymbol);
  const finalTokenB = tokenBInfo?.tokenSymbol || (tokenBSymbol as TokenSymbol);

  const { addLiquidity, approveToken, isPending, isConfirming, isSuccess, error, hash } = useDEX();
  
  // Get token addresses
  const tokenAAddress = tokenAInfo?.address || (isAddress(tokenA) ? tokenA : undefined);
  const tokenBAddress = tokenBInfo?.address || (isAddress(tokenB) ? tokenB : undefined);
  
  // Get decimals directly from contracts if not in TOKENS map
  const { data: tokenADecimalsRaw } = useReadContract({
    address: tokenAAddress as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!tokenAAddress && !tokenAInfo },
  });
  
  const { data: tokenBDecimalsRaw } = useReadContract({
    address: tokenBAddress as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'decimals',
    query: { enabled: !!tokenBAddress && !tokenBInfo },
  });

  // Read balance directly from contract addresses (works for all tokens)
  const { data: balanceARaw } = useReadContract({
    address: tokenAAddress as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress && walletConnected && !!tokenAAddress && isArcTestnet },
  });
  
  const { data: balanceBRaw } = useReadContract({
    address: tokenBAddress as Address | undefined,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress && walletConnected && !!tokenBAddress && isArcTestnet },
  });

  // Get decimals (prefer from TOKENS map, otherwise from contract, default to 18)
  const tokenADecimals = tokenAInfo?.decimals || (tokenADecimalsRaw ? Number(tokenADecimalsRaw) : 18);
  const tokenBDecimals = tokenBInfo?.decimals || (tokenBDecimalsRaw ? Number(tokenBDecimalsRaw) : 18);

  // Format balances
  const balanceA = useMemo(() => {
    if (!balanceARaw) return '0';
    return formatUnits(balanceARaw, tokenADecimals);
  }, [balanceARaw, tokenADecimals]);

  const balanceB = useMemo(() => {
    if (!balanceBRaw) return '0';
    return formatUnits(balanceBRaw, tokenBDecimals);
  }, [balanceBRaw, tokenBDecimals]);

  const poolReserves = usePoolReserves(
    (tokenAInfo?.address || tokenA) as Address,
    (tokenBInfo?.address || tokenB) as Address
  );

  // Check if this is the first liquidity (pool has zero reserves)
  const isFirstLiquidity = useMemo(() => {
    const reserveA = parseFloat(poolReserves.reserveA || '0');
    const reserveB = parseFloat(poolReserves.reserveB || '0');
    return reserveA === 0 && reserveB === 0;
  }, [poolReserves]);

  // Calculate current price from reserves (only if pool has liquidity)
  // Price shows: 1 tokenA = X tokenB (how many tokenB per tokenA)
  const currentPrice = useMemo(() => {
    if (isFirstLiquidity) return null; // No price for new pools
    if (!poolReserves.reserveA || !poolReserves.reserveB || parseFloat(poolReserves.reserveA) <= 0) return null;
    // ReserveA = tokenA, ReserveB = tokenB
    // Price = reserveB / reserveA (how many tokenB per tokenA)
    return parseFloat(poolReserves.reserveB) / parseFloat(poolReserves.reserveA);
  }, [poolReserves, isFirstLiquidity]);

  // Calculate starting price from user inputs (for new pools)
  const startingPrice = useMemo(() => {
    if (!isFirstLiquidity) return null; // Only show for new pools
    if (!amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0) return null;
    return parseFloat(amountB) / parseFloat(amountA); // How much tokenB per tokenA
  }, [amountA, amountB, isFirstLiquidity]);

  // Auto-calculate amountB based on amountA and current price (only for existing pools)
  useEffect(() => {
    if (isFirstLiquidity) {
      // Don't auto-calculate for new pools - user sets both amounts to determine initial price
      return;
    }
    if (amountA && currentPrice && parseFloat(amountA) > 0) {
      // If 1 tokenA = currentPrice tokenB, then amountA tokenA = amountA * currentPrice tokenB
      const calculatedB = (parseFloat(amountA) * currentPrice).toFixed(6);
      setAmountB(calculatedB);
    } else if (!amountA) {
      setAmountB('');
    }
  }, [amountA, currentPrice, isFirstLiquidity]);

  // Get pool address
  const poolAddress = poolReserves.poolAddress;

  // Check if approvals are needed
  const [needsApproval, setNeedsApproval] = useState({ tokenA: false, tokenB: false });

  useEffect(() => {
    if (!isOpen || !poolAddress || !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0) {
      setNeedsApproval({ tokenA: false, tokenB: false });
      return;
    }

    const checkAllowances = async () => {
      // This will be handled by addLiquidity function
      setNeedsApproval({ tokenA: false, tokenB: false });
    };

    checkAllowances();
  }, [isOpen, poolAddress, amountA, amountB]);

  // Track progress
  useEffect(() => {
    // Don't reopen modal if it was manually closed after completion
    if (modalManuallyClosed && liquiditySuccess) {
      return;
    }
    
    // Reset manual close flag when new transaction starts
    if (isPending || isConfirming) {
      setModalManuallyClosed(false);
    }
    
    if (isPending || isConfirming) {
      // Keep progress modal open when transaction is in progress
      if (!showProgressModal) {
        setShowProgressModal(true);
      }
    } else if (isSuccess) {
      // Only handle success for adding liquidity, not for approvals
      if (approvalStep === 'adding') {
        // Only process if we haven't already handled this success
        setLiquiditySuccess(true);
        // Don't auto-close, let user close manually or after delay
        setTimeout(() => {
          // Only auto-close if user hasn't manually closed
          if (showProgressModal && !modalManuallyClosed) {
            setShowProgressModal(false);
            setApprovalStep('none');
            setLiquiditySuccess(false);
            setCompletedApprovalStep('none');
            // Reset and close after a delay
            setTimeout(() => {
              setAmountA('');
              setAmountB('');
              onClose();
            }, 2000);
          }
        }, 2500);
      }
      // For approvals (approvingA or approvingB), DON'T close modal - let auto-proceed handle it
      // The auto-proceed useEffect will take over and keep the modal open
    } else if (error && approvalStep === 'adding') {
      // Only show error modal for liquidity addition errors, not approval errors
      setErrorMessage(formatErrorMessage(error));
      setTimeout(() => {
        if (!modalManuallyClosed) {
          setShowProgressModal(false);
          setApprovalStep('none');
          setCompletedApprovalStep('none');
        }
      }, 3000);
    } else if (error && (approvalStep === 'approvingA' || approvalStep === 'approvingB')) {
      // Handle approval errors - keep modal open so user can see error
      setErrorMessage(formatErrorMessage(error));
      // Keep progress modal open to show error
      if (!showProgressModal) {
        setShowProgressModal(true);
      }
    } else if (!isPending && !isConfirming && !isSuccess && (approvalStep === 'approvingA' || approvalStep === 'approvingB')) {
      // If we're in approval state but no transaction is active, keep modal open
      // This prevents premature closing during approval->liquidity transition
      if (!showProgressModal && !modalManuallyClosed) {
        setShowProgressModal(true);
      }
    }
  }, [isPending, isConfirming, isSuccess, error, approvalStep, showProgressModal, onClose, liquiditySuccess, modalManuallyClosed]);

  // Track which approval just completed to prevent duplicate triggers
  const [completedApprovalStep, setCompletedApprovalStep] = useState<'none' | 'approvingA' | 'approvingB'>('none');

  // Auto-proceed after approval completes
  useEffect(() => {
    // Only proceed when approval transaction succeeds and we haven't already processed this approval
    // IMPORTANT: Check that we're still in approval mode (not already moved to adding)
    if (isSuccess && !isPending && !isConfirming && poolAddress && (approvalStep === 'approvingA' || approvalStep === 'approvingB') && completedApprovalStep !== approvalStep && approvalStep !== 'adding') {
      const proceed = async () => {
        try {
          // Mark this approval as completed to prevent duplicate processing
          setCompletedApprovalStep(approvalStep);
          
          // CRITICAL: Keep progress modal open during the entire flow
          if (!showProgressModal) {
            setShowProgressModal(true);
          }
          
          // Wait a bit for the blockchain to update
          await new Promise(resolve => setTimeout(resolve, 1500));
          
          // Re-check if we still need approvals (in case something changed)
          if (!publicClient) {
            throw new Error('Public client not available');
          }

          const tokenAInfo = TOKENS[finalTokenA];
          const tokenBInfo = TOKENS[finalTokenB];
          const amountAWei = parseUnits(amountA, tokenAInfo.decimals);
          const amountBWei = parseUnits(amountB, tokenBInfo.decimals);

          // Check current allowances again
          const [allowanceA, allowanceB] = await Promise.all([
            publicClient.readContract({
              address: tokenAInfo.address,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [walletAddress!, poolAddress],
            }),
            publicClient.readContract({
              address: tokenBInfo.address,
              abi: ERC20_ABI,
              functionName: 'allowance',
              args: [walletAddress!, poolAddress],
            }),
          ]);

          if (approvalStep === 'approvingA') {
            // Token A should be approved now, check if B also needs approval
            if (allowanceB < amountBWei) {
              // Still need to approve Token B
              setApprovalStep('approvingB');
              setCompletedApprovalStep('none'); // Reset to allow next approval
              setShowProgressModal(true); // Keep modal open
              approveToken(finalTokenB, poolAddress);
            } else {
              // Both approved, proceed to add liquidity - KEEP MODAL OPEN
              setApprovalStep('adding');
              setCompletedApprovalStep('none'); // Reset
              setShowProgressModal(true); // Ensure modal stays open during add liquidity
              await addLiquidity(finalTokenA, finalTokenB, amountA, amountB);
            }
          } else if (approvalStep === 'approvingB') {
            // Token B should be approved now, check if A is also approved
            if (allowanceA < amountAWei) {
              // This shouldn't happen, but handle it
              setApprovalStep('approvingA');
              setCompletedApprovalStep('none'); // Reset to allow next approval
              setShowProgressModal(true);
              approveToken(finalTokenA, poolAddress);
            } else {
              // Both approved, proceed to add liquidity - KEEP MODAL OPEN
              setApprovalStep('adding');
              setCompletedApprovalStep('none'); // Reset
              setShowProgressModal(true); // Ensure modal stays open during add liquidity
              await addLiquidity(finalTokenA, finalTokenB, amountA, amountB);
            }
          }
        } catch (err: any) {
          const errorMsg = err?.message || err?.toString() || '';
          
          // Handle approval errors that might occur during auto-proceed
          if (errorMsg.includes('NEED_APPROVE_A')) {
            setApprovalStep('approvingA');
            setCompletedApprovalStep('none');
            approveToken(finalTokenA, poolAddress);
          } else if (errorMsg.includes('NEED_APPROVE_B')) {
            setApprovalStep('approvingB');
            setCompletedApprovalStep('none');
            approveToken(finalTokenB, poolAddress);
          } else {
            setErrorMessage(formatErrorMessage(err));
            // Don't close modal on error, let user see what went wrong
          }
        }
      };
      proceed();
    }
  }, [isSuccess, approvalStep, poolAddress, finalTokenA, finalTokenB, amountA, amountB, approveToken, addLiquidity, isPending, isConfirming, publicClient, walletAddress, completedApprovalStep, showProgressModal]);

  const formatErrorMessage = (err: any): string => {
    if (!err) return 'Unknown error occurred';
    
    const errorStr = err.message || err.toString() || '';
    
    // Rate limiting errors (check first as it's common)
    if (errorStr.includes('rate limit') || 
        errorStr.includes('rate limited') ||
        errorStr.includes('Request is being rate limited') ||
        errorStr.includes('rate Limited')) {
      return 'The network is currently busy. Please wait a moment and try again.';
    }
    
    // User rejection errors
    if (errorStr.includes('User rejected') || 
        errorStr.includes('User denied') || 
        errorStr.includes('rejected the request') ||
        errorStr.includes('denied transaction signature')) {
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
      return 'Token approval required. Please approve and try again.';
    }
    
    // Pool errors
    if (errorStr.includes('Pool not found') || errorStr.includes('pool')) {
      return 'Pool not found. Please create the pool first.';
    }
    
    // For technical errors, extract just the reason if available
    if (errorStr.includes('reverted with the following reason:')) {
      const reasonMatch = errorStr.match(/reverted with the following reason:\s*(.+?)(?:\.|Contract|$)/i);
      if (reasonMatch && reasonMatch[1]) {
        const reason = reasonMatch[1].trim();
        // Already handled rate limiting above, but check again for variations
        if (reason.includes('rate limit')) {
          return 'The network is currently busy. Please wait a moment and try again.';
        }
        // Return the clean reason without technical details
        return reason.charAt(0).toUpperCase() + reason.slice(1);
      }
    }
    
    return 'An unexpected error occurred. Please try again.';
  };

  const handleAddLiquidity = async () => {
    if (!walletConnected || !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0 || !poolAddress) {
      return;
    }

    setErrorMessage(null);
    setShowProgressModal(true);
    setApprovalStep('none');

    try {
      // Check approvals first before attempting to add liquidity
      if (!publicClient) {
        throw new Error('Public client not available');
      }

      const tokenAInfo = TOKENS[finalTokenA];
      const tokenBInfo = TOKENS[finalTokenB];
      const amountAWei = parseUnits(amountA, tokenAInfo.decimals);
      const amountBWei = parseUnits(amountB, tokenBInfo.decimals);

      // Check current allowances
      const [allowanceA, allowanceB] = await Promise.all([
        publicClient.readContract({
          address: tokenAInfo.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [walletAddress!, poolAddress],
        }),
        publicClient.readContract({
          address: tokenBInfo.address,
          abi: ERC20_ABI,
          functionName: 'allowance',
          args: [walletAddress!, poolAddress],
        }),
      ]);

      // Check if Token A needs approval
      if (allowanceA < amountAWei) {
        setApprovalStep('approvingA');
        approveToken(finalTokenA, poolAddress);
        return; // Wait for approval to complete
      }

      // Check if Token B needs approval
      if (allowanceB < amountBWei) {
        setApprovalStep('approvingB');
        approveToken(finalTokenB, poolAddress);
        return; // Wait for approval to complete
      }

      // Both tokens approved, proceed with adding liquidity
      setApprovalStep('adding');
      await addLiquidity(finalTokenA, finalTokenB, amountA, amountB);
    } catch (err: any) {
      setErrorMessage(formatErrorMessage(err));
      setShowProgressModal(false);
      setApprovalStep('none');
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
        onClick={() => {
          if (!isPending && !isConfirming) {
            onClose();
          }
        }}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          onClick={(e) => e.stopPropagation()}
          className="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl max-h-[90vh] overflow-y-auto scrollbar-hide relative"
          style={{
            boxShadow: `
              0 0 30px rgba(251, 146, 60, 0.25),
              0 0 60px rgba(251, 146, 60, 0.15),
              0 10px 25px -5px rgba(0, 0, 0, 0.1),
              0 4px 6px -2px rgba(0, 0, 0, 0.05),
              inset 0 1px 0 rgba(255, 255, 255, 0.9)
            `
          }}
        >
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-gray-900">Add Liquidity</h3>
            {!isPending && !isConfirming && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Token Pair Info */}
          <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-2">
                  <TokenLogo token={tokenASymbol} size={40} />
                  <TokenLogo token={tokenBSymbol} size={40} />
                </div>
                <div>
                  <div className="text-lg font-bold text-gray-900">
                    {tokenASymbol} / {tokenBSymbol}
                  </div>
                  {isFirstLiquidity ? (
                    <div className="text-xs text-orange-600 font-medium">
                      Setting initial price ratio
                    </div>
                  ) : currentPrice ? (
                    <div className="text-xs text-gray-500">
                      Price: 1 {tokenASymbol} = {currentPrice.toFixed(6)} {tokenBSymbol}
                    </div>
                  ) : (
                    <div className="text-xs text-gray-400">
                      Loading price...
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Amount A */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2 gap-2">
              <label className="text-sm font-medium text-gray-700 flex-shrink-0">{tokenASymbol}</label>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                Balance: {balanceA ? parseFloat(balanceA).toFixed(4) : '0'}
              </span>
            </div>
            <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
              <input
                type="number"
                value={amountA}
                onChange={(e) => setAmountA(e.target.value)}
                placeholder="0.0"
                step="any"
                className="w-full text-xl font-bold bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          {/* Amount B */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2 gap-2">
              <label className="text-sm font-medium text-gray-700 flex-shrink-0">{tokenBSymbol}</label>
              <span className="text-xs text-gray-500 whitespace-nowrap">
                Balance: {balanceB ? parseFloat(balanceB).toFixed(4) : '0'}
              </span>
            </div>
            <div className="bg-orange-50 rounded-xl p-4 border border-orange-200">
              <input
                type="number"
                value={amountB}
                onChange={(e) => setAmountB(e.target.value)}
                placeholder="0.0"
                step="any"
                className="w-full text-xl font-bold bg-transparent border-none outline-none text-gray-900 placeholder-gray-400"
              />
            </div>
          </div>

          {/* Info Box for existing pools */}
          {!isFirstLiquidity && currentPrice && amountA && parseFloat(amountA) > 0 && (
            <div className="mb-4 p-3 bg-blue-50 rounded-xl border border-blue-200">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-blue-800">
                  <p className="font-medium">Current Pool Price</p>
                  <p className="mt-1">
                    1 {tokenASymbol} = {currentPrice.toFixed(6)} {tokenBSymbol}
                  </p>
                  <p className="mt-1 text-blue-700">
                    Amounts will be added at this ratio.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Info Box for new pools (first liquidity) */}
          {isFirstLiquidity && startingPrice && amountA && amountB && parseFloat(amountA) > 0 && parseFloat(amountB) > 0 && (
            <div className="mb-4 p-3 bg-orange-50 rounded-xl border border-orange-200">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-orange-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-orange-800">
                  <p className="font-medium">Starting Price Ratio</p>
                  <p className="mt-1">
                    1 {tokenASymbol} = {startingPrice.toFixed(6)} {tokenBSymbol}
                  </p>
                  <p className="mt-1 text-orange-700">
                    You're setting the initial price for this pool. Make sure the ratio is correct.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Warning for new pools without both amounts */}
          {isFirstLiquidity && (!amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0) && (
            <div className="mb-4 p-3 bg-yellow-50 rounded-xl border border-yellow-200">
              <div className="flex items-start gap-2">
                <Info className="w-4 h-4 text-yellow-600 mt-0.5 flex-shrink-0" />
                <div className="text-xs text-yellow-800">
                  <p className="font-medium">First Liquidity Provider</p>
                  <p className="mt-1">
                    This pool has no liquidity. Set both token amounts to establish the initial price ratio.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && !showProgressModal && (
            <div className="mb-4 p-3 bg-red-50 rounded-xl border border-red-200 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm text-red-800">
                <p className="font-medium">Error</p>
                <p className="text-xs mt-1">{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Add Liquidity Button */}
          <motion.button
            onClick={handleAddLiquidity}
            disabled={
              !walletConnected ||
              !isArcTestnet ||
              !amountA ||
              !amountB ||
              parseFloat(amountA) <= 0 ||
              parseFloat(amountB) <= 0 ||
              isPending ||
              isConfirming ||
              (approvalStep !== 'none' && approvalStep !== 'adding')
            }
            className={`w-full py-3 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
              !walletConnected ||
              !isArcTestnet ||
              !amountA ||
              !amountB ||
              parseFloat(amountA) <= 0 ||
              parseFloat(amountB) <= 0 ||
              isPending ||
              isConfirming ||
              (approvalStep !== 'none' && approvalStep !== 'adding')
                ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                : 'bg-orange-500 text-white hover:bg-orange-600'
            }`}
            whileHover={
              !walletConnected ||
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
              !walletConnected ||
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
            {!walletConnected
              ? 'Connect Wallet'
              : !isArcTestnet
              ? 'Switch to Arc Testnet'
              : !amountA || !amountB || parseFloat(amountA) <= 0 || parseFloat(amountB) <= 0
              ? 'Enter Amounts'
              : approvalStep === 'approvingA'
              ? `Approving ${tokenASymbol}...`
              : approvalStep === 'approvingB'
              ? `Approving ${tokenBSymbol}...`
              : approvalStep === 'adding'
              ? 'Adding Liquidity...'
              : 'Add Liquidity'}
          </motion.button>

          {/* Progress Modal */}
          <AnimatePresence>
            {showProgressModal && !modalManuallyClosed && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-center justify-center p-4"
                onClick={(e) => {
                  e.stopPropagation();
                  // Don't close modal if transaction is in progress
                  // Allow closing if process is complete (liquiditySuccess) or no active transactions
                  const canClose = liquiditySuccess || 
                    (!isPending && !isConfirming && 
                     (approvalStep === 'none' || (isSuccess && approvalStep === 'adding')));
                  if (canClose) {
                    setShowProgressModal(false);
                    setApprovalStep('none');
                    setLiquiditySuccess(false);
                    setErrorMessage(null);
                    setCompletedApprovalStep('none');
                    setModalManuallyClosed(true); // Mark as manually closed to prevent reopening
                  }
                }}
              >
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.9, opacity: 0 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl p-6 sm:p-8 max-w-md w-full shadow-2xl relative min-h-[200px]"
                style={{
                  boxShadow: `
                    0 0 30px rgba(251, 146, 60, 0.25),
                    0 0 60px rgba(251, 146, 60, 0.15),
                    0 10px 25px -5px rgba(0, 0, 0, 0.1),
                    0 4px 6px -2px rgba(0, 0, 0, 0.05),
                    inset 0 1px 0 rgba(255, 255, 255, 0.9)
                  `
                }}
                >
                  <div className="flex items-center justify-end mb-6">
                    {/* Show close button when:
                        1. Liquidity was successfully added (liquiditySuccess is true)
                        2. OR transaction succeeded and we're at adding step (all done)
                        3. OR no transactions are in progress and not waiting for approvals
                    */}
                    {(liquiditySuccess || 
                      (isSuccess && approvalStep === 'adding' && !isPending && !isConfirming) ||
                      (!isPending && !isConfirming && approvalStep === 'none')) && (
                      <button
                        onClick={() => {
                          setShowProgressModal(false);
                          setApprovalStep('none');
                          setLiquiditySuccess(false);
                          setErrorMessage(null);
                          setCompletedApprovalStep('none');
                          setModalManuallyClosed(true); // Mark as manually closed to prevent reopening
                          // Close the main modal after progress modal closes
                          setTimeout(() => {
                            setAmountA('');
                            setAmountB('');
                            onClose();
                          }, 300);
                        }}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        aria-label="Close"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    )}
                  </div>

                  <div className="space-y-4">
                    {/* Step 1: Approve Token A */}
                    {(approvalStep === 'approvingA' || approvalStep === 'approvingB' || approvalStep === 'adding') && (
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                          approvalStep === 'approvingA' && (isPending || isConfirming)
                            ? 'bg-orange-500 text-white'
                            : approvalStep !== 'approvingA'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}>
                          {approvalStep === 'approvingA' && (isPending || isConfirming) ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : approvalStep !== 'approvingA' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${
                            approvalStep === 'approvingA' && (isPending || isConfirming)
                              ? 'text-orange-600'
                              : approvalStep !== 'approvingA'
                              ? 'text-green-600'
                              : 'text-gray-500'
                          }`}>
                            Approve {tokenASymbol}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {approvalStep === 'approvingA' && (isPending || isConfirming) 
                              ? 'Confirm in wallet...' 
                              : approvalStep !== 'approvingA'
                              ? 'Completed'
                              : 'Pending'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Step 2: Approve Token B */}
                    {(approvalStep === 'approvingB' || approvalStep === 'adding') && (
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                          approvalStep === 'approvingB' && (isPending || isConfirming)
                            ? 'bg-orange-500 text-white'
                            : approvalStep === 'adding'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}>
                          {approvalStep === 'approvingB' && (isPending || isConfirming) ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : approvalStep === 'adding' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${
                            approvalStep === 'approvingB' && (isPending || isConfirming)
                              ? 'text-orange-600'
                              : approvalStep === 'adding'
                              ? 'text-green-600'
                              : 'text-gray-500'
                          }`}>
                            Approve {tokenBSymbol}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {approvalStep === 'approvingB' && (isPending || isConfirming) 
                              ? 'Confirm in wallet...' 
                              : approvalStep === 'adding'
                              ? 'Completed'
                              : 'Pending'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Step 3: Add Liquidity */}
                    {(approvalStep === 'adding' || (approvalStep !== 'none' && (isPending || isConfirming || isSuccess))) && (
                      <div className="flex items-center gap-3">
                        <div className={`flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                          approvalStep === 'adding' && (isPending || isConfirming)
                            ? 'bg-orange-500 text-white'
                            : isSuccess && approvalStep === 'adding'
                            ? 'bg-green-500 text-white'
                            : 'bg-gray-200 text-gray-500'
                        }`}>
                          {approvalStep === 'adding' && (isPending || isConfirming) ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                          ) : isSuccess && approvalStep === 'adding' ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-white" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${
                            approvalStep === 'adding' && (isPending || isConfirming)
                              ? 'text-orange-600'
                              : isSuccess && approvalStep === 'adding'
                              ? 'text-green-600'
                              : 'text-gray-500'
                          }`}>
                            Add Liquidity
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {approvalStep === 'adding' && isPending 
                              ? 'Confirm in wallet...' 
                              : isSuccess && approvalStep === 'adding'
                              ? 'Success'
                              : 'Pending'}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Success Message */}
                    {liquiditySuccess && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-4 bg-green-50 rounded-xl border border-green-200"
                      >
                        <div className="flex items-center gap-2 justify-center">
                          <CheckCircle2 className="w-5 h-5 text-green-600" />
                          <p className="text-sm font-medium text-green-800">
                            Liquidity added successfully
                          </p>
                        </div>
                      </motion.div>
                    )}

                    {/* Error Message */}
                    {errorMessage && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="mt-4 p-4 bg-red-50 rounded-xl border border-red-200 relative"
                      >
                        <button
                          onClick={() => {
                            setErrorMessage(null);
                            setShowProgressModal(false);
                            setApprovalStep('none');
                          }}
                          className="absolute top-2 right-2 text-red-400 hover:text-red-600 transition-colors"
                        >
                          <X className="w-4 h-4" />
                        </button>
                        <p className="text-sm font-medium text-red-800 pr-6">Transaction Failed</p>
                        <p className="text-xs text-red-600 mt-1">{errorMessage}</p>
                      </motion.div>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

