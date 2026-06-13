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
};
