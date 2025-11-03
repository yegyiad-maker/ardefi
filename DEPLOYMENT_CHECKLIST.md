# Deployment Checklist - New Contract & Tokens

## ✅ Contract Fixes Completed

1. **SimplePoolWithLP.sol** - Fixed `_update()` to sync with actual balances
2. **Added `sync()` function** - Public function to fix stale reserves
3. **All swap/liquidity functions** - Now sync reserves before calculations

## ✅ Token Changes Completed

1. **MockERC20.sol** - Updated to mint 10,000,000 tokens (10 million)
2. **Token names updated**:
   - `RAC` → `SRAC` (Simple RAC Token)
   - `RACD` → `RACS` (RAC Swap Token)  
   - `RACA` → `SACS` (Swap ACR Token)
3. **Frontend updated** - All references changed to new token symbols

## 📋 Deployment Steps

### Step 1: Deploy New Tokens
```bash
cd contracts
npx hardhat run scripts/deployTokens.ts --network arc-testnet
```

This will deploy:
- SRAC (10M supply)
- RACS (10M supply)
- SACS (10M supply)

### Step 2: Update Frontend Config
After token deployment, update `src/config/dex.ts`:
```typescript
TOKENS: {
  SRAC: "0x...", // From deployment output
  RACS: "0x...", // From deployment output
  SACS: "0x...", // From deployment output
},
```

### Step 3: Deploy New Factory
```bash
npx hardhat run scripts/deploy.ts --network arc-testnet
```

### Step 4: Update Factory Address
Update `src/config/dex.ts`:
```typescript
FACTORY_ADDRESS: "0x...", // New factory address
```

### Step 5: Create New Pools
1. Open the app
2. Go to "Create Pool" tab
3. Create pools with new tokens (SRAC, RACS, SACS)

### Step 6: Go Live
Set in `.env`:
```
VITE_MAINTENANCE_MODE=false
```

## 🔄 What Changed

**Contract:**
- `_update()` now reads actual ERC20 balances
- `sync()` public function added
- Reserves sync before every operation

**Tokens:**
- New names: SRAC, RACS, SACS
- 10 million supply each
- 18 decimals

**Frontend:**
- All token references updated
- Default swap pair: USDC → SRAC
- Token logos mapped to new names

## ⚠️ Old Pools

Old pools with buggy contract:
- Will remain on old factory
- Can be ignored or users can try recovery
- New pools will use fixed contract

## ✅ Ready to Deploy!

All code is updated and ready. Just need to:
1. Deploy tokens
2. Deploy factory
3. Update config
4. Create pools
5. Disable maintenance mode

