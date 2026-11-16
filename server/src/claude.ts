import Anthropic from "@anthropic-ai/sdk";

/** Models ShowWork supports. Set MODEL in .env to switch (e.g. Haiku while developing, Opus for demos). */
export const SUPPORTED_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"] as const;
export type SupportedModel = (typeof SUPPORTED_MODELS)[number];
// Fallback when MODEL is unset or misspelled. Cheapest model, so a config mistake never costs more.
const DEFAULT_MODEL: SupportedModel = "claude-haiku-5-5";

/**
 * Read at call time, not import time: .env is loaded in index.ts after imports run.
 * An unknown value falls back to the default rather than sending a bad model name.
 */
export function getModel(): SupportedModel {
  const configured = process.env.MODEL?.trim();
  return (SUPPORTED_MODELS as readonly string[]).includes(configured ?? "")
    ? (configured as SupportedModel)
    : DEFAULT_MODEL;
}

/** True when MODEL is set but isn't one we support (the server warns at startup). */
export function hasInvalidModelSetting(): boolean {
  const configured = process.env.MODEL?.trim();
  return Boolean(configured) && getModel() !== configured;
}

/** Server-side refusal fallbacks exist for Opus and Sonnet, not Haiku. */
function fallbackOptions(model: SupportedModel) {
  return model === "claude-haiku-5-5"
    ? {}
    : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const };
}

let client: Anthropic | undefined;

/** Created lazily so the server still starts (and explains the problem) when no key is set. */
function getClient(): Anthropic {
  client ??= new Anthropic();
  return client;
}

export type ClaudeCheck =
  | { ok: true; model: string; reply: string; inputTokens: number; outputTokens: number; ms: number }
  | { ok: false; error: string };

/**
 * Day 1 smoke test: one tiny request proving the key, model and network all work.
 * Uses low effort to keep it cheap. On Opus and Sonnet, server-side fallbacks are on,
 * so if a safety classifier declines the request the API retries it on a fallback model.
 */
export async function checkClaude(): Promise<ClaudeCheck> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set. Copy .env.example to .env, add your key, then restart the server." };
  }
  const started = Date.now();
  try {
    const model = getModel();
    const response = await getClient().beta.messages.create({
      model,
      max_tokens: 1024,
      ...fallbackOptions(model),
      output_config: { effort: "low" },
      messages: [
        {
          role: "user",
          content: "In one short sentence, confirm you're ready to help analyze CSV data with SQL.",
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The model declined this request." };
    }
    const reply = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();

    return {
      ok: true,
      model: response.model,
      reply,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      ms: Date.now() - started,
    };
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "The API key was rejected. Check ANTHROPIC_API_KEY in .env." };
    }
    if (error instanceof Anthropic.PermissionDeniedError) {
      return { ok: false, error: "This key doesn't have access to the model. Check your Console account and billing." };
    }
    if (error instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "Rate limited (or spend limit reached). Try again shortly." };
    }
    if (error instanceof Anthropic.APIError) {
      return { ok: false, error: `Claude API error ${error.status}: ${error.message}` };
    }
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
