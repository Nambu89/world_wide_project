// packages/core/ai/src/router.ts
// LLM Router — local-first PROVIDER_CHAIN: ollama -> openai -> groq -> claude
//
// Metodología re-implementada desde la skill llm-router (no copiada de AGPL).
// ADR-009: openai sustituye a claude como rama ACTIVA del router MVP.
//
// Orden de la cadena y disponibilidad en MVP:
//   - ollama:  unavailable (daemon local no configurado en este entorno)
//   - openai:  ACTIVO — available iff OPENAI_API_KEY presente
//   - groq:    available iff GROQ_API_KEY presente (inactivo en MVP sin key)
//   - claude:  available iff ANTHROPIC_API_KEY presente (rama inactiva; queda como fallback)
//
// Modelo OpenAI OBLIGATORIO via OPENAI_MODEL — sin default; ningún modelo se asume (ADR-009).

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ─── Types ────────────────────────────────────────────────────────────────────

export const PROVIDER_CHAIN = ['ollama', 'openai', 'groq', 'claude'] as const;
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
 *   - ollama:  requeriría ping al daemon local; marcado unavailable en MVP.
 *   - openai:  available iff OPENAI_API_KEY presente (ADR-009, rama activa del MVP).
 *   - groq:    available iff GROQ_API_KEY presente.
 *   - claude:  available iff ANTHROPIC_API_KEY presente (rama inactiva en MVP).
 */
export function resolveChain(): ProviderState[] {
  return [
    {
      provider: 'ollama',
      available: false,
      reason: 'ollama daemon not configured in this environment (MVP scope)',
    },
    process.env['OPENAI_API_KEY']
      ? { provider: 'openai' as const, available: true }
      : { provider: 'openai' as const, available: false, reason: 'OPENAI_API_KEY not set' },
    process.env['GROQ_API_KEY']
      ? { provider: 'groq' as const, available: true }
      : { provider: 'groq' as const, available: false, reason: 'GROQ_API_KEY not set' },
    process.env['ANTHROPIC_API_KEY']
      ? { provider: 'claude' as const, available: true }
      : { provider: 'claude' as const, available: false, reason: 'ANTHROPIC_API_KEY not set' },
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
 * Ramas implementadas:
 *   - openai: ACTIVA en MVP (OPENAI_API_KEY). Modelo OBLIGATORIO via OPENAI_MODEL
 *             (sin default; el router falla claro si falta).
 *   - claude: INACTIVA en MVP (sin ANTHROPIC_API_KEY); queda como fallback futuro.
 *   - groq/ollama: stubs descriptivos hasta que se activen con sus keys/daemon.
 */
export async function complete(prompt: string, opts?: CompleteOptions): Promise<string> {
  const provider = pickProvider();

  if (provider === null) {
    throw new Error('LLM_UNAVAILABLE: no provider available in PROVIDER_CHAIN');
  }

  const temperature = opts?.temperature ?? 0.3;
  const maxTokens = opts?.maxTokens ?? 1024;

  switch (provider) {
    case 'openai': {
      const apiKey = process.env['OPENAI_API_KEY'];
      if (!apiKey) {
        throw new Error('LLM_UNAVAILABLE: OPENAI_API_KEY missing at call time');
      }
      const model = process.env['OPENAI_MODEL'];
      if (!model) {
        throw new Error('LLM_UNAVAILABLE: OPENAI_MODEL missing — define el modelo OpenAI en .env (sin default; ningún modelo se asume)');
      }
      const client = new OpenAI({ apiKey });
      // Modelos OpenAI nuevos (GPT-5.x) usan max_completion_tokens, no el legacy max_tokens.
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      });
      const choice = response.choices[0];
      const text = choice?.message?.content;
      if (!text) {
        throw new Error('LLM_ERROR: unexpected response structure from openai');
      }
      return stripThinking(text);
    }

    case 'claude': {
      const apiKey = process.env['ANTHROPIC_API_KEY'];
      if (!apiKey) {
        throw new Error('LLM_UNAVAILABLE: ANTHROPIC_API_KEY missing at call time');
      }
      const model = process.env['ANTHROPIC_MODEL'];
      if (!model) {
        throw new Error('LLM_UNAVAILABLE: ANTHROPIC_MODEL missing — define el modelo Anthropic en .env (sin default; ningún modelo se asume)');
      }
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [{ role: 'user', content: prompt }],
      });
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
