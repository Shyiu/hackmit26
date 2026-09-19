import { describe, expect, it, vi } from "vitest";
import { createTTSProvider, PCM_FORMAT, pcmHeaders, TTSError } from "./index";
import { ELEVENLABS_DEFAULT_MODEL, elevenLabsProvider } from "./elevenlabs";
import { timedStream } from "./timed-stream";

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

function streamOf(chunks: Uint8Array[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>) {
  const out: number[] = [];
  const reader = stream.getReader();
  for (let next = await reader.read(); !next.done; next = await reader.read()) out.push(...next.value);
  return out;
}

describe("createTTSProvider", () => {
  it("is null with no key, so the route keeps answering as JSON", () => {
    expect(createTTSProvider({})).toBeNull();
    expect(createTTSProvider({ TTS_PROVIDER: "elevenlabs" })).toBeNull();
    expect(createTTSProvider({ ELEVENLABS_API_KEY: "k" })).toBeNull();
    expect(createTTSProvider({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v", TTS_PROVIDER: "deepgram" })).toBeNull();
  });

  it("builds ElevenLabs from env, defaulting the provider name and model", () => {
    const provider = createTTSProvider({ ELEVENLABS_API_KEY: "k", ELEVENLABS_VOICE_ID: "v" });
    expect(provider?.name).toBe("elevenlabs");
    expect(provider?.format).toBe(PCM_FORMAT);
  });
});

describe("elevenLabsProvider", () => {
  it("streams PCM from the documented endpoint with the key only in the header", async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([bytes(1, 2), bytes(3, 4)]), { status: 200 }));
    const provider = elevenLabsProvider({ apiKey: "secret-key", voiceId: "voice/1", fetch: fetchMock });

    const audio = await provider.synthesize("Your keys are on the table.");
    expect(await collect(audio)).toEqual([1, 2, 3, 4]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.elevenlabs.io/v1/text-to-speech/voice%2F1/stream?output_format=pcm_24000");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe("secret-key");
    expect(JSON.parse(init.body as string)).toEqual({ text: "Your keys are on the table.", model_id: ELEVENLABS_DEFAULT_MODEL });
    expect(url).not.toContain("secret-key");
    expect(init.body).not.toContain("secret-key");
  });

  it("honours model and base URL overrides and forwards the abort signal", async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf([bytes(0)]), { status: 200 }));
    const provider = elevenLabsProvider({
      apiKey: "k",
      voiceId: "v",
      model: "eleven_turbo_v2_5",
      baseUrl: "http://localhost:9999/",
      fetch: fetchMock,
    });
    const controller = new AbortController();
    await provider.synthesize("hi", { signal: controller.signal });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:9999/v1/text-to-speech/v/stream?output_format=pcm_24000");
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(init.body as string).model_id).toBe("eleven_turbo_v2_5");
  });

  it("rejects with TTSError before any audio when the provider says no", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: "quota_exceeded" }), { status: 401 }));
    const provider = elevenLabsProvider({ apiKey: "k", voiceId: "v", fetch: fetchMock });
    const error = await provider.synthesize("hi").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TTSError);
    expect((error as TTSError).status).toBe(401);
    expect((error as TTSError).message).toContain("quota_exceeded");
    expect((error as TTSError).message).not.toContain("k\"");
  });
});

describe("pcmHeaders", () => {
  it("fixes the audio format before the body starts", () => {
    expect(pcmHeaders()).toMatchObject({
      "Content-Type": "audio/pcm",
      "X-Audio-Encoding": "pcm_s16le",
      "X-Audio-Sample-Rate": "24000",
      "X-Audio-Channels": "1",
    });
  });
});

describe("timedStream", () => {
  it("passes bytes through untouched and reports first byte and completion", async () => {
    const events = { onFirstByte: vi.fn(), onEnd: vi.fn() };
    let clock = 100;
    const stream = timedStream(streamOf([bytes(), bytes(9, 8), bytes(7)]), events, 100, () => (clock += 42));
    expect(await collect(stream)).toEqual([9, 8, 7]);
    expect(events.onFirstByte).toHaveBeenCalledTimes(1);
    expect(events.onFirstByte).toHaveBeenCalledWith(42);
    expect(events.onEnd).toHaveBeenCalledTimes(1);
    expect(events.onEnd).toHaveBeenCalledWith("complete", undefined);
  });

  it("marks an empty stream failed", async () => {
    const events = { onEnd: vi.fn() };
    await collect(timedStream(streamOf([]), events));
    expect(events.onEnd).toHaveBeenCalledWith("failed", expect.any(Error));
  });

  it("cancels upstream and reports cancelled when the reader goes away", async () => {
    const upstreamCancel = vi.fn();
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(1));
      },
      cancel: upstreamCancel,
    });
    const events = { onEnd: vi.fn() };
    const reader = timedStream(upstream, events).getReader();
    expect((await reader.read()).value).toEqual(bytes(1));
    await reader.cancel("new question");
    expect(upstreamCancel).toHaveBeenCalledWith("new question");
    expect(events.onEnd).toHaveBeenCalledWith("cancelled", undefined);
  });

  it("propagates an upstream error as failed", async () => {
    const upstream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(1));
        controller.error(new Error("socket closed"));
      },
    });
    const events = { onEnd: vi.fn() };
    await expect(collect(timedStream(upstream, events))).rejects.toThrow("socket closed");
    expect(events.onEnd).toHaveBeenCalledWith("failed", expect.any(Error));
  });
});
