/**
 * i18n/countries.ts — Slice D / D-904.
 *
 * Localizes an English country name (the CII key, e.g. "Japan", "Russia") to
 * Spanish for PRESENTATION only. The data key stays English — never localize a
 * name used for lookups/map-tie (centroids, activeCountry).
 *
 * Stdlib-only (Intl.DisplayNames). Instead of hand-listing ~250 ISO codes, we
 * iterate every A-Z letter pair and keep the ones DisplayNames resolves to a
 * real region name (unknown codes come back unchanged → filtered out). Built
 * once at module load (~676 cheap iterations).
 *
 * import-free on purpose: this module runs under node:test+tsx (countries.test.ts)
 * without pulling the rest of the Vite app's bundler-style imports.
 */

const enDisplay = new Intl.DisplayNames(['en'], { type: 'region' });
const esDisplay = new Intl.DisplayNames(['es'], { type: 'region' });

/** English region name → ISO 3166-1 alpha-2 code (reverse of DisplayNames). */
const EN_TO_CODE = new Map<string, string>();
const A = 'A'.charCodeAt(0);
for (let i = 0; i < 26; i++) {
  for (let j = 0; j < 26; j++) {
    const code = String.fromCharCode(A + i) + String.fromCharCode(A + j);
    let en: string | undefined;
    try {
      en = enDisplay.of(code);
    } catch {
      continue; // invalid code shape — skip
    }
    if (en && en !== code) EN_TO_CODE.set(en, code);
  }
}

/**
 * CII keys whose English form differs from ICU's DisplayNames English label
 * (so EN_TO_CODE wouldn't match). The live smoke fills gaps here (R-1).
 */
const COUNTRY_ALIASES: Record<string, string> = {
  Russia: 'RU',
  'South Korea': 'KR',
  'North Korea': 'KP',
  'United States': 'US',
  'Czech Republic': 'CZ',
  Myanmar: 'MM',
  'Palestinian Territories': 'PS',
  Syria: 'SY',
  Laos: 'LA',
  Turkey: 'TR',
  'Cape Verde': 'CV',
  'Ivory Coast': 'CI',
  'Democratic Republic of the Congo': 'CD',
  'Republic of the Congo': 'CG',
};

/**
 * Returns the Spanish name for an English country name, or the input unchanged
 * when it can't be resolved (robust fallback — never throws, never blanks).
 */
export function localizeCountry(en: string): string {
  if (!en) return en;
  const code = COUNTRY_ALIASES[en] ?? EN_TO_CODE.get(en);
  if (!code) return en;
  try {
    return esDisplay.of(code) ?? en;
  } catch {
    return en;
  }
}
