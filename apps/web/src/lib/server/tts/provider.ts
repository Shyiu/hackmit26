// The TTS seam from README "Text to speech: ElevenLabs or Deepgram". One
// provider at a time, chosen by env; the route and the bench only see this.
//
// Every provider hands back the same audio: raw signed 16-bit little-endian
// PCM, mono, 24 kHz, so the client never asks what it's being sent.

export const PCM_FORMAT = {
  encoding: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
  contentType: "audio/pcm",
} as const;

export type PcmFormat = typeof PCM_FORMAT;

/** Response headers that describe the audio, sent before the first byte. */
export function pcmHeaders(format: PcmFormat = PCM_FORMAT): Record<string, string> {
  return {
    "Content-Type": format.contentType,
    "X-Audio-Encoding": format.encoding,
    "X-Audio-Sample-Rate": String(format.sampleRate),
    "X-Audio-Channels": String(format.channels),
    "Cache-Control": "no-store",
  };
}

export type TTSProviderName = "elevenlabs";

export interface TTSProvider {
  readonly name: TTSProviderName;
  readonly format: PcmFormat;
  /**
   * Starts synthesis and resolves once the provider has accepted the request,
   * with the audio still streaming in. Rejects with TTSError before any audio
   * when the provider says no, so a caller can still answer another way.
   */
  synthesize(text: string, options?: { signal?: AbortSignal }): Promise<ReadableStream<Uint8Array>>;
}

export class TTSError extends Error {
  override name = "TTSError";
  constructor(
    readonly provider: TTSProviderName,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
