// packages/core/ai/src/router.ts
// LLM Router — local-first PROVIDER_CHAIN: ollama -> groq -> claude
//
// Metodología re-implementada desde la skill llm-router (no copiada de AGPL).
// ADR-005/D-004: cadena fija ['ollama','groq','claude'] con health-gating y
// fall-through por key ausente. Rama ACTIVA = claude (ANTHROPIC_API_KEY).
//
// Ollama y Groq quedan available:false en el MVP (sin keys configuradas).

import Anthropic from '@anthropic-ai/sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

export const PROVIDER_CHAIN = ['ollama', 'groq', 'claude'] as const;
export type Provider = (typeof PROVIDER_CHAIN)[number];

/** Estado de disponibilidad de un proveedor en el momento de resolución */
export interface ProviderState {
  provider: Provider;
  available: boolean;
  reason?: string;
}

export interface CompleteOptions {
  /** Temperatura de muestreo; defecto 0.3 para determinismo analítico */
  temperature?: number;
  /** Tokens máximos de respuesta; defecto 1024 */
  maxTokens?: number;
}

// ─── Chain resolution ─────────────────────────────────────────────────────────

/**
 * Evalúa cada proveedor de la cadena y devuelve su estado.
 * Criterios gradeables (no vibes):
 *   - ollama: requeriría ping al daemon local; marcado unavailable en MVP
 *     porque no hay infraestructura local en el scope T-05.
 *   - groq: disponible si GROQ_API_KEY presente.
 *   - claude: disponible si ANTHROPIC_API_KEY presente.
 */
export function resolveChain(): ProviderState[] {
  return [
    {
      provider: 'ollama',
      available: false,
      reason: 'ollama daemon not configured in this environment (MVP scope)',
    },
    {
      provider: 'groq',
      available: false,
      reason: 'GROQ_API_KEY not set — groq unavailable in MVP',
    },
    ...(process.env['ANTHROPIC_API_KEY']
      ? [{ provider: 'claude' as const, available: true }]
      : [{ provider: 'claude' as const, available: false, reason: 'ANTHROPIC_API_KEY not set' }]),
  ];
}

/**
 * Devuelve el primer proveedor disponible de la cadena, o null si ninguno lo está.
 * Fall-through gracioso: no lanza; deja que el caller degrade.
 */
export function pickProvider(): Provider | null {
  const chain = resolveChain();
  for (const state of chain) {
    if (state.available) return state.provider;
  }
  return null;
}

// ─── Completion ───────────────────────────────────────────────────────────────

const THINK_RE = /<think>[\s\S]*?<\/think>/g;

/** Elimina bloques de pensamiento interno antes de exponer la respuesta al usuario */
function stripThinking(text: string): string {
  return text.replace(THINK_RE, '').trim();
}

/**
 * Llama al primer proveedor disponible con el prompt dado.
 * Si ningún proveedor está disponible, lanza un error manejado en el caller.
 *
 * Actualmente sólo implementa la rama 'claude' (rama ACTIVA del MVP).
 * Las ramas ollama/groq son stubs que lanzan descriptivo; cuando se activen
 * se rellenarán sin cambiar la interfaz pública.
 */
export async function complete(prompt: string, opts?: CompleteOptions): Promise<string> {
  const provider = pickProvider();

  if (provider === null) {
    throw new Error('LLM_UNAVAILABLE: no provider available in PROVIDER_CHAIN');
  }

  const temperature = opts?.temperature ?? 0.3;
  const maxTokens = opts?.maxTokens ?? 1024;

  switch (provider) {
    case 'claude': {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        throw new Error('LLM_UNAVAILABLE: ANTHROPIC_API_KEY missing at call time');
      }
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      // Extraemos texto del primer bloque de contenido
      const block = message.content[0];
      if (!block || block.type !== 'text') {
        throw new Error('LLM_ERROR: unexpected response structure from claude');
      }
      return stripThinking(block.text);
    }

    case 'groq':
      throw new Error('LLM_UNAVAILABLE: groq not implemented in MVP (no GROQ_API_KEY)');

    case 'ollama':
      throw new Error('LLM_UNAVAILABLE: ollama not implemented in MVP');
  }
}
