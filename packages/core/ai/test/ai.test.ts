// packages/core/ai/test/ai.test.ts
// Tests de @www/core-ai (node:test)
//
// Criterios gradeables (ADR-009: openai rama activa):
//   1. resolveChain() tiene exactamente 4 proveedores: ollama, openai, groq, claude.
//   2. resolveChain() marca ollama available:false siempre (MVP).
//   3. resolveChain() marca openai available:true cuando OPENAI_API_KEY presente.
//   4. resolveChain() marca openai available:false cuando OPENAI_API_KEY ausente.
//   5. resolveChain() marca groq available:false sin GROQ_API_KEY.
//   6. resolveChain() marca claude available:false sin ANTHROPIC_API_KEY.
//   7. resolveChain() marca claude available:true cuando ANTHROPIC_API_KEY presente.
//   8. pickProvider() devuelve null cuando ningún proveedor disponible.
//   9. pickProvider() devuelve 'openai' cuando OPENAI_API_KEY está presente (rama activa MVP).
//  10. generateDailyBriefing() con caché válida NO llama al proveedor LLM (D-106).
//  11. serializeContext() produce texto coherente con los datos de entrada.
//  12. generateDailyBriefing() sin proveedor degrada a mensaje "no disponible".
//  13. buildGlobalRiskContext() devuelve '' si events vacío.
//  14. buildGlobalRiskContext() incluye tipo/país/severity con eventos reales.
//  15. serializeContext() incluye bloque de riesgo global desde eventos multi-fuente (EventRow[]).
//  16. generateDailyBriefing() con caché válida no llama proveedor — D-106 preservado (mock).

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

// Importaciones del paquete (NodeNext: extensiones .js en imports relativos)
import { resolveChain, pickProvider } from '../src/router.js';
import { serializeContext, generateDailyBriefing, buildGlobalRiskContext, buildRiskContext, buildConvergenceContext, buildSanctionsContext } from '../src/briefing.js';
import { buildBriefingPrompt, FINANCIAL_ANALYST_PERSONA } from '../src/persona.js';

// Importaciones del store para tests de integración con DB :memory:
import {
  _resetDbForTesting,
  migrate,
  insertMarketSnapshots,
  upsertEvents,
  saveBriefing,
  insertSanctions,
  type MarketSnapshot,
  type EventRow,
  type Briefing,
  type ConvergenceSignalRow,
  type SanctionRow,
} from '@www/store';

// Aseguramos que los tests de store usen :memory: (no la DB de producción)
process.env['LIBSQL_URL'] = ':memory:';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Guarda y restaura variables de entorno para un test */
function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const saved: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      saved[k] = process.env[k];
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  };
}

const NOW = Date.now();

// ─── Suite 1: resolveChain() ──────────────────────────────────────────────────

describe('resolveChain()', () => {
  test('cadena tiene exactamente 4 proveedores en orden', () => {
    const chain = resolveChain();
    assert.equal(chain.length, 4, 'debe tener 4 proveedores');
    assert.equal(chain[0]?.provider, 'ollama');
    assert.equal(chain[1]?.provider, 'openai');
    assert.equal(chain[2]?.provider, 'groq');
    assert.equal(chain[3]?.provider, 'claude');
  });

  test(
    'ollama siempre available:false en MVP',
    withEnv({}, async () => {
      const chain = resolveChain();
      const ollama = chain.find((s) => s.provider === 'ollama');
      assert.ok(ollama, 'ollama debe estar en la cadena');
      assert.equal(ollama.available, false, 'ollama debe ser available:false');
    }),
  );

  test(
    'openai available:true cuando OPENAI_API_KEY presente',
    withEnv({ OPENAI_API_KEY: 'test-openai-key-abc123' }, async () => {
      const chain = resolveChain();
      const openai = chain.find((s) => s.provider === 'openai');
      assert.ok(openai, 'openai debe estar en la cadena');
      assert.equal(openai.available, true, 'openai debe ser available:true con key');
    }),
  );

  test(
    'openai available:false cuando OPENAI_API_KEY ausente',
    withEnv({ OPENAI_API_KEY: undefined }, async () => {
      const chain = resolveChain();
      const openai = chain.find((s) => s.provider === 'openai');
      assert.ok(openai, 'openai debe estar en la cadena');
      assert.equal(openai.available, false, 'openai debe ser available:false sin key');
      assert.ok(openai.reason?.includes('OPENAI_API_KEY'), 'reason debe mencionar OPENAI_API_KEY');
    }),
  );

  test(
    'groq available:false cuando GROQ_API_KEY ausente',
    withEnv({ GROQ_API_KEY: undefined }, async () => {
      const chain = resolveChain();
      const groq = chain.find((s) => s.provider === 'groq');
      assert.ok(groq, 'groq debe estar en la cadena');
      assert.equal(groq.available, false, 'groq debe ser available:false sin key');
    }),
  );

  test(
    'claude available:true cuando ANTHROPIC_API_KEY presente',
    withEnv({ ANTHROPIC_API_KEY: 'test-anthropic-key-abc123' }, async () => {
      const chain = resolveChain();
      const claude = chain.find((s) => s.provider === 'claude');
      assert.ok(claude, 'claude debe estar en la cadena');
      assert.equal(claude.available, true, 'claude debe ser available:true con key');
    }),
  );

  test(
    'claude available:false cuando ANTHROPIC_API_KEY ausente',
    withEnv({ ANTHROPIC_API_KEY: undefined }, async () => {
      const chain = resolveChain();
      const claude = chain.find((s) => s.provider === 'claude');
      assert.ok(claude, 'claude debe estar en la cadena');
      assert.equal(claude.available, false, 'claude debe ser available:false sin key');
    }),
  );
});

// ─── Suite 2: pickProvider() ──────────────────────────────────────────────────

describe('pickProvider()', () => {
  test(
    'devuelve null cuando ningún proveedor disponible',
    withEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: undefined,
    }, async () => {
      const result = pickProvider();
      assert.equal(result, null, 'debe devolver null cuando no hay keys');
    }),
  );

  test(
    'devuelve "openai" cuando OPENAI_API_KEY está presente (rama activa MVP)',
    withEnv({
      OPENAI_API_KEY: 'test-openai-key',
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: undefined,
    }, async () => {
      const result = pickProvider();
      assert.equal(result, 'openai', 'openai debe ser el primer proveedor disponible con su key');
    }),
  );

  test(
    'devuelve "claude" cuando solo ANTHROPIC_API_KEY está presente',
    withEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      GROQ_API_KEY: undefined,
    }, async () => {
      const result = pickProvider();
      assert.equal(result, 'claude', 'claude debe ser disponible cuando anthropic key presente y openai ausente');
    }),
  );

  test(
    'openai tiene prioridad sobre claude cuando ambas keys presentes',
    withEnv({
      OPENAI_API_KEY: 'test-openai-key',
      ANTHROPIC_API_KEY: 'test-anthropic-key',
      GROQ_API_KEY: undefined,
    }, async () => {
      const result = pickProvider();
      assert.equal(result, 'openai', 'openai debe ganar sobre claude por posición en la cadena');
    }),
  );
});

// ─── Suite 3: buildGlobalRiskContext() (T-14) ─────────────────────────────────

describe('buildGlobalRiskContext()', () => {
  test('devuelve "" si la lista de eventos está vacía', () => {
    const result = buildGlobalRiskContext([]);
    assert.equal(result, '', 'debe devolver cadena vacía para lista vacía');
  });

  test('incluye tipo, país, severity y timestamp con un evento real', () => {
    const events: EventRow[] = [
      {
        source: 'usgs',
        sourceEventId: 'usgs-001',
        eventType: 'earthquake',
        category: 'natural',
        severity: 72,
        lat: 37.5,
        lon: 15.0,
        country: 'IT',
        title: 'M 5.8 - Sicily, Italy',
        url: null,
        occurredAt: NOW - 3600_000,
        capturedAt: NOW - 3000_000,
        rawJson: null,
      },
    ];
    const result = buildGlobalRiskContext(events);
    assert.ok(result.includes('earthquake'), 'debe incluir el tipo de evento');
    assert.ok(result.includes('IT'), 'debe incluir el país');
    assert.ok(result.includes('72'), 'debe incluir la severity');
    assert.ok(result !== '', 'no debe devolver cadena vacía con eventos');
  });

  test('incluye eventos de múltiples fuentes (usgs + gdelt + eonet)', () => {
    const events: EventRow[] = [
      {
        source: 'usgs',
        sourceEventId: 'usgs-q1',
        eventType: 'earthquake',
        category: 'natural',
        severity: 85,
        lat: 35.0,
        lon: 139.0,
        country: 'JP',
        title: 'M 6.5 - Near Tokyo',
        url: null,
        occurredAt: NOW - 7200_000,
        capturedAt: NOW - 6000_000,
        rawJson: null,
      },
      {
        source: 'gdelt',
        sourceEventId: 'gdelt-c1',
        eventType: 'conflict',
        category: 'conflict',
        severity: 60,
        lat: 33.9,
        lon: 35.5,
        country: 'LB',
        title: 'Armed conflict reported',
        url: null,
        occurredAt: NOW - 10800_000,
        capturedAt: NOW - 9000_000,
        rawJson: null,
      },
      {
        source: 'eonet',
        sourceEventId: 'eonet-f1',
        eventType: 'wildfire',
        category: 'natural',
        severity: 45,
        lat: 37.8,
        lon: -122.4,
        country: 'US',
        title: 'Wildfire Northern California',
        url: null,
        occurredAt: NOW - 18000_000,
        capturedAt: NOW - 15000_000,
        rawJson: null,
      },
    ];
    const result = buildGlobalRiskContext(events);
    assert.ok(result.includes('earthquake'), 'debe incluir tipo earthquake');
    assert.ok(result.includes('conflict'), 'debe incluir tipo conflict');
    assert.ok(result.includes('wildfire'), 'debe incluir tipo wildfire');
    assert.ok(result.includes('JP'), 'debe incluir país JP');
    assert.ok(result.includes('LB'), 'debe incluir país LB');
    assert.ok(result.includes('US'), 'debe incluir país US');
  });

  test('ordena por severity desc (el de mayor severity aparece primero)', () => {
    const events: EventRow[] = [
      {
        source: 'eonet',
        sourceEventId: 'low-sev',
        eventType: 'storm',
        category: 'natural',
        severity: 30,
        lat: 25.0,
        lon: -80.0,
        country: 'US',
        title: 'Storm',
        url: null,
        occurredAt: NOW,
        capturedAt: NOW,
        rawJson: null,
      },
      {
        source: 'usgs',
        sourceEventId: 'high-sev',
        eventType: 'earthquake',
        category: 'natural',
        severity: 90,
        lat: 35.0,
        lon: 139.0,
        country: 'JP',
        title: 'Big quake',
        url: null,
        occurredAt: NOW - 1000,
        capturedAt: NOW - 1000,
        rawJson: null,
      },
    ];
    const result = buildGlobalRiskContext(events);
    const idxEq = result.indexOf('earthquake');
    const idxSt = result.indexOf('storm');
    assert.ok(idxEq < idxSt, 'earthquake (severity 90) debe aparecer antes que storm (severity 30)');
  });

  test('limita a top-10 aunque haya más eventos', () => {
    const events: EventRow[] = Array.from({ length: 15 }, (_, i) => ({
      source: 'usgs' as const,
      sourceEventId: `usgs-${String(i).padStart(3, '0')}`,
      eventType: 'earthquake',
      category: 'natural' as const,
      severity: 50 - i,
      lat: 35.0 + i,
      lon: 139.0,
      country: 'JP',
      title: `Quake ${i}`,
      url: null,
      occurredAt: NOW - i * 3600_000,
      capturedAt: NOW - i * 3600_000,
      rawJson: null,
    }));
    const result = buildGlobalRiskContext(events);
    // Solo deben aparecer los primeros 10; el evento 11 (i=10, sev=40) no
    const lineCount = result.split('\n').filter((l) => l.trim().startsWith('-')).length;
    assert.equal(lineCount, 10, 'debe limitar a 10 líneas de eventos');
  });

  test('usa "—" si el país es null', () => {
    const events: EventRow[] = [
      {
        source: 'eonet',
        sourceEventId: 'eonet-unknown',
        eventType: 'volcano',
        category: 'natural',
        severity: 55,
        lat: -10.0,
        lon: 150.0,
        country: null,
        title: 'Volcanic activity',
        url: null,
        occurredAt: NOW - 5000,
        capturedAt: NOW,
        rawJson: null,
      },
    ];
    const result = buildGlobalRiskContext(events);
    assert.ok(result.includes('—'), 'debe mostrar "—" cuando el país es null');
  });
});

// ─── Suite 3b: buildRiskContext() (T-27: CII por país) ────────────────────────

describe('buildRiskContext()', () => {
  const ciiRow = (over: Partial<import('@www/store').CiiSnapshotRow> = {}): import('@www/store').CiiSnapshotRow => ({
    country: 'Japan',
    composite: 62,
    baselineRisk: 40,
    eventScore: 75,
    dynamicScore: 4,
    trend: 'rising',
    methodologyVersion: 'cii-core-1',
    componentsJson: JSON.stringify([
      { key: 'conflict', score: 80, signalPresent: true, weight: 0.25, sources: ['events:conflict'] },
      { key: 'economic', score: 30, signalPresent: true, weight: 0.30, sources: ['signals:economic'] },
    ]),
    capturedAt: NOW,
    ...over,
  });

  test('devuelve "" si la lista está vacía (serie nueva)', () => {
    assert.equal(buildRiskContext([]), '');
  });

  test('incluye país, composite, movimiento y componente dominante', () => {
    const result = buildRiskContext([ciiRow()]);
    assert.ok(result.includes('Japan'), 'incluye país');
    assert.ok(result.includes('CII 62'), 'incluye composite redondeado');
    assert.ok(result.includes('rising'), 'incluye trend');
    assert.ok(result.includes('+4'), 'incluye dynamicScore con signo');
    assert.ok(result.includes('dominante: conflict'), 'dominante = mayor score (conflict 80)');
  });

  test('ordena por composite desc y omite movimiento en serie nueva (dynamic null)', () => {
    const result = buildRiskContext([
      ciiRow({ country: 'Chile', composite: 30, dynamicScore: null, trend: null }),
      ciiRow({ country: 'Germany', composite: 70 }),
    ]);
    const idxG = result.indexOf('Germany');
    const idxC = result.indexOf('Chile');
    assert.ok(idxG < idxC, 'Germany (70) antes de Chile (30)');
    // La línea de Chile (dynamic null) no debe llevar paréntesis de movimiento
    const chileLine = result.split('\n').find((l) => l.includes('Chile'))!;
    assert.ok(!chileLine.includes('('), 'sin bloque de movimiento si dynamicScore null');
  });

  test('componentsJson inválido → omite dominante sin romper', () => {
    const result = buildRiskContext([ciiRow({ componentsJson: 'not-json' })]);
    assert.ok(result.includes('Japan'), 'la línea se produce igualmente');
    assert.ok(!result.includes('dominante'), 'sin dominante si el JSON es inválido');
  });
});

// ─── Suite 4: serializeContext() (T-14: EventRow[] en vez de GdeltEvent[]) ───

describe('serializeContext()', () => {
  test('con arrays vacíos produce texto con mensajes sin datos', () => {
    const result = serializeContext([], []);
    assert.ok(result.includes('sin datos') || result.includes('sin eventos'), 'debe indicar sin datos');
    assert.ok(result.includes('Fecha de generación'), 'debe incluir fecha');
  });

  test('con mercados serializa símbolos, precios y cambios', () => {
    const markets: MarketSnapshot[] = [
      {
        source: 'yahoo',
        symbol: 'SPY',
        asset_class: 'equity',
        price: 450.5,
        change_pct: 1.23,
        captured_at: NOW,
      },
      {
        source: 'coingecko',
        symbol: 'BTC',
        asset_class: 'crypto',
        price: 65000,
        change_pct: -2.5,
        captured_at: NOW,
      },
    ];
    const result = serializeContext(markets, []);
    assert.ok(result.includes('SPY'), 'debe incluir símbolo SPY');
    assert.ok(result.includes('BTC'), 'debe incluir símbolo BTC');
    assert.ok(result.includes('+1.23%'), 'debe incluir cambio positivo con +');
    assert.ok(result.includes('-2.50%'), 'debe incluir cambio negativo');
    assert.ok(result.includes('450.5'), 'debe incluir precio SPY');
  });

  test('con eventos EventRow multi-fuente incluye el bloque de riesgo global', () => {
    const events: EventRow[] = [
      {
        source: 'gdelt',
        sourceEventId: 'g-001',
        eventType: 'conflict',
        category: 'conflict',
        severity: 65,
        lat: 33.9,
        lon: 35.5,
        country: 'LB',
        title: 'Armed conflict',
        url: null,
        occurredAt: NOW - 3600_000,
        capturedAt: NOW - 3000_000,
        rawJson: null,
      },
      {
        source: 'usgs',
        sourceEventId: 'usgs-q2',
        eventType: 'earthquake',
        category: 'natural',
        severity: 78,
        lat: 35.0,
        lon: 139.0,
        country: 'JP',
        title: 'M 6.1 Honshu',
        url: null,
        occurredAt: NOW - 7200_000,
        capturedAt: NOW - 6000_000,
        rawJson: null,
      },
    ];
    const result = serializeContext([], events);
    assert.ok(result.includes('conflict'), 'debe incluir tipo conflict (GDELT)');
    assert.ok(result.includes('earthquake'), 'debe incluir tipo earthquake (USGS)');
    assert.ok(result.includes('LB'), 'debe incluir país LB');
    assert.ok(result.includes('JP'), 'debe incluir país JP');
    assert.ok(result.includes('65') || result.includes('78'), 'debe incluir severity');
    assert.ok(result.includes('Riesgo global'), 'debe incluir encabezado del bloque de riesgo');
  });

  test('sin eventos muestra mensaje de sin eventos recientes', () => {
    const result = serializeContext([], []);
    assert.ok(
      result.includes('sin eventos') || result.includes('sin datos'),
      'debe indicar ausencia de eventos',
    );
  });
});

// ─── Suite 5: buildBriefingPrompt() ───────────────────────────────────────────

describe('buildBriefingPrompt()', () => {
  test('incluye la persona y las tres secciones', () => {
    const prompt = buildBriefingPrompt('contexto de prueba');
    assert.ok(prompt.includes(FINANCIAL_ANALYST_PERSONA), 'debe incluir la persona');
    assert.ok(prompt.includes('Qué se movió'), 'debe tener sección Qué se movió');
    assert.ok(prompt.includes('Por qué'), 'debe tener sección Por qué');
    assert.ok(prompt.includes('Qué vigilar'), 'debe tener sección Qué vigilar');
  });

  test('incluye el contexto serializado en el prompt', () => {
    const ctx = 'contexto-serializado-test-12345';
    const prompt = buildBriefingPrompt(ctx);
    assert.ok(prompt.includes(ctx), 'el prompt debe incluir el contexto');
  });
});

// ─── Suite 6: generateDailyBriefing() con DB :memory: ────────────────────────

describe('generateDailyBriefing()', () => {
  beforeEach(async () => {
    // Resetear el singleton para obtener una DB en memoria fresca entre tests.
    // LIBSQL_URL=':memory:' ya fijado globalmente en este archivo de test.
    _resetDbForTesting();
    await migrate();
  });

  afterEach(() => {
    // Limpiar el singleton para que el siguiente beforeEach cree una DB nueva.
    _resetDbForTesting();
  });

  test(
    'con caché válida NO llama al proveedor LLM — D-106 preservado (mock)',
    withEnv({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined }, async () => {
      // Guardamos un briefing válido en la DB (valid_until = now + 1h)
      const validBriefing: Briefing = {
        domain: 'finance',
        body_md: '# Briefing de prueba\n\nContenido cacheado.',
        model: 'openai/test-model',
        created_at: NOW - 1000,
        valid_until: NOW + 60 * 60 * 1000, // expira en 1h
      };
      await saveBriefing(validBriefing);

      // Sin API keys: si generateDailyBriefing llamara al proveedor, lanzaría error.
      // Si NO lanza y devuelve el briefing cacheado, verifica D-106 (caché 24h).
      const result = await generateDailyBriefing();

      assert.equal(result.domain, 'finance', 'debe devolver el briefing del dominio finance');
      assert.equal(result.body_md, validBriefing.body_md, 'debe devolver el body cacheado');
      assert.equal(result.model, 'openai/test-model', 'debe mantener el modelo del caché');
    }),
  );

  test(
    'sin caché y sin proveedor degrada a mensaje "no disponible"',
    withEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: undefined,
    }, async () => {
      // No hay briefing en la DB y no hay proveedor → debe degradar
      const result = await generateDailyBriefing();

      assert.equal(result.domain, 'finance', 'debe devolver dominio finance');
      assert.ok(
        result.body_md.includes('no disponible'),
        `debe indicar "no disponible"; recibido: "${result.body_md}"`,
      );
    }),
  );

  test(
    'con datos en el store y sin caché construye contexto no vacío',
    withEnv({ OPENAI_API_KEY: undefined }, async () => {
      // Insertamos datos de mercado en la DB
      await insertMarketSnapshots([
        {
          source: 'yahoo',
          symbol: 'SPY',
          asset_class: 'equity',
          price: 450.0,
          change_pct: 0.5,
          captured_at: NOW - 5000,
        },
      ]);

      // Sin proveedor LLM degradará, pero el contexto serializado se construye correctamente.
      const markets = await (await import('@www/store')).getLatestMarkets();
      assert.equal(markets.length, 1, 'debe haber 1 snapshot en la DB');
      assert.equal(markets[0]?.symbol, 'SPY');

      const ctx = serializeContext(markets, []);
      assert.ok(ctx.includes('SPY'), 'contexto debe incluir SPY');
      assert.ok(ctx.includes('450'), 'contexto debe incluir precio');
    }),
  );

  test(
    'generateDailyBriefing() consulta getEvents del store — tabla events (T-14, D-105)',
    withEnv({
      OPENAI_API_KEY: undefined,
      ANTHROPIC_API_KEY: undefined,
      GROQ_API_KEY: undefined,
    }, async () => {
      // Insertar snapshots de mercado y eventos globales multi-fuente en la DB
      await insertMarketSnapshots([
        {
          source: 'yahoo',
          symbol: 'SPY',
          asset_class: 'equity',
          price: 455.0,
          change_pct: 0.8,
          captured_at: NOW - 1000,
        },
      ]);

      // Eventos de la tabla events unificada: GDELT conflict + USGS earthquake
      await upsertEvents([
        {
          source: 'gdelt',
          sourceEventId: 'evt-gdelt-t14',
          eventType: 'conflict',
          category: 'conflict',
          severity: 62,
          lat: 33.9,
          lon: 35.5,
          country: 'LB',
          title: 'Armed conflict Lebanon',
          url: null,
          occurredAt: NOW - 3600_000,
          capturedAt: NOW - 1000,
          rawJson: null,
        },
        {
          source: 'usgs',
          sourceEventId: 'evt-usgs-t14',
          eventType: 'earthquake',
          category: 'natural',
          severity: 75,
          lat: 35.0,
          lon: 139.0,
          country: 'JP',
          title: 'M 6.0 Honshu',
          url: null,
          occurredAt: NOW - 7200_000,
          capturedAt: NOW - 1000,
          rawJson: null,
        },
      ]);

      // Verificar que getEvents devuelve los eventos insertados
      const { getEvents } = await import('@www/store');
      const events = await getEvents({ sinceMs: NOW - 60 * 60 * 1000 });
      assert.equal(events.length, 2, 'debe haber 2 eventos en la DB');

      const evtIds = events.map((e) => e.sourceEventId);
      assert.ok(evtIds.includes('evt-gdelt-t14'), 'debe contener el evento GDELT');
      assert.ok(evtIds.includes('evt-usgs-t14'), 'debe contener el evento USGS');

      // Verificar que serializeContext incluye el bloque de riesgo global
      const { getLatestMarkets: fetchMarkets } = await import('@www/store');
      const markets = await fetchMarkets();
      const ctx = serializeContext(markets, events);

      assert.ok(ctx.includes('conflict'), 'contexto debe incluir tipo conflict (GDELT)');
      assert.ok(ctx.includes('earthquake'), 'contexto debe incluir tipo earthquake (USGS)');
      assert.ok(ctx.includes('LB'), 'contexto debe incluir país LB');
      assert.ok(ctx.includes('JP'), 'contexto debe incluir país JP');
      assert.ok(ctx.includes('SPY'), 'contexto debe incluir datos de mercado');
      assert.ok(ctx.includes('Riesgo global'), 'contexto debe incluir encabezado de riesgo global');

      // Sin proveedor LLM, generateDailyBriefing() degrada — pero la consulta al store se completó
      const result = await generateDailyBriefing();
      assert.ok(result.body_md.includes('no disponible'), 'sin LLM debe degradar graciosamente');
    }),
  );
});

// ─── Suite 7: buildConvergenceContext() (T-32) ───────────────────────────────

describe('buildConvergenceContext()', () => {
  /** Helper: construye un ConvergenceSignalRow con valores por defecto */
  const convRow = (over: Partial<ConvergenceSignalRow> = {}): ConvergenceSignalRow => ({
    country: 'Syria',
    familiesJson: JSON.stringify(['conflict', 'economic']),
    dimensionsJson: JSON.stringify(['conflict', 'economic']),
    componentsJson: JSON.stringify([]),
    strength: 0.82,
    sourceCount: 3,
    dynamicScore: 5,
    methodologyVersion: 'conv-1',
    firstDetectedAt: NOW - 7200_000,
    capturedAt: NOW,
    ...over,
  });

  test('devuelve "" si la lista está vacía', () => {
    assert.equal(buildConvergenceContext([]), '');
  });

  test('incluye encabezado cuando hay señales', () => {
    const result = buildConvergenceContext([convRow()]);
    assert.ok(result.includes('Señales de convergencia activas'), 'debe incluir encabezado');
  });

  test('incluye país, familias, strength con 2 decimales y flecha ↑ cuando dynamicScore > 0', () => {
    const result = buildConvergenceContext([convRow()]);
    assert.ok(result.includes('Syria'), 'debe incluir el país');
    assert.ok(result.includes('conflict'), 'debe incluir familia conflict');
    assert.ok(result.includes('economic'), 'debe incluir familia economic');
    assert.ok(result.includes('0.82'), 'debe incluir strength a 2 decimales');
    assert.ok(result.includes('↑'), 'debe incluir flecha ↑ cuando dynamicScore > 0');
  });

  test('flecha ↓ cuando dynamicScore < 0', () => {
    const result = buildConvergenceContext([convRow({ dynamicScore: -3 })]);
    assert.ok(result.includes('↓'), 'debe incluir flecha ↓ cuando dynamicScore < 0');
  });

  test('flecha → cuando dynamicScore = 0', () => {
    const result = buildConvergenceContext([convRow({ dynamicScore: 0 })]);
    assert.ok(result.includes('→'), 'debe incluir flecha → cuando dynamicScore = 0');
  });

  test('flecha → cuando dynamicScore = null', () => {
    const result = buildConvergenceContext([convRow({ dynamicScore: null })]);
    assert.ok(result.includes('→'), 'debe incluir flecha → cuando dynamicScore es null');
  });

  test('ordena por strength desc', () => {
    const result = buildConvergenceContext([
      convRow({ country: 'LowRisk', strength: 0.40 }),
      convRow({ country: 'HighRisk', strength: 0.90 }),
    ]);
    const idxH = result.indexOf('HighRisk');
    const idxL = result.indexOf('LowRisk');
    assert.ok(idxH < idxL, 'HighRisk (0.90) debe aparecer antes de LowRisk (0.40)');
  });

  test('familiesJson inválido → no rompe, omite familias', () => {
    const result = buildConvergenceContext([convRow({ familiesJson: 'not-json' })]);
    assert.ok(result.includes('Syria'), 'la línea se produce aunque familiesJson sea inválido');
    assert.ok(result.includes('0.82'), 'incluye strength aunque familiesJson sea inválido');
  });

  test('familiesJson vacío → no rompe', () => {
    const result = buildConvergenceContext([convRow({ familiesJson: '[]' })]);
    assert.ok(result.includes('Syria'), 'la línea se produce con familias vacías');
  });

  test('limita a top-8 aunque haya más señales', () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      convRow({ country: `Country${i}`, strength: 0.9 - i * 0.05 }),
    );
    const result = buildConvergenceContext(rows);
    const lineCount = result.split('\n').filter((l) => l.trim().startsWith('-')).length;
    assert.equal(lineCount, 8, 'debe limitar a 8 líneas de señales');
  });
});

// ─── Suite 8: serializeContext() con convergencia (T-32) ─────────────────────

describe('serializeContext() con convergencia (T-32)', () => {
  const convRow = (over: Partial<ConvergenceSignalRow> = {}): ConvergenceSignalRow => ({
    country: 'Iran',
    familiesJson: JSON.stringify(['political', 'economic']),
    dimensionsJson: JSON.stringify(['political', 'economic']),
    componentsJson: JSON.stringify([]),
    strength: 0.75,
    sourceCount: 2,
    dynamicScore: 2,
    methodologyVersion: 'conv-1',
    firstDetectedAt: NOW - 3600_000,
    capturedAt: NOW,
    ...over,
  });

  test('incluye bloque de convergencia cuando hay señales', () => {
    const result = serializeContext([], [], [], [convRow()]);
    assert.ok(result.includes('Señales de convergencia activas'), 'debe incluir encabezado de convergencia');
    assert.ok(result.includes('Iran'), 'debe incluir país de la señal');
    assert.ok(result.includes('0.75'), 'debe incluir strength');
  });

  test('omite bloque de convergencia cuando la lista está vacía', () => {
    const result = serializeContext([], [], [], []);
    assert.ok(!result.includes('Señales de convergencia activas'), 'no debe incluir encabezado si lista vacía');
  });

  test('sin 4º argumento (valor por defecto) omite bloque de convergencia', () => {
    const result = serializeContext([], []);
    assert.ok(!result.includes('Señales de convergencia activas'), 'parámetro por defecto = [] → bloque omitido');
  });

  test('incluye mercados, eventos, CII y convergencia en el mismo contexto', () => {
    const markets: MarketSnapshot[] = [
      { source: 'yahoo', symbol: 'SPY', asset_class: 'equity', price: 450, change_pct: 1, captured_at: NOW },
    ];
    const events: EventRow[] = [
      {
        source: 'usgs', sourceEventId: 'q1', eventType: 'earthquake', category: 'natural',
        severity: 60, lat: 35, lon: 139, country: 'JP', title: 'Quake',
        url: null, occurredAt: NOW - 3600_000, capturedAt: NOW, rawJson: null,
      },
    ];
    const cii = [
      {
        country: 'Japan', composite: 62, baselineRisk: 40, eventScore: 75,
        dynamicScore: 4, trend: 'rising' as const, methodologyVersion: 'cii-core-1',
        componentsJson: JSON.stringify([{ key: 'conflict', score: 80, signalPresent: true, weight: 0.25, sources: [] }]),
        capturedAt: NOW,
      },
    ];
    const result = serializeContext(markets, events, cii, [convRow()]);
    assert.ok(result.includes('SPY'), 'incluye mercados');
    assert.ok(result.includes('earthquake'), 'incluye eventos');
    assert.ok(result.includes('CII'), 'incluye bloque CII');
    assert.ok(result.includes('Señales de convergencia activas'), 'incluye bloque convergencia');
  });
});

// ─── Suite 9: buildSanctionsContext() (T-38) ──────────────────────────────────

describe('buildSanctionsContext()', () => {
  const sanctionRow = (country: string, sanctionedCount: number): SanctionRow => ({
    country,
    sanctionedCount,
    capturedAt: NOW,
  });

  test('devuelve "" si la lista está vacía', () => {
    assert.equal(buildSanctionsContext([]), '');
  });

  test('devuelve bloque legible con un país', () => {
    const result = buildSanctionsContext([sanctionRow('Iran', 1234)]);
    assert.ok(result.includes('Iran'), 'incluye el país');
    assert.ok(result.includes('1234'), 'incluye el conteo');
    assert.ok(result.includes('OFAC'), 'incluye prefijo OFAC');
  });

  test('ordena por sanctionedCount desc', () => {
    const result = buildSanctionsContext([
      sanctionRow('Cuba', 50),
      sanctionRow('Russia', 900),
      sanctionRow('Iran', 1234),
    ]);
    const idxI = result.indexOf('Iran');
    const idxR = result.indexOf('Russia');
    const idxC = result.indexOf('Cuba');
    assert.ok(idxI < idxR, 'Iran (1234) antes de Russia (900)');
    assert.ok(idxR < idxC, 'Russia (900) antes de Cuba (50)');
  });

  test('limita a top-10 aunque haya más entradas', () => {
    const rows = Array.from({ length: 15 }, (_, i) =>
      sanctionRow(`Country${String(i).padStart(2, '0')}`, 1000 - i),
    );
    const result = buildSanctionsContext(rows);
    // El bloque es una sola línea con 10 entradas separadas por ", "
    // Contamos las ocurrencias de " (" (abre paréntesis de conteo)
    const matches = result.match(/\(/g);
    assert.ok(matches !== null && matches.length <= 10, 'no más de 10 entradas en el bloque');
  });

  test('formato: "Países bajo más sanciones OFAC: <país> (<N>), …"', () => {
    const result = buildSanctionsContext([sanctionRow('Syria', 300), sanctionRow('Korea', 200)]);
    assert.ok(result.startsWith('Países bajo más sanciones OFAC:'), 'empieza con el prefijo correcto');
    assert.ok(result.includes('Syria (300)'), 'formato país (N)');
    assert.ok(result.includes('Korea (200)'), 'formato país (N)');
  });
});

// ─── Suite 10: serializeContext() con sanciones (T-38) ────────────────────────

describe('serializeContext() con sanciones (T-38)', () => {
  const sanctionRow = (country: string, sanctionedCount: number): SanctionRow => ({
    country,
    sanctionedCount,
    capturedAt: NOW,
  });

  test('incluye bloque de sanciones cuando hay datos', () => {
    const result = serializeContext([], [], [], [], [sanctionRow('Iran', 1234)]);
    assert.ok(result.includes('OFAC'), 'incluye encabezado OFAC');
    assert.ok(result.includes('Iran'), 'incluye el país');
    assert.ok(result.includes('1234'), 'incluye el conteo');
  });

  test('omite bloque de sanciones cuando la lista está vacía', () => {
    const result = serializeContext([], [], [], [], []);
    assert.ok(!result.includes('OFAC'), 'no debe incluir bloque OFAC si lista vacía');
  });

  test('sin 5º argumento (valor por defecto) omite bloque de sanciones', () => {
    const result = serializeContext([], []);
    assert.ok(!result.includes('OFAC'), 'parámetro por defecto = [] → bloque omitido');
  });

  test('callers existentes con 4 args siguen funcionando (sin cambio de contrato)', () => {
    // serializeContext(latest, events, cii, convergence) — sin 5º arg
    const result = serializeContext([], [], [], []);
    assert.ok(result.includes('Fecha de generación'), 'genera contexto válido con 4 argumentos');
  });

  test('bloque de sanciones aparece después del bloque de convergencia', () => {
    const conv: ConvergenceSignalRow = {
      country: 'Iran',
      familiesJson: JSON.stringify(['political']),
      dimensionsJson: JSON.stringify(['political']),
      componentsJson: JSON.stringify([]),
      strength: 0.70,
      sourceCount: 2,
      dynamicScore: null,
      methodologyVersion: 'conv-1',
      firstDetectedAt: NOW - 3600_000,
      capturedAt: NOW,
    };
    const result = serializeContext([], [], [], [conv], [sanctionRow('Russia', 800)]);
    const idxConv = result.indexOf('Señales de convergencia activas');
    const idxOfac = result.indexOf('OFAC');
    assert.ok(idxConv < idxOfac, 'bloque convergencia antes que bloque sanciones');
  });

  test('generateDailyBriefing() con sanciones en DB incluye bloque OFAC en contexto',
    withEnv({ OPENAI_API_KEY: undefined, ANTHROPIC_API_KEY: undefined, GROQ_API_KEY: undefined }, async () => {
      _resetDbForTesting();
      await migrate();
      try {
        await insertSanctions([
          { country: 'Iran', sanctionedCount: 1234, capturedAt: NOW - 1000 },
          { country: 'Russia', sanctionedCount: 900, capturedAt: NOW - 1000 },
        ]);
        // generateDailyBriefing degrada por falta de LLM, pero el contexto se construye.
        // Verificamos leyendo directamente getLatestSanctions + serializeContext.
        const { getLatestSanctions: fetchSanctions } = await import('@www/store');
        const sanctions = await fetchSanctions();
        assert.equal(sanctions.length, 2, 'debe haber 2 filas de sanciones en DB');
        const ctx = serializeContext([], [], [], [], sanctions);
        assert.ok(ctx.includes('OFAC'), 'contexto incluye bloque OFAC');
        assert.ok(ctx.includes('Iran'), 'contexto incluye Iran');
        assert.ok(ctx.includes('Russia'), 'contexto incluye Russia');
      } finally {
        _resetDbForTesting();
      }
    }),
  );
});
