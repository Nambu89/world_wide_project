/**
 * chokepoints.config.ts — static chokepoints dataset (slice A, D-601).
 * Reference data (chokepoints don't change), NOT a connector.
 * Geometry (lat/lon center + radiusKm) + GKG match aliases + DOCUMENTED economic
 * impact (impactEs, D-603 — AI narrative is Slice B). All Spanish-facing text in es.
 */

export interface ChokepointConfig {
  id: string;
  name: string;        // English
  nameEs: string;      // Spanish
  lat: number;
  lon: number;
  radiusKm: number;    // proximity radius for event/signal detection
  aliases: string[];   // for GKG name/entity match (lower-cased compare)
  commodities: string[];
  worldShare: string;  // documented stat, Spanish
  dependentEconomies: string[];
  impactEs: string;    // documented cascade
}

/** Default proximity radius (km) — tunable knob. */
export const DEFAULT_RADIUS_KM = 400;

/** Detection window (72h) — matches convergence. */
export const CHOKEPOINT_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Scoring weights (documented; sum = 1). Calibrated after live smoke (L-5):
 * pure GDELT proximity over-fires near megacities (Dover→London, Suez→Cairo),
 * so the NAME-match (the strait actually being reported as disrupted) carries the
 * most weight, with proximity as corroboration. Event+signal alone cap at 0.65
 * (event 0.4 + signal 0.25), so ambient activity can reach 'watch' but rarely
 * 'disrupted' without the strait being named.
 */
export const CHOKEPOINT_WEIGHTS = { event: 0.4, signal: 0.25, name: 0.35 } as const;

/** Saturation magnitudes — a score component reaches 1.0 here (tunable knob). */
export const CHOKEPOINT_SAT = { event: 5, signal: 8, name: 3 } as const;

/**
 * Minimum event severity (0..100) counted as proximity disruption — filters the
 * ambient low-severity GDELT protest/conflict noise dense around populated coasts.
 */
export const EVENT_SEVERITY_FLOOR = 50;

/** Status band thresholds on the 0..1 score (tunable knob). */
export const CHOKEPOINT_BANDS = { watch: 0.2, disrupted: 0.5 } as const;

export const CHOKEPOINTS: ChokepointConfig[] = [
  {
    id: 'hormuz',
    name: 'Strait of Hormuz',
    nameEs: 'Estrecho de Ormuz',
    lat: 26.6, lon: 56.4, radiusKm: 400,
    aliases: ['strait of hormuz', 'hormuz', 'ormuz'],
    commodities: ['crudo', 'GNL'],
    worldShare: '~20% del petróleo mundial y gran parte del GNL de Catar',
    dependentEconomies: ['UE', 'China', 'India', 'Japón', 'Corea del Sur'],
    impactEs: 'Un cierre o incidente en Ormuz dispara el precio del Brent, encarece el GNL europeo y asiático, sube la gasolina y la energía en la UE, y presiona la inflación global. Es el chokepoint petrolero más crítico del mundo.',
  },
  {
    id: 'suez',
    name: 'Suez Canal',
    nameEs: 'Canal de Suez',
    lat: 30.5, lon: 32.35, radiusKm: 300,
    aliases: ['suez canal', 'suez'],
    commodities: ['contenedores', 'crudo', 'GNL'],
    worldShare: '~12% del comercio mundial y ~30% del tráfico de contenedores',
    dependentEconomies: ['UE', 'Asia', 'Mediterráneo'],
    impactEs: 'Un bloqueo del Canal de Suez desvía los buques por el Cabo de Buena Esperanza (+10-14 días), encarece fletes y contenedores, retrasa cadenas de suministro y sube precios de bienes importados en Europa.',
  },
  {
    id: 'bab-el-mandeb',
    name: 'Bab-el-Mandeb',
    nameEs: 'Bab el-Mandeb',
    lat: 12.6, lon: 43.4, radiusKm: 350,
    aliases: ['bab-el-mandeb', 'bab el-mandeb', 'bab al-mandab', 'red sea', 'gulf of aden', 'houthi'],
    commodities: ['crudo', 'contenedores', 'GNL'],
    worldShare: 'puerta sur del Mar Rojo, ~10% del comercio marítimo mundial liga con Suez',
    dependentEconomies: ['UE', 'Asia', 'Egipto'],
    impactEs: 'Ataques o cierre en Bab el-Mandeb (p.ej. drones/misiles hutíes) cortan de facto la ruta del Mar Rojo–Suez, fuerzan el rodeo por África, disparan fletes y seguros marítimos y encarecen energía y bienes en Europa.',
  },
  {
    id: 'malacca',
    name: 'Strait of Malacca',
    nameEs: 'Estrecho de Malaca',
    lat: 2.5, lon: 101.5, radiusKm: 400,
    aliases: ['strait of malacca', 'malacca', 'malaca'],
    commodities: ['crudo', 'contenedores', 'GNL'],
    worldShare: '~25% de los bienes comerciados por mar y el grueso del petróleo hacia Asia oriental',
    dependentEconomies: ['China', 'Japón', 'Corea del Sur', 'India'],
    impactEs: 'Una disrupción en Malaca estrangula el suministro energético de China/Japón/Corea, obliga a rodeos largos (Lombok/Sunda), sube el coste de la energía en Asia y reverbera en las cadenas globales de manufactura.',
  },
  {
    id: 'panama',
    name: 'Panama Canal',
    nameEs: 'Canal de Panamá',
    lat: 9.1, lon: -79.7, radiusKm: 300,
    aliases: ['panama canal', 'canal de panamá'],
    commodities: ['contenedores', 'GNL', 'grano'],
    worldShare: '~5% del comercio marítimo mundial; clave para la ruta Asia–costa este de EEUU',
    dependentEconomies: ['EEUU', 'Latinoamérica', 'Asia'],
    impactEs: 'Restricciones de calado por sequía o un bloqueo en Panamá reducen tránsitos, encarecen fletes de contenedores y GNL, y alargan las rutas Asia–EEUU, presionando precios de bienes y energía.',
  },
  {
    id: 'bosphorus',
    name: 'Turkish Straits (Bosphorus)',
    nameEs: 'Estrechos Turcos (Bósforo)',
    lat: 41.1, lon: 29.1, radiusKm: 300,
    aliases: ['bosphorus', 'bosporus', 'dardanelles', 'turkish straits', 'black sea'],
    commodities: ['grano', 'crudo'],
    worldShare: 'salida del Mar Negro: grano ruso/ucraniano y crudo a los mercados mundiales',
    dependentEconomies: ['UE', 'Oriente Medio', 'África'],
    impactEs: 'Un cierre del Bósforo bloquea la exportación de grano de Ucrania y Rusia y de crudo del Mar Negro, dispara precios de alimentos y energía y agrava la seguridad alimentaria en África y Oriente Medio.',
  },
  {
    id: 'gibraltar',
    name: 'Strait of Gibraltar',
    nameEs: 'Estrecho de Gibraltar',
    lat: 35.95, lon: -5.6, radiusKm: 250,
    aliases: ['strait of gibraltar', 'gibraltar'],
    commodities: ['contenedores', 'crudo'],
    worldShare: 'única entrada marítima al Mediterráneo desde el Atlántico',
    dependentEconomies: ['UE', 'Mediterráneo', 'Norte de África'],
    impactEs: 'Una disrupción en Gibraltar corta el acceso atlántico al Mediterráneo, afecta puertos del sur de Europa y el tránsito de energía y contenedores hacia la UE.',
  },
  {
    id: 'dover',
    name: 'Strait of Dover (English Channel)',
    nameEs: 'Paso de Calais (Canal de la Mancha)',
    lat: 51.0, lon: 1.5, radiusKm: 200,
    aliases: ['strait of dover', 'pas-de-calais'],
    commodities: ['contenedores'],
    worldShare: 'la vía marítima más transitada del mundo (norte de Europa)',
    dependentEconomies: ['UE', 'Reino Unido'],
    impactEs: 'Una interrupción en el Paso de Calais paraliza el comercio marítimo del norte de Europa, afecta a los puertos de Róterdam/Amberes/Hamburgo y a las cadenas de suministro UE–Reino Unido.',
  },
  {
    id: 'danish-straits',
    name: 'Danish Straits',
    nameEs: 'Estrechos Daneses',
    lat: 56.0, lon: 11.0, radiusKm: 250,
    aliases: ['danish straits', 'kattegat', 'oresund', 'great belt'],
    commodities: ['crudo'],
    worldShare: 'salida del crudo ruso del Báltico hacia el mercado mundial',
    dependentEconomies: ['UE', 'Rusia'],
    impactEs: 'Una disrupción en los Estrechos Daneses corta la exportación de crudo ruso del Báltico, altera los flujos energéticos europeos y los precios del petróleo.',
  },
  {
    id: 'taiwan',
    name: 'Taiwan Strait',
    nameEs: 'Estrecho de Taiwán',
    lat: 24.5, lon: 119.5, radiusKm: 300,
    aliases: ['taiwan strait', 'formosa strait'],
    commodities: ['contenedores', 'semiconductores'],
    worldShare: 'paso de gran parte del tráfico mundial de contenedores y de la cadena de semiconductores',
    dependentEconomies: ['China', 'EEUU', 'tecnología global'],
    impactEs: 'Una crisis en el Estrecho de Taiwán amenaza la cadena global de semiconductores (TSMC), dispara el coste y la escasez de chips, golpea la electrónica y la automoción mundiales y desvía el tráfico de contenedores del Pacífico occidental.',
  },
  {
    id: 'good-hope',
    name: 'Cape of Good Hope',
    nameEs: 'Cabo de Buena Esperanza',
    lat: -34.4, lon: 18.5, radiusKm: 400,
    aliases: ['cape of good hope', 'cabo de buena esperanza'],
    commodities: ['crudo', 'contenedores'],
    worldShare: 'ruta alternativa a Suez/Bab el-Mandeb para Asia–Europa',
    dependentEconomies: ['UE', 'Asia'],
    impactEs: 'El Cabo de Buena Esperanza absorbe el tráfico desviado cuando Suez/Bab el-Mandeb fallan; su saturación o disrupción alarga aún más las rutas Asia–Europa y encarece fletes y energía.',
  },
  {
    id: 'magellan',
    name: 'Strait of Magellan',
    nameEs: 'Estrecho de Magallanes',
    lat: -53.5, lon: -70.5, radiusKm: 350,
    aliases: ['strait of magellan', 'magallanes', 'drake passage'],
    commodities: ['contenedores', 'grano'],
    worldShare: 'paso austral alternativo a Panamá entre el Atlántico y el Pacífico',
    dependentEconomies: ['Latinoamérica'],
    impactEs: 'El Estrecho de Magallanes es la alternativa austral al Canal de Panamá; cobra relevancia cuando Panamá se restringe, alargando rutas y encareciendo fletes en el cono sur americano.',
  },
];
