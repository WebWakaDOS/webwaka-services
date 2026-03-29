/**
 * Internationalisation — WebWaka Services Suite
 *
 * Invariant 5: Nigeria First — en-NG is the default locale
 * Invariant 6: Africa First — 7 locales supported
 *
 * Currency: All amounts stored as kobo integers (NGN × 100).
 * NEVER store naira floats. ALWAYS convert to kobo before DB writes.
 */

export const DEFAULT_LOCALE = 'en-NG';
export const SUPPORTED_LOCALES = ['en-NG', 'en-GH', 'en-KE', 'en-ZA', 'fr-CI', 'yo-NG', 'ha-NG'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

// Currency subunit multipliers (all × 100 for kobo/pesewa/cent)
const CURRENCY_SUBUNIT: Record<string, number> = {
  NGN: 100, GHS: 100, KES: 100, ZAR: 100, XOF: 100,
};

/**
 * Convert a major currency unit to its subunit (kobo, pesewa, cent).
 * Always returns an integer — Invariant 5: Nigeria First.
 */
export function toSubunit(amount: number, currency: string): number {
  const multiplier = CURRENCY_SUBUNIT[currency] ?? 100;
  return Math.round(amount * multiplier);
}

/**
 * Format a kobo integer amount as a human-readable currency string.
 * @param amountKobo — amount in kobo (integer)
 * @param currency — ISO 4217 currency code
 * @param locale — BCP 47 locale string (defaults to en-NG)
 */
export function formatCurrency(amountKobo: number, currency: string, locale: SupportedLocale = DEFAULT_LOCALE): string {
  const majorAmount = amountKobo / (CURRENCY_SUBUNIT[currency] ?? 100);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(majorAmount);
}

// Service types
export const SERVICE_TYPE_LABELS: Record<string, Record<SupportedLocale, string>> = {
  consulting: {
    'en-NG': 'Consulting', 'en-GH': 'Consulting', 'en-KE': 'Consulting',
    'en-ZA': 'Consulting', 'fr-CI': 'Consultation', 'yo-NG': 'Igbanimọran', 'ha-NG': 'Shawarwari',
  },
  freelance: {
    'en-NG': 'Freelance', 'en-GH': 'Freelance', 'en-KE': 'Freelance',
    'en-ZA': 'Freelance', 'fr-CI': 'Indépendant', 'yo-NG': 'Iṣẹ-ara-ẹni', 'ha-NG': 'Aikin-kansa',
  },
  agency: {
    'en-NG': 'Agency', 'en-GH': 'Agency', 'en-KE': 'Agency',
    'en-ZA': 'Agency', 'fr-CI': 'Agence', 'yo-NG': 'Ile-iṣẹ Aṣoju', 'ha-NG': 'Hukumar',
  },
};
