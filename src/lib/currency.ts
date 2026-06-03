export type CurrencyCode = 'THB' | 'USD';

/**
 * Format amount with currency symbol based on currency code
 * THB: ฿1,234.00 (Thai locale)
 * USD: $1,234.00 (US locale)
 */
export function formatCurrency(amount: number, currency: CurrencyCode = 'THB'): string {
  const config = currency === 'THB'
    ? { locale: 'th-TH', currency: 'THB' }
    : { locale: 'en-US', currency: 'USD' };

  return new Intl.NumberFormat(config.locale, {
    style: 'currency',
    currency: config.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
