import { PCM_FORMAT, TTSError, type TTSProvider } from "./provider";

// ElevenLabs Flash v2.5 over the HTTP streaming endpoint:
// POST /v1/text-to-speech/{voice_id}/stream?output_format=pcm_24000
// The body is raw PCM in our contract format, so nothing is transcoded here.
// The key goes in the xi-api-key header and nowhere else: never log it.

export const ELEVENLABS_DEFAULT_MODEL = "eleven_flash_v2_5";
export const ELEVENLABS_BASE_URL = "https://api.elevenlabs.io";

export type ElevenLabsOptions = {
  apiKey: string;
  voiceId: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function elevenLabsProvider(options: ElevenLabsOptions): TTSProvider {
  const model = options.model || ELEVENLABS_DEFAULT_MODEL;
  const baseUrl = (options.baseUrl ?? ELEVENLABS_BASE_URL).replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const url = `${baseUrl}/v1/text-to-speech/${encodeURIComponent(options.voiceId)}/stream?output_format=pcm_${PCM_FORMAT.sampleRate}`;

  return {
    name: "elevenlabs",
    format: PCM_FORMAT,
    async synthesize(text, { signal } = {}) {
      const response = await doFetch(url, {
        method: "POST",
        signal,
        headers: {
          "xi-api-key": options.apiKey,
          "content-type": "application/json",
          accept: "audio/pcm",
        },
        body: JSON.stringify({ text, model_id: model }),
      });
      if (!response.ok || !response.body) {
        // The error body names the problem (bad voice, quota) without echoing the key.
        const detail = await response.text().catch(() => "");
        throw new TTSError("elevenlabs", response.status, `ElevenLabs answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
      }
      return response.body;
    },
  };
}
