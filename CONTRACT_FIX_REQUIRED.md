# Contract Fix Required - Critical Bug

## Problem Summary

The contract's `_update()` function doesn't sync reserves with actual ERC20 balances. This causes:
- UI calculations (using actual balances) don't match contract calculations (using stale reserves)
- Swaps give incorrect outputs
- Pools become unusable over time as reserves drift

## Root Cause

**File**: `contracts/contracts/SimplePoolWithLP.sol`

**Lines**: 201-205
```solidity
function _update(uint256 balanceA, uint256 balanceB) private {
    reserveA = balanceA;
    reserveB = balanceB;
    emit Sync(balanceA, balanceB);
}
```

**Problem**: This function accepts calculated values instead of reading actual ERC20 balances. Over time, reserves drift from reality.

**Where it's called incorrectly**:
1. Line 97: `_update(amountADesired, amountBDesired)` - Uses desired amounts, not actual
2. Line 151: `_update(_reserveA + amountAIn, _reserveB - amountBOut)` - Calculated, not actual
3. Line 172: `_update(_reserveA - amountAOut, _reserveB + amountBIn)` - Calculated, not actual

## The Fix

Replace `_update()` to read actual ERC20 balances:

```solidity
function _update() private {
    reserveA = tokenA.balanceOf(address(this));
    reserveB = tokenB.balanceOf(address(this));
    emit Sync(reserveA, reserveB);
}
```

Then update all calls:
- `addLiquidity`: Call `_update()` AFTER transfers, with no parameters
- `removeLiquidity`: Call `_update()` AFTER transfers, with no parameters
- `swapAToB`: Call `_update()` AFTER transfers, with no parameters
- `swapBToA`: Call `_update()` AFTER transfers, with no parameters

## Example Fix for swapAToB

**Before**:
```solidity
function swapAToB(uint256 amountAIn, uint256 amountBOutMin, address to) external {
    (uint256 _reserveA, uint256 _reserveB) = (reserveA, reserveB);
    amountBOut = _getAmountOut(amountAIn, _reserveA, _reserveB);
    require(amountBOut >= amountBOutMin, "Insufficient output amount");
    
    tokenA.safeTransferFrom(msg.sender, address(this), amountAIn);
    tokenB.safeTransfer(to, amountBOut);
    
    _update(_reserveA + amountAIn, _reserveB - amountBOut);
}
```

**After**:
```solidity
function swapAToB(uint256 amountAIn, uint256 amountBOutMin, address to) external {
    _update(); // Sync reserves FIRST
    (uint256 _reserveA, uint256 _reserveB) = (reserveA, reserveB);
    amountBOut = _getAmountOut(amountAIn, _reserveA, _reserveB);
    require(amountBOut >= amountBOutMin, "Insufficient output amount");
    
    tokenA.safeTransferFrom(msg.sender, address(this), amountAIn);
    tokenB.safeTransfer(to, amountBOut);
    
    _update(); // Sync reserves AFTER transfers
}
```

## Deployment Steps

1. Fix the contract (apply changes above)
2. Test thoroughly on testnet
3. Deploy new factory contract
4. Create new pools with the fixed contract
5. Migrate liquidity from old pools to new pools (or start fresh)
6. Update frontend to use new factory address
7. Disable maintenance mode

## Why This Fixes It

- Reserves always match actual balances
- No drift over time
- UI calculations match contract calculations
- Swaps will work correctly regardless of token order
- Long-term reliability

