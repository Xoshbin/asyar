import { logService } from "../../../services/log/logService";
let exchangeRatesCache: Record<string, number> | null = null;
let lastFetchTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

async function fetchRatesIfNeeded(): Promise<boolean> {
  const now = Date.now();
  if (exchangeRatesCache && (now - lastFetchTimestamp < CACHE_TTL_MS)) {
    return true; // Use cache
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!response.ok) return false;
    const data = await response.json();
    if (data && data.rates) {
      exchangeRatesCache = data.rates;
      lastFetchTimestamp = now;
      return true;
    }
    return false;
  } catch (error) {
    logService.error(`Currency fetch failed: ${error}`);
    return false;
  }
}

export async function convertCurrency(amount: number, fromCode: string, toCode: string): Promise<string | null> {
  const from = fromCode.trim().toUpperCase();
  const to = toCode.trim().toUpperCase();

  const success = await fetchRatesIfNeeded();
  if (!success || !exchangeRatesCache) return null;

  const fromRate = exchangeRatesCache[from];
  const toRate = exchangeRatesCache[to];

  if (fromRate === undefined || toRate === undefined) {
    return null; // Unknown currency code
  }

  // Math: amount in USD = amount / fromRate. Target amount = usdAmount * toRate.
  const result = (amount / fromRate) * toRate;

  // Format currency sensibly (2 decimal places)
  return `${result.toFixed(2)} ${to}`;
}

/**
 * Returns cache age in formatted text or null if unknown
 */
export function getCurrencyCacheAge(): number {
  return lastFetchTimestamp;
}

/**
 * Parser for inline search patterns like "50 usd to eur"
 */
export async function evaluateCurrencyExpression(expression: string): Promise<string | null> {
  const match = expression.trim().match(/^([-+]?[0-9]*\.?[0-9]+)\s+([a-zA-Z]{3})\s+(?:to|in)\s+([a-zA-Z]{3})$/i);
  if (!match) return null;

  const amount = parseFloat(match[1]);
  const fromCode = match[2];
  const toCode = match[3];

  return convertCurrency(amount, fromCode, toCode);
}
