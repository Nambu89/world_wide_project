// packages/connectors/geo/country-centroids.ts
//
// Centroides aproximados a nivel país (no coordenadas reales del evento).
// La GDELT GEO 2.0 API devuelve 404 upstream (verificado 2026-06-13) — la DOC 2.0 API
// proporciona `sourcecountry` como nombre de país, y usamos este mapa para geocodificar.
// Fuente de centroides: estimaciones geográficas estándar (dominio público).
// ~40+ países más relevantes para noticias financieras globales.

export const COUNTRY_CENTROIDS: Record<string, { lat: number; lon: number }> = {
  // América del Norte
  "United States": { lat: 38.9, lon: -77.0 },
  Canada: { lat: 56.1, lon: -106.3 },
  Mexico: { lat: 23.6, lon: -102.6 },

  // América del Sur
  Brazil: { lat: -14.2, lon: -51.9 },
  Argentina: { lat: -38.4, lon: -63.6 },
  Chile: { lat: -35.7, lon: -71.5 },
  Colombia: { lat: 4.6, lon: -74.1 },
  Peru: { lat: -9.2, lon: -75.0 },
  Venezuela: { lat: 6.4, lon: -66.6 },

  // Europa Occidental
  "United Kingdom": { lat: 55.4, lon: -3.4 },
  Germany: { lat: 51.2, lon: 10.5 },
  France: { lat: 46.2, lon: 2.2 },
  Spain: { lat: 40.5, lon: -3.7 },
  Italy: { lat: 41.9, lon: 12.6 },
  Netherlands: { lat: 52.1, lon: 5.3 },
  Switzerland: { lat: 46.8, lon: 8.2 },
  Belgium: { lat: 50.5, lon: 4.5 },
  Sweden: { lat: 60.1, lon: 18.6 },
  Norway: { lat: 64.5, lon: 17.9 },
  Denmark: { lat: 56.3, lon: 9.5 },
  Finland: { lat: 64.0, lon: 26.0 },
  Austria: { lat: 47.5, lon: 14.5 },
  Portugal: { lat: 39.4, lon: -8.2 },
  Greece: { lat: 39.1, lon: 21.8 },
  Ireland: { lat: 53.4, lon: -8.2 },
  Poland: { lat: 51.9, lon: 19.1 },
  "Czech Republic": { lat: 49.8, lon: 15.5 },
  Hungary: { lat: 47.2, lon: 19.5 },
  Romania: { lat: 45.9, lon: 24.9 },

  // Europa Oriental / Eurasia
  Russia: { lat: 61.5, lon: 105.3 },
  Ukraine: { lat: 48.4, lon: 31.2 },
  Turkey: { lat: 38.9, lon: 35.2 },

  // Oriente Medio
  "Palestinian Territories": { lat: 31.9, lon: 35.2 },
  "Saudi Arabia": { lat: 23.9, lon: 45.1 },
  "United Arab Emirates": { lat: 23.4, lon: 53.8 },
  Israel: { lat: 31.0, lon: 34.9 },
  Iran: { lat: 32.4, lon: 53.7 },
  Iraq: { lat: 33.2, lon: 43.7 },
  Qatar: { lat: 25.4, lon: 51.2 },
  Kuwait: { lat: 29.3, lon: 47.5 },

  // Asia
  China: { lat: 35.9, lon: 104.2 },
  Japan: { lat: 36.2, lon: 138.3 },
  India: { lat: 20.6, lon: 79.0 },
  "South Korea": { lat: 36.0, lon: 127.8 },
  "North Korea": { lat: 40.3, lon: 127.5 },
  Indonesia: { lat: -0.8, lon: 113.9 },
  Thailand: { lat: 15.9, lon: 100.9 },
  Vietnam: { lat: 14.1, lon: 108.3 },
  Malaysia: { lat: 4.2, lon: 108.0 },
  Singapore: { lat: 1.4, lon: 103.8 },
  Pakistan: { lat: 30.4, lon: 69.3 },
  Bangladesh: { lat: 23.7, lon: 90.4 },
  "Hong Kong": { lat: 22.4, lon: 114.1 },
  Taiwan: { lat: 23.7, lon: 121.0 },

  // África
  "South Africa": { lat: -30.6, lon: 22.9 },
  Nigeria: { lat: 9.1, lon: 8.7 },
  Egypt: { lat: 26.8, lon: 30.8 },
  Ethiopia: { lat: 9.1, lon: 40.5 },
  Kenya: { lat: 0.0, lon: 37.9 },
  Ghana: { lat: 7.9, lon: -1.0 },
  Morocco: { lat: 31.8, lon: -7.1 },
  Algeria: { lat: 28.0, lon: 1.7 },
  Libya: { lat: 26.3, lon: 17.2 },

  // Oceanía
  Australia: { lat: -25.3, lon: 133.8 },
  "New Zealand": { lat: -40.9, lon: 174.9 },

  // ── Cobertura ampliada: países que el motor CII/convergencia produce (GDELT) ──
  // Hotspots + resto de FIPS sin centroide → dejan de ser panel-only en el mapa.
  // (convergence-debt 2026-06-16; centroides aproximados nivel-país, dominio público).
  // Oriente Medio
  Syria: { lat: 35.0, lon: 38.0 },
  Lebanon: { lat: 33.9, lon: 35.9 },
  Jordan: { lat: 31.2, lon: 36.5 },
  Oman: { lat: 21.0, lon: 57.0 },
  Bahrain: { lat: 26.0, lon: 50.5 },
  Cyprus: { lat: 35.1, lon: 33.4 },
  // África
  Sudan: { lat: 15.5, lon: 30.2 },
  Somalia: { lat: 5.2, lon: 46.2 },
  Chad: { lat: 15.5, lon: 18.7 },
  Cameroon: { lat: 5.7, lon: 12.7 },
  "Congo (Kinshasa)": { lat: -4.0, lon: 21.8 },
  "Congo (Brazzaville)": { lat: -0.8, lon: 15.2 },
  Djibouti: { lat: 11.8, lon: 42.6 },
  Gambia: { lat: 13.4, lon: -15.3 },
  Guinea: { lat: 9.9, lon: -9.7 },
  Liberia: { lat: 6.4, lon: -9.4 },
  Malawi: { lat: -13.3, lon: 34.3 },
  Namibia: { lat: -22.0, lon: 18.5 },
  Rwanda: { lat: -1.9, lon: 29.9 },
  Senegal: { lat: 14.5, lon: -14.5 },
  Tanzania: { lat: -6.4, lon: 34.9 },
  Uganda: { lat: 1.4, lon: 32.3 },
  Zimbabwe: { lat: -19.0, lon: 29.9 },
  Benin: { lat: 9.3, lon: 2.3 },
  // Asia / Cáucaso / Asia Central
  Afghanistan: { lat: 33.9, lon: 67.7 },
  "Sri Lanka": { lat: 7.9, lon: 80.7 },
  Nepal: { lat: 28.4, lon: 84.1 },
  Philippines: { lat: 12.9, lon: 121.8 },
  Cambodia: { lat: 12.6, lon: 104.9 },
  Brunei: { lat: 4.5, lon: 114.7 },
  Kazakhstan: { lat: 48.0, lon: 67.0 },
  Kyrgyzstan: { lat: 41.2, lon: 74.8 },
  Uzbekistan: { lat: 41.4, lon: 64.6 },
  Turkmenistan: { lat: 39.0, lon: 59.6 },
  Azerbaijan: { lat: 40.4, lon: 47.6 },
  Armenia: { lat: 40.1, lon: 45.0 },
  // Europa
  Albania: { lat: 41.2, lon: 20.0 },
  Estonia: { lat: 58.6, lon: 25.0 },
  Kosovo: { lat: 42.6, lon: 20.9 },
  Luxembourg: { lat: 49.8, lon: 6.1 },
  Montenegro: { lat: 42.7, lon: 19.4 },
  "North Macedonia": { lat: 41.6, lon: 21.7 },
  Serbia: { lat: 44.0, lon: 21.0 },
  Slovakia: { lat: 48.7, lon: 19.7 },
  // Américas
  Cuba: { lat: 21.5, lon: -79.5 },
  "El Salvador": { lat: 13.8, lon: -88.9 },
  Jamaica: { lat: 18.1, lon: -77.3 },
  "Trinidad and Tobago": { lat: 10.7, lon: -61.2 },
  // Oceanía (extra)
  "Marshall Islands": { lat: 7.1, lon: 171.2 },
};
