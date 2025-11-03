// DEX Contract Addresses on Arc Testnet
// Deployed: [Date of deployment]
// Network: Arc Testnet (Chain ID: 5042002)

export const DEX_CONFIG = {
  // Factory Contract
  FACTORY_ADDRESS: "0x34A0b64a88BBd4Bf6Acba8a0Ff8F27c8aDD67E9C",
  
  // Token Addresses (Optional - only if you want to use predefined tokens)
  // Users can use any ERC20 tokens, not just these
  // Deployed with 10M supply each
  TOKENS: {
    SRAC: "0x49cd69442dB073E7b94B0124e316AB7C68b95988",
    RACS: "0x6E63e2cABECCe5c3A1c37b79A958a9542076A1e3",
    SACS: "0x63F856fBAB3535174bFaFD6EFd720C634d6FD458",
  },
  
  // Note: Pools are now fetched dynamically from the factory contract
  // No need for hardcoded pool addresses
  
  // Network Info
  CHAIN_ID: 5042002,
  EXPLORER_URL: "https://testnet.arcscan.app",
};

