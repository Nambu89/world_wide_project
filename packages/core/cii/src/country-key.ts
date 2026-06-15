/**
 * country-key.ts — Normalización de clave de país a nombre canónico
 *
 * Función pura: no importa @www/store ni nada externo.
 * Responsabilidad ÚNICA: mapear el identificador que llega de cada fuente
 * al nombre canónico de packages/connectors/geo/country-centroids.ts.
 *
 * Fuentes y su formato nativo:
 * - 'gdelt':  FIPS 10-4 (2 letras mayúsculas). No es ISO-3166-1 alpha-2.
 * - 'usgs':   nombre de país en inglés (ya canónico o con variantes).
 * - 'eonet':  nombre de país en inglés (ya canónico o con variantes).
 *
 * CRÍTICO — trampas FIPS 10-4 vs ISO-3166-1:
 * El estándar FIPS 10-4 difiere de ISO en ~30 países clave.
 * Referencia: https://www.cia.gov/the-world-factbook/references/country-data-codes/
 * (tabla FIPS 10-4, dominio público — valores propios, no copiados).
 *
 * Países con divergencia notable (los más frecuentes en GDELT):
 *   FIPS CH = China          (ISO CH = Suiza / Switzerland)
 *   FIPS JA = Japan          (ISO JP)
 *   FIPS UK = United Kingdom (ISO GB)
 *   FIPS GM = Germany        (ISO DE)
 *   FIPS RS = Russia         (ISO RU)
 *   FIPS SP = Spain          (ISO ES)
 *   FIPS IT = Italy          (ISO IT — coincide por suerte)
 *   FIPS FR = France         (ISO FR — coincide)
 *   FIPS IN = India          (ISO IN — coincide)
 *   FIPS MX = Mexico         (ISO MX — coincide)
 *   FIPS KS = South Korea    (ISO KR)
 *   FIPS KN = North Korea    (ISO KP)
 *   FIPS IR = Iran           (ISO IR — coincide)
 *   FIPS IZ = Iraq           (ISO IQ)
 *   FIPS SA = Saudi Arabia   (ISO SA — coincide)
 *   FIPS EG = Egypt          (ISO EG — coincide)
 *   FIPS SF = South Africa   (ISO ZA)
 *   FIPS AS = Australia      (ISO AU)
 *   FIPS UP = Ukraine        (ISO UA)
 *   FIPS PL = Poland         (ISO PL — coincide)
 *   FIPS TU = Turkey         (ISO TR)
 *   FIPS NL = Netherlands    (ISO NL — coincide)
 *   FIPS EZ = Czechia/Czech Republic (ISO CZ)
 *   FIPS AR = Argentina      (ISO AR — coincide)
 *   FIPS VE = Venezuela      (ISO VE — coincide)
 *   FIPS SZ = Switzerland    (¡no CH!)
 */

// ─── Tabla FIPS 10-4 → nombre canónico ───────────────────────────────────────

/**
 * FIPS_TO_NAME — Mapa de códigos FIPS 10-4 (2 letras) a nombre canónico del radar.
 *
 * Cubre los ~64 países de country-centroids.ts más variantes comunes de GDELT.
 * FIPS no listado → normalizeCountryKey devuelve '' (el motor lo descarta).
 *
 * Nomenclatura: valores = nombres exactos de COUNTRY_CENTROIDS en country-centroids.ts.
 */
const FIPS_TO_NAME: Record<string, string> = {
  // ── América del Norte ──────────────────────────────────────────────────────
  US: 'United States',
  CA: 'Canada',
  MX: 'Mexico',

  // ── América del Sur ────────────────────────────────────────────────────────
  BR: 'Brazil',
  AR: 'Argentina',
  CI: 'Chile',           // FIPS CI = Chile (ISO CL)
  CO: 'Colombia',
  PE: 'Peru',
  VE: 'Venezuela',

  // ── Europa Occidental ──────────────────────────────────────────────────────
  UK: 'United Kingdom',  // FIPS UK = UK (ISO GB — TRAMPA CLÁSICA)
  GM: 'Germany',         // FIPS GM = Germany (ISO DE)
  FR: 'France',
  SP: 'Spain',           // FIPS SP = Spain (ISO ES)
  IT: 'Italy',
  NL: 'Netherlands',
  SZ: 'Switzerland',     // FIPS SZ = Switzerland (ISO CH — TRAMPA: FIPS CH = China)
  BE: 'Belgium',
  SW: 'Sweden',          // FIPS SW = Sweden (ISO SE)
  NO: 'Norway',
  DA: 'Denmark',         // FIPS DA = Denmark (ISO DK)
  FI: 'Finland',
  AU: 'Austria',         // FIPS AU = Austria (ISO AT — TRAMPA: ISO AU = Australia)
  PO: 'Portugal',        // FIPS PO = Portugal (ISO PT)
  GR: 'Greece',
  EI: 'Ireland',         // FIPS EI = Ireland (ISO IE)
  PL: 'Poland',
  EZ: 'Czech Republic',  // FIPS EZ = Czech Republic / Czechia (ISO CZ)
  HU: 'Hungary',
  RO: 'Romania',

  // ── Europa Oriental / Eurasia ──────────────────────────────────────────────
  RS: 'Russia',          // FIPS RS = Russia (ISO RU)
  UP: 'Ukraine',         // FIPS UP = Ukraine (ISO UA)
  TU: 'Turkey',          // FIPS TU = Turkey (ISO TR)
  AL: 'Albania',         // FIPS AL = Albania (ISO AL)
  EN: 'Estonia',         // FIPS EN = Estonia (ISO EE — TRAMPA)
  LO: 'Slovakia',        // FIPS LO = Slovakia (ISO SK — TRAMPA)
  LU: 'Luxembourg',      // FIPS LU = Luxembourg (ISO LU)
  MK: 'North Macedonia', // FIPS MK = North Macedonia (ISO MK)
  MJ: 'Montenegro',      // FIPS MJ = Montenegro (ISO ME)
  RB: 'Serbia',          // FIPS RB/RI = Serbia (GDELT usa ambos)
  RI: 'Serbia',          // FIPS RI = Serbia (ISO RS)
  KV: 'Kosovo',          // FIPS KV = Kosovo (sin ISO oficial)

  // ── Américas (extra) ───────────────────────────────────────────────────────
  ES: 'El Salvador',     // FIPS ES = El Salvador (ISO SV — TRAMPA: ISO ES = Spain)
  CU: 'Cuba',            // FIPS CU = Cuba (ISO CU)
  JM: 'Jamaica',         // FIPS JM = Jamaica (ISO JM)
  TD: 'Trinidad and Tobago', // FIPS TD = Trinidad and Tobago (ISO TT)
  RM: 'Marshall Islands',    // FIPS RM = Marshall Islands (ISO MH)

  // ── Oriente Medio ──────────────────────────────────────────────────────────
  SA: 'Saudi Arabia',
  AE: 'United Arab Emirates',  // FIPS AE = UAE (ISO AE — coincide; el viejo TC era Turks&Caicos, BUG)
  IS: 'Israel',
  IR: 'Iran',
  IZ: 'Iraq',            // FIPS IZ = Iraq (ISO IQ)
  QA: 'Qatar',
  KU: 'Kuwait',
  SY: 'Syria',           // FIPS SY = Syria (ISO SY — coincide)
  LE: 'Lebanon',         // FIPS LE = Lebanon (ISO LB)
  JO: 'Jordan',          // FIPS JO = Jordan (ISO JO)
  BA: 'Bahrain',         // FIPS BA = Bahrain (ISO BH)
  MU: 'Oman',            // FIPS MU = Oman (ISO OM)
  CY: 'Cyprus',          // FIPS CY = Cyprus (ISO CY)
  GZ: 'Palestinian Territories',  // FIPS GZ = Gaza Strip
  WE: 'Palestinian Territories',  // FIPS WE = West Bank (se unifica con GZ)

  // ── Asia ───────────────────────────────────────────────────────────────────
  CH: 'China',           // FIPS CH = China (ISO CN — TRAMPA CRÍTICA: ISO CH = Suiza)
  JA: 'Japan',           // FIPS JA = Japan (ISO JP)
  IN: 'India',
  KS: 'South Korea',     // FIPS KS = South Korea (ISO KR)
  KN: 'North Korea',     // FIPS KN = North Korea (ISO KP)
  ID: 'Indonesia',
  TH: 'Thailand',
  VM: 'Vietnam',         // FIPS VM = Vietnam (ISO VN)
  MY: 'Malaysia',
  SN: 'Singapore',       // FIPS SN = Singapore (ISO SG)
  PK: 'Pakistan',
  BG: 'Bangladesh',      // FIPS BG = Bangladesh (ISO BD)
  HK: 'Hong Kong',
  TW: 'Taiwan',
  AF: 'Afghanistan',     // FIPS AF = Afghanistan (ISO AF)
  CE: 'Sri Lanka',       // FIPS CE = Sri Lanka (ISO LK — TRAMPA)
  NP: 'Nepal',           // FIPS NP = Nepal (ISO NP)
  RP: 'Philippines',     // FIPS RP = Philippines (ISO PH — TRAMPA)
  CB: 'Cambodia',        // FIPS CB = Cambodia (ISO KH)
  BX: 'Brunei',          // FIPS BX = Brunei (ISO BN)
  // ── Cáucaso / Asia Central ─────────────────────────────────────────────────
  AJ: 'Azerbaijan',      // FIPS AJ = Azerbaijan (ISO AZ)
  AM: 'Armenia',         // FIPS AM = Armenia (ISO AM)
  KZ: 'Kazakhstan',      // FIPS KZ = Kazakhstan (ISO KZ)
  KG: 'Kyrgyzstan',      // FIPS KG = Kyrgyzstan (ISO KG)
  UZ: 'Uzbekistan',      // FIPS UZ = Uzbekistan (ISO UZ)
  TX: 'Turkmenistan',    // FIPS TX = Turkmenistan (ISO TM — TRAMPA)

  // ── África ─────────────────────────────────────────────────────────────────
  SF: 'South Africa',    // FIPS SF = South Africa (ISO ZA)
  NI: 'Nigeria',
  EG: 'Egypt',
  ET: 'Ethiopia',
  KE: 'Kenya',
  GH: 'Ghana',
  MO: 'Morocco',         // FIPS MO = Morocco (ISO MA)
  AG: 'Algeria',         // FIPS AG = Algeria (ISO DZ)
  LY: 'Libya',
  SU: 'Sudan',           // FIPS SU = Sudan (ISO SD)
  SO: 'Somalia',         // FIPS SO = Somalia (ISO SO)
  CG: 'Congo (Kinshasa)',   // FIPS CG = DRC / Congo-Kinshasa (ISO CD)
  CF: 'Congo (Brazzaville)',// FIPS CF = Republic of the Congo (ISO CG)
  CM: 'Cameroon',        // FIPS CM = Cameroon (ISO CM)
  CD: 'Chad',            // FIPS CD = Chad (ISO TD — TRAMPA: FIPS TD = Trinidad)
  DJ: 'Djibouti',        // FIPS DJ = Djibouti (ISO DJ)
  GV: 'Guinea',          // FIPS GV = Guinea (ISO GN)
  GA: 'Gambia',          // FIPS GA = Gambia (ISO GM)
  LI: 'Liberia',         // FIPS LI = Liberia (ISO LR)
  MI: 'Malawi',          // FIPS MI = Malawi (ISO MW)
  RW: 'Rwanda',          // FIPS RW = Rwanda (ISO RW)
  SG: 'Senegal',         // FIPS SG = Senegal (ISO SN — TRAMPA: ISO SG = Singapore)
  TZ: 'Tanzania',        // FIPS TZ = Tanzania (ISO TZ)
  UG: 'Uganda',          // FIPS UG = Uganda (ISO UG)
  ZI: 'Zimbabwe',        // FIPS ZI = Zimbabwe (ISO ZW)
  WA: 'Namibia',         // FIPS WA = Namibia (ISO NA — TRAMPA)
  BN: 'Benin',           // FIPS BN = Benin (ISO BJ — TRAMPA: ISO BN = Brunei)

  // ── Oceanía ────────────────────────────────────────────────────────────────
  AS: 'Australia',       // FIPS AS = Australia (ISO AU — TRAMPA: FIPS AU = Austria)
  NZ: 'New Zealand',
};

// ─── Alias de nombres (USGS/EONET variantes → nombre canónico) ───────────────

/**
 * NAME_ALIASES — Variantes de nombre de país que USGS/EONET pueden enviar.
 *
 * USGS y EONET generalmente devuelven nombres cercanos al canónico,
 * pero con variantes frecuentes documentadas aquí.
 * Claves = variante en minúsculas (para comparación case-insensitive).
 */
const NAME_ALIASES: Record<string, string> = {
  // Variantes comunes de nombres canónicos
  'czechia': 'Czech Republic',
  'czech republic': 'Czech Republic',
  'türkiye': 'Turkey',
  'türkei': 'Turkey',
  'south korea': 'South Korea',
  'north korea': 'North Korea',
  'united states of america': 'United States',
  'usa': 'United States',
  'u.s.': 'United States',
  'uk': 'United Kingdom',
  'great britain': 'United Kingdom',
  'england': 'United Kingdom',
  'uae': 'United Arab Emirates',
  'hong kong sar': 'Hong Kong',
  'republic of china': 'Taiwan',
  'new zealand': 'New Zealand',
  'south africa': 'South Africa',
};

// ─── Función pública ──────────────────────────────────────────────────────────

/**
 * normalizeCountryKey — Normaliza el identificador de país a nombre canónico.
 *
 * @param raw    El valor tal como llega de la fuente (FIPS, nombre, string vacío).
 * @param source La fuente de datos que envía el valor.
 * @returns      Nombre canónico del radar, o '' si no se puede mapear.
 *               El motor descarta '' (país desconocido → no afecta scoring).
 *
 * Criterio gradeable:
 * - normalizeCountryKey('JA', 'gdelt') === 'Japan'
 * - normalizeCountryKey('Japan', 'usgs') === 'Japan'
 * - normalizeCountryKey('JA', 'gdelt') === normalizeCountryKey('Japan', 'usgs')
 * - normalizeCountryKey('CH', 'gdelt') === 'China'  (NO 'Switzerland')
 * - normalizeCountryKey('', 'gdelt') === ''
 * - normalizeCountryKey('XX', 'gdelt') === '' (FIPS desconocido → warning + '')
 */
export function normalizeCountryKey(
  raw: string,
  source: 'gdelt' | 'usgs' | 'eonet',
): string {
  if (!raw || raw.trim() === '') return '';

  const trimmed = raw.trim();

  if (source === 'gdelt') {
    // GDELT da FIPS 10-4 en mayúsculas (2 caracteres).
    const upper = trimmed.toUpperCase();
    const mapped = FIPS_TO_NAME[upper];
    if (mapped !== undefined) return mapped;
    // FIPS no mapeado: avisa (facilita detectar huecos de cobertura) y descarta.
    console.warn(`[core-cii/country-key] FIPS no mapeado: "${upper}" (fuente: gdelt)`);
    return '';
  }

  // USGS y EONET envían nombres en inglés → identidad con normalización.
  // 1. Comprobamos alias case-insensitive primero.
  const lower = trimmed.toLowerCase();
  const alias = NAME_ALIASES[lower];
  if (alias !== undefined) return alias;

  // 2. Devolvemos el trimmed tal cual (ya es nombre canónico o muy cercano).
  //    El motor fallará a DEFAULT_COEFF si no está en COUNTRY_COEFFS (comportamiento correcto).
  return trimmed;
}
