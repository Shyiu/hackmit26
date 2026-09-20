// Wraps a provider's audio stream so the route can record time to first audio
// and the final outcome without touching the bytes. Nothing is buffered: each
// chunk goes straight to the response.

export type TimedStreamEvents = {
  /** Milliseconds from `startedAt` to the first audio byte. */
  onFirstByte?: (ms: number) => void;
  onEnd?: (outcome: "complete" | "failed" | "cancelled", error?: unknown) => void;
};

export function timedStream(
  source: ReadableStream<Uint8Array>,
  events: TimedStreamEvents,
  startedAt = performance.now(),
  now: () => number = () => performance.now(),
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let sawAudio = false;
  let ended = false;
  const end: TimedStreamEvents["onEnd"] = (outcome, error) => {
    if (ended) return;
    ended = true;
    events.onEnd?.(outcome, error);
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let next: Awaited<ReturnType<typeof reader.read>>;
      try {
        next = await reader.read();
      } catch (error) {
        controller.error(error);
        end("failed", error);
        return;
      }
      if (next.done) {
        controller.close();
        end(sawAudio ? "complete" : "failed", sawAudio ? undefined : new Error("provider sent no audio"));
        return;
      }
      if (!sawAudio && next.value.byteLength > 0) {
        sawAudio = true;
        events.onFirstByte?.(now() - startedAt);
      }
      controller.enqueue(next.value);
    },
    async cancel(reason) {
      // The phone went away or asked something else; stop paying for audio.
      await reader.cancel(reason).catch(() => null);
      end("cancelled");
    },
  });
}
