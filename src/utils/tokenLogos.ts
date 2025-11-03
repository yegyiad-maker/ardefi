import type { TokenSymbol } from '../hooks/useDEX';

/**
 * Get the logo path for a token
 * @param token - Token symbol (SRAC, RACS, SACS, USDC)
 * @returns Path to the token logo
 */
export function getTokenLogoPath(token: TokenSymbol | string): string {
  const normalizedToken = (typeof token === 'string' ? token.toUpperCase() : token) as TokenSymbol;
  const logoMap: Record<string, string> = {
    USDC: '/usdc.svg',
    SRAC: '/srac.png',
    RACS: '/racs.png',
    SACS: '/sacs.png',
  };
  
  return logoMap[normalizedToken] || `/srac.png`; // fallback
}

