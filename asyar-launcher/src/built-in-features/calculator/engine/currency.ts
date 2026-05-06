import { logService } from "../../../services/log/logService";

const REGION_CURRENCY: Record<string, string> = {
  US: 'USD', GB: 'GBP', JP: 'JPY', CN: 'CNY', IN: 'INR',
  CA: 'CAD', AU: 'AUD', CH: 'CHF', SE: 'SEK', NO: 'NOK',
  DK: 'DKK', PL: 'PLN', RU: 'RUB', BR: 'BRL', MX: 'MXN',
  IQ: 'IQD', SA: 'SAR', AE: 'AED', IL: 'ILS', TR: 'TRY',
  EG: 'EGP', ZA: 'ZAR', KR: 'KRW', SG: 'SGD', HK: 'HKD',
  NZ: 'NZD', TH: 'THB', ID: 'IDR', PH: 'PHP', MY: 'MYR',
  VN: 'VND',
  DE: 'EUR', FR: 'EUR', IT: 'EUR', ES: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR',
  GR: 'EUR',
};

export function getDefaultTargetCurrency(): string {
  try {
    const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US';
    const region = new Intl.Locale(lang).region;
    if (region && REGION_CURRENCY[region]) return REGION_CURRENCY[region];
  } catch { /* fall through */ }
  return 'USD';
}

let exchangeRatesCache: Record<string, number> | null = null;
let lastFetchTimestamp: number = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function refreshRates(): Promise<boolean> {
  const now = Date.now();
  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
    if (!response.ok) return false;
    const data = await response.json();
    if (data && data.rates) {
      exchangeRatesCache = data.rates;
      lastFetchTimestamp = now;
      logService.info("Currency exchange rates refreshed successfully");
      return true;
    }
    return false;
  } catch (error) {
    logService.error(`Currency fetch failed: ${error}`);
    return false;
  }
}

async function fetchRatesIfNeeded(): Promise<boolean> {
  const now = Date.now();
  if (exchangeRatesCache && (now - lastFetchTimestamp < CACHE_TTL_MS)) {
    return true; // Use cache
  }

  return refreshRates();
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
  return `${result.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${to}`;
}

/**
 * Returns cache age in formatted text or null if unknown
 */
export function getCurrencyCacheAge(): number {
  return lastFetchTimestamp;
}

/**
 * Parser for inline search patterns like "50 usd to eur" or "50 usd"
 */
export async function evaluateCurrencyExpression(expression: string): Promise<string | null> {
  const explicit = expression.trim().match(/^([-+]?[0-9]*\.?[0-9]+)\s+([a-zA-Z]{3})\s+(?:to|in)\s+([a-zA-Z]{3})$/i);
  if (explicit) {
    const amount = parseFloat(explicit[1]);
    const fromCode = explicit[2];
    const toCode = explicit[3];
    return convertCurrency(amount, fromCode, toCode);
  }

  const implicit = expression.trim().match(/^([-+]?[0-9]*\.?[0-9]+)\s+([a-zA-Z]{3})$/i);
  if (implicit) {
    const amount = parseFloat(implicit[1]);
    const fromCode = implicit[2];
    const target = getDefaultTargetCurrency();
    if (fromCode.toUpperCase() === target) return null;
    return convertCurrency(amount, fromCode, target);
  }

  return null;
}
