import { ELEVENLABS_DEFAULT_MODEL, elevenLabsProvider } from "./elevenlabs";
import type { TTSProvider } from "./provider";

export { PCM_FORMAT, pcmHeaders, TTSError, type PcmFormat, type TTSProvider, type TTSProviderName } from "./provider";
export { elevenLabsProvider } from "./elevenlabs";

export type TTSEnv = Record<string, string | undefined>;

/**
 * The provider the env asks for, or null when none is configured. Null means
 * the answer goes back as JSON and the phone speaks it itself; a half-configured
 * provider is treated the same way rather than failing every question.
 */
export function createTTSProvider(env: TTSEnv = process.env): TTSProvider | null {
  const name = (env.TTS_PROVIDER || "elevenlabs").trim().toLowerCase();
  if (name !== "elevenlabs") return null;
  const apiKey = env.ELEVENLABS_API_KEY?.trim();
  const voiceId = env.ELEVENLABS_VOICE_ID?.trim();
  if (!apiKey || !voiceId) return null;
  return elevenLabsProvider({ apiKey, voiceId, model: env.ELEVENLABS_MODEL?.trim() || ELEVENLABS_DEFAULT_MODEL });
}

let cached: { provider: TTSProvider | null } | null = null;

/** Process-wide provider, read from env once per process. */
export function ttsProvider(): TTSProvider | null {
  cached ??= { provider: createTTSProvider() };
  return cached.provider;
}
