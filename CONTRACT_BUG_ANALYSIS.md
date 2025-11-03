# Critical Contract Bug Analysis

## The Problem

The contract's `_update()` function and how it's called causes reserves to get out of sync with actual ERC20 token balances.

## Root Cause

### 1. `addLiquidity` Bug (Line 97)
```solidity
_update(amountADesired, amountBDesired);
```
**Problem**: Uses `amountADesired` and `amountBDesired` which may have been optimized/changed during calculation, not the actual amounts transferred.

**Should be**: Read actual balances from ERC20 contracts after transfer.

### 2. Reserves Never Sync with Actual Balances
Unlike Uniswap V2 which has a `sync()` function that reads actual balances, this contract:
- Uses calculated reserves
- Never reads actual ERC20 balances
- Reserves can drift over time due to rounding errors, direct transfers, etc.

### 3. Decimal Mismatch Issue
When USDC (6 decimals) is tokenA and RACA/RACD (18 decimals) is tokenB:
- All calculations are done in raw wei (should be fine)
- BUT: The contract's stored reserves might have been initialized incorrectly
- Frontend reads actual ERC20 balances (correct)
- Contract uses stored reserves (might be wrong)

## Why RAC Pool Works But USDC Pools Don't

**Hypothesis**: When pools were created:
1. RAC pool: RAC was selected first → tokenA = RAC (18 decimals), tokenB = USDC (6 decimals)
   - Reserve calculations happen to align correctly
   - Or reserves were initialized correctly by accident

2. USDC pools: USDC was selected first → tokenA = USDC (6 decimals), tokenB = RACA/RACD (18 decimals)
   - Reserve calculations might have been initialized with wrong values
   - Or the optimization in `addLiquidity` caused incorrect reserve setting

## The Fix

The contract needs to:
1. **Read actual balances** in `_update()` instead of accepting calculated values
2. **Sync reserves** before swap calculations
3. **Fix `addLiquidity`** to use actual balances after transfer

## Recommended Contract Changes

```solidity
function _update() private {
    reserveA = tokenA.balanceOf(address(this));
    reserveB = tokenB.balanceOf(address(this));
    emit Sync(reserveA, reserveB);
}

// Then in swap functions, call _update() BEFORE calculating:
function swapAToB(uint256 amountAIn, uint256 amountBOutMin, address to) external {
    _update(); // Sync reserves with actual balances FIRST
    (uint256 _reserveA, uint256 _reserveB) = (reserveA, reserveB);
    // ... rest of swap logic
}
```

This ensures reserves always match actual balances.

