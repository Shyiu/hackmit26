# Speech and embedding model choices

Researched on 2026-09-19 for the memory glasses plan in `PLAN.md`. The question for each stage is which model to use today, given a one second median from end of speech to first audio.

How to read the numbers. A vendor claim is a number the vendor published about its own product. An independent number comes from someone who doesn't sell that product. I keep the two apart in every section. Four research subagents and I read pages through a fetch tool that summarises each page with a small model. I fetched the numbers behind each pick a second time myself. "What I couldn't verify" near the end lists the rest.

## The picks

| Stage | Pick | Runner-up | Why |
|---|---|---|---|
| 1. Streaming speech to text | Deepgram Flux, `flux-general-en` | Soniox `stt-rt-v5` | Flux has a turn model, a timeout we can raise to 60 s, and an eager event that lets us speculate. Soniox measured fewer false cutoffs but caps waiting at 3 s |
| 2. Text to speech | ElevenLabs Flash v2.5 | Deepgram Flux TTS | Flash v2.5 is the only allowed model with an independent P95 under 250 ms. Flux TTS slows to 0.5x and has a calm setting but nobody outside Deepgram has timed it |
| 2b. Outsider worth raising | Inworld TTS-2 | none | Beats both allowed vendors on independent latency, blind preference and price |
| 3. OpenAI Realtime API | Don't use it for the main loop | `gpt-realtime-2.1` as an LLM path fallback | It runs the model for every spoken word, and 0.97 s to first audio eats the whole fast path budget |
| 4a. Keyframe description | `gpt-5.6-luna`, reasoning effort `none` | `gpt-5.6-terra` | $0.11 a day for 300 keyframes at 1280x720. Terra costs ten times more |
| 4b. Question-time chat with tools | `gpt-5.6-luna`, reasoning effort `none` | `gpt-5.6-terra`, then `gpt-4.1-mini` | Lowest measured first token time in the current family at 0.78 s |
| 5. Text embeddings | `text-embedding-3-small` at 512 dimensions | Atlas automated embedding with `voyage-4` | Quality doesn't decide this at a few thousand short sentences. OpenAI is GA and returns vectors our code can hold in memory |
| 6. Image embeddings for rooms | DINOv3 ViT-B/16 through timm, 768 dimensions | DINOv2 ViT-B/14 with registers | DINO features recognise the same physical place far better than CLIP-style features |
| 7. Wake word | sherpa-onnx keyword spotting | livekit-wakeword on iOS, openWakeWord in the browser | Picovoice ended its free plans. sherpa-onnx needs no training and no account |
| 8. Atlas M0 | It works for this plan | Flex if we need a fourth index | MongoDB 8.0, three search indexes of any type, `$rankFusion` yes, `$scoreFusion` no, automated embedding yes with a rate cap |

## 1. Streaming speech to text

### What decides it

The README budgets 300 ms from end of speech to final transcript. That number mixes two things. Finalising a transcript after the vendor knows the turn ended is fast everywhere. Deciding that the turn ended is slow, and it's the part that fails for slow speakers.

[Artificial Analysis](https://artificialanalysis.ai/speech-to-text/streaming) forces an endpoint and then times the final transcript, so it measures finalising only, as its [methodology page](https://artificialanalysis.ai/speech-to-text/methodology) explains. On that test Flux finalises in 0.02 s and Cartesia Ink-2 with external endpoints in 0.07 s. The [Pipecat STT benchmark](https://github.com/pipecat-ai/stt-benchmark) times from a detected speech stop to the final segment over 1,000 samples. Its medians sit between 247 ms and 369 ms for every serious vendor except OpenAI.

| Model | Pipecat semantic WER | Pipecat median | Pipecat P95 | Pipecat P99 |
|---|---|---|---|---|
| Deepgram `nova-3-general` | 1.62% | 247 ms | 298 ms | 326 ms |
| Soniox `stt-rt-v5` | 1.27% | 260 ms | 305 ms | 313 ms |
| AssemblyAI `universal-3-5-pro` | 1.22% | 282 ms | 354 ms | 393 ms |
| Cartesia `ink-2` | 1.25% | 299 ms | 328 ms | 1584 ms |
| ElevenLabs `scribe_v2_realtime` | 3.12% | 281 ms | 348 ms | 407 ms |
| Speechmatics `linden-1` | 1.05% | 369 ms | 438 ms | 690 ms |
| OpenAI `gpt-4o-transcribe` | 3.06% | 637 ms | 965 ms | 1655 ms |
| OpenAI `gpt-realtime-whisper` | 2.73% | 740 ms | 878 ms | 1080 ms |

Flux isn't in the Pipecat table.

The only independent test of the turn decision itself is [LiveKit's eot-bench](https://github.com/livekit/eot-bench). It plays real human-to-agent turns and trades waiting time against false cutoffs. LiveKit sells a turn detector and ranks itself first, so I use the table only to compare the other vendors with each other.

| System | False cutoffs at a 300 ms budget | At 600 ms | Wait needed for 5% false cutoffs | For 10% |
|---|---|---|---|---|
| Deepgram Flux | 12.9% | 9.9% | 1151 ms | 548 ms |
| Soniox | can't reach | 5.5% | 647 ms | 512 ms |
| AssemblyAI | 49.4% | 14.6% | 1049 ms | 713 ms |
| Cartesia Ink-2 | can't reach | can't reach | 1056 ms | 911 ms |
| OpenAI GPT Realtime 2 | can't reach | can't reach | 1143 ms | 824 ms |

No vendor gets below 5% false cutoffs in under about 650 ms. A 300 ms line in our budget is not reachable with a patient turn detector. The fix is to start the lookup and the TTS request before the turn is confirmed. The revised latency budget below counts on it.

### Older and hesitant speakers

No vendor publishes accuracy on older adults, dementia or dysarthric speech. Three outside sources help.

- A [Common Voice age study on GitHub](https://github.com/Kayvan-Zahiri/asr-age-gap) found Whisper large-v3 word error rate didn't get worse with age, 6.53% for speakers in their twenties and 4.67% in their seventies. A fixed 700 ms silence cutoff would cut off 8.0% of sentences from speakers in their twenties, 19.7% in their sixties and 22.1% in their eighties. The authors say a semantic turn model closes most of that gap. It isn't peer reviewed, the speakers are healthy volunteers reading short sentences, and real conversation has longer pauses.
- A [TORGO study of commercial systems](https://arxiv.org/abs/2512.17474) tested AssemblyAI, Whisper large-v3, Deepgram Nova-3, GPT-4o and Gemini 2.5. Mild dysarthria scored about 1 to 2% word error rate on the best systems. Severe dysarthria passed 51% on all of them.
- A [Dutch older-adult study](https://arxiv.org/abs/2508.08684) found generic models beat fine-tuned ones. Its abstract names no commercial API.

The age study is the reason to drop Nova-3. Its turn ending is a [silence timer](https://developers.deepgram.com/docs/endpointing) and nothing else, and a silence timer is what fails older speakers two to three times as often.

### Deepgram Flux

- The endpoint is `wss://api.deepgram.com/v2/listen?model=flux-general-en`, and Deepgram recommends 80 ms audio chunks, per the [Flux quickstart](https://developers.deepgram.com/docs/flux/quickstart).
- The [configuration page](https://developers.deepgram.com/docs/flux/configuration) gives three settings. `eot_threshold` runs 0.5 to 1.0 with a default of 0.7. `eager_eot_threshold` runs 0.3 to 0.9 and is off by default. `eot_timeout_ms` runs 500 to 60,000 with a default of 5,000.
- The same page says to raise `eot_timeout_ms` to 7,000 to 10,000 "for users with frequent pauses". Its high-reliability preset is `eot_threshold` 0.85 with an 8,000 ms timeout.
- Events are `EagerEndOfTurn`, `TurnResumed` and `EndOfTurn`, described in the [eager end-of-turn guide](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot). The transcript on `EndOfTurn` matches the eager one, so work started on the eager event stays valid.
- Flux accepts `keyterm`, per the [API reference](https://developers.deepgram.com/reference/speech-to-text/listen-flux). We should pass every tracked item name and alias.
- Vendor claims from the [launch post](https://deepgram.com/learn/introducing-flux-conversational-speech-recognition). End of turn lands under 500 ms at the median, about 1 s at p90 and about 1.5 s at p95. The eager event fires 150 to 250 ms before `EndOfTurn` and causes 50 to 70% more LLM calls. Accuracy "matches Nova-3". The quickstart says "~260ms end-of-turn detection".
- Independent accuracy. A research subagent read 7.39% on Artificial Analysis for Flux against 6.59% for Nova-3. I confirmed the Nova-3 figure and the 0.02 s Flux finalising time in the page data, not the Flux word error rate.
- Price is [$0.0065 a minute](https://deepgram.com/pricing) for English, listed as a promotional rate against a regular $0.0077. New accounts get $200 of credit.
- Browser and phone auth uses [`POST /v1/auth/grant`](https://developers.deepgram.com/reference/auth/tokens/grant). The token lives 30 s by default and 3,600 s at most, and it only has to be valid when the socket opens, per the [token guide](https://developers.deepgram.com/guides/fundamentals/token-based-authentication).
- It takes `linear16` at 16,000 Hz, which is what the hands-free profile gives us.

### Soniox v5 real-time

- Soniox calls its method semantic endpointing. It reads pauses, intonation and context, and returns an `<end>` token, per its [endpoint detection page](https://soniox.com/docs/stt/rt/endpoint-detection).
- `max_endpoint_delay_ms` runs 500 to 3,000 with a default of 2,000. `endpoint_sensitivity` runs from -1.0 to 1.0. `endpoint_latency_adjustment_level` runs 0 to 3.
- The 3 s ceiling is the problem for us. Any pause over 3 s forces an endpoint whatever the words were.
- It has no eager event. We'd speculate on partial transcripts ourselves.
- Price is [$0.12 an hour](https://soniox.com/pricing), a third of Flux.
- Browser auth uses a [temporary API key endpoint](https://soniox.com/docs/api-reference/auth/create_temporary_api_key) with a lifetime up to 3,600 s. The [WebSocket API](https://soniox.com/docs/api-reference/stt/websocket-api) takes `pcm_s16le` with a stated sample rate.
- Artificial Analysis lists Soniox real-time at about 4.5% word error rate.

### The others

- OpenAI. The current realtime transcription model is `gpt-live-transcribe` at [$0.017 a minute](https://developers.openai.com/api/docs/pricing), 2.6 times the Flux price, per the [realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription). `gpt-4o-transcribe` and `whisper-1` shut down on 2027-02-26 per the [deprecations page](https://developers.openai.com/api/docs/deprecations). Turn detection is good on paper. `semantic_vad` at `low` eagerness "will let the user take their time to speak", per the [VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad), and the [session reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create) gives it an 8 s maximum wait. Two things rule it out. Pipecat's medians for OpenAI are 637 to 740 ms, and the WebSocket input takes [24 kHz PCM or G.711 only](https://developers.openai.com/api/reference/resources/realtime/client-events), so we'd resample every frame.
- AssemblyAI Universal-3.5 Pro. It has the best accuracy of the mainstream group and a [`max_accuracy` mode](https://www.assemblyai.com/docs/streaming/universal-3-pro/turn-detection-and-partials) with 512 ms and 2,560 ms silence bounds. Its eot-bench numbers are the worst of the vendors tested. It costs [$0.45 an hour and bills from socket open to close](https://www.assemblyai.com/pricing).
- Cartesia Ink-2. It documents a [Patient profile](https://docs.cartesia.ai/use-the-api/stt/turns.md) for users who "pause to think", with an 8,000 ms timeout and eager and resume events like Flux. eot-bench puts it at 911 to 1,056 ms, too slow for us.
- Two models shipped this month. [xAI Grok Voice Transcribe 2.0](https://x.ai/news/grok-voice-transcribe-2) came out on 2026-09-18 and [Meta Muse Voice Transcribe](https://developer.meta.com/ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/) on 2026-09-03. Both top the Artificial Analysis accuracy list at 2.73% and 3.06%. Neither has an independent turn-taking result or a documented browser token flow that I could find. Too new to build a 24 hour project on.

### The call

Flux, with Soniox as the challenger behind one `STTProvider` interface.

The independent turn data favours Soniox, and I'm overriding it for a reason specific to this product. A false cutoff hurts a general voice agent because the agent answers half a question. Ours can refuse to. If the router sees "where are my" with no item, it keeps the mic open and joins the next segment. That makes a false cutoff cost a few hundred milliseconds, not a wrong answer. What we can't repair is a hard ceiling on patience, and Soniox has one at 3 s. Flux also hands us the eager event, which we need anyway to reach one second.

Start with `eot_threshold` 0.8, `eager_eot_threshold` 0.4, `eot_timeout_ms` 8000, and `keyterm` for every item name. Record the golden question set as audio with 1 to 4 s pauses inside sentences and run both vendors over it on day one. If Soniox cuts off fewer complete questions and the 3 s ceiling never triggers on real recordings, switch.

## 2. Text to speech

### Independent latency

[Coval](https://benchmarks.coval.ai/benchmarks/time-to-first-audio) tests voice agents and doesn't sell TTS. It measures time to the first audible sample, which includes any silence at the start of the stream. It excludes connection setup, runs from AWS us-east-1, and reports a rolling 30 days, per its [methodology](https://raw.githubusercontent.com/coval-ai/benchmarks/main/docs/methodology.md). That matches our plan of a warm connection in `us-east-1`. Read on 2026-09-19.

| Model | P50 | P95 | P99 |
|---|---|---|---|
| [Inworld TTS-2 Flash](https://benchmarks.coval.ai/models/inworld-tts-2-flash) | 73 ms | 140 ms | 194 ms |
| [Inworld TTS-2](https://benchmarks.coval.ai/models/inworld-tts-2) | 166 ms | 235 ms | 307 ms |
| [ElevenLabs Flash v2.5](https://benchmarks.coval.ai/models/eleven_flash_v2_5) | 185 ms | 231 ms | 389 ms |
| Gradium | 214 ms | 349 ms | 386 ms |
| Rime Mist v3 | 255 ms | 295 ms | 351 ms |
| [Cartesia Sonic 3.5](https://benchmarks.coval.ai/models/sonic-3.5) | 276 ms | 355 ms | 419 ms |
| [Deepgram Aura-2](https://benchmarks.coval.ai/models/aura-2-thalia-en) | 289 ms | 528 ms | 579 ms |
| ElevenLabs v3 Conversational | 333 ms | 439 ms | not read |
| [Cartesia Sonic 3.6](https://benchmarks.coval.ai/models/sonic-3.6) | 375 ms | 633 ms | not read |
| [OpenAI `gpt-4o-mini-tts`](https://benchmarks.coval.ai/models/gpt-4o-mini-tts) | 579 ms | 3927 ms | 5273 ms |

Deepgram Flux TTS is not on the board.

The README cites 288 ms and 313 ms from the [Gradium benchmark page](https://gradium.ai/content/tts-latency-benchmark-2026). Gradium sells TTS, and its page now repeats Coval's board. Its 2026-09-08 reading was 185 and 225 ms for Flash v2.5 and 290 and 522 ms for Aura-2. The [Vapi Humanness Index](https://humannessindex.vapi.ai/models/elevenlabs-flash-v2-5) got a 197 ms median for Flash v2.5 over 50 streaming trials.

### Vendor latency claims

- ElevenLabs says Flash v2.5 runs at ["~75ms"](https://elevenlabs.io/docs/overview/models) of model time with network excluded, and 100 to 150 ms to first byte over WebSocket in North America, per its [latency guide](https://elevenlabs.io/docs/best-practices/latency-optimization). v3 Conversational is "~280ms".
- Deepgram says Aura-2 is ["sub-200ms"](https://deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech) to first byte.
- Deepgram says Flux TTS is ["as low as 80ms"](https://deepgram.com/learn/introducing-flux-tts-conversation-native-text-to-speech-for-real-time-voice-agents) and under 200 ms whatever the reply length.
- Cartesia says ["sub-90ms"](https://cartesia.ai/sonic). Coval measured 276 ms for Sonic 3.5 and 375 ms for Sonic 3.6. That gap is why vendor claims get their own list.

### Warmth

The [Artificial Analysis speech arena](https://artificialanalysis.ai/text-to-speech/leaderboard) ranks models by blind listener votes. Read on 2026-09-19.

| Model | Elo | Rank |
|---|---|---|
| Cartesia Sonic 3.6 | 1276 | 1 |
| Inworld TTS-2 | 1247 | 3 |
| Inworld TTS-2 Flash | 1215 | 6 |
| ElevenLabs v3 Conversational | 1197 | 10 |
| OpenAI TTS-1 HD | 1105 | 30 |
| ElevenLabs Flash v2.5 | 1078 | 42 |

Deepgram has no row, so no independent score exists for Aura-2 or Flux TTS. Deepgram reports a [73.4% win rate for Flux TTS](https://deepgram.com/product/text-to-speech/flux) across 12 models in its own blind test. That's a vendor claim.

The README says ElevenLabs is the warmer voice. For Flash v2.5 the arena doesn't support that. Rank 42 is the price of 75 ms inference. The warm ElevenLabs model is v3 Conversational, and at 333 ms P50 it misses our budget.

### Controls we need

| | ElevenLabs Flash v2.5 | Deepgram Flux TTS | Deepgram Aura-2 |
|---|---|---|---|
| Speaking rate | [`voice_settings.speed`, 0.7 to 1.2](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input) | [`speed`, 0.5 to 1.5 in 0.05 steps, changeable mid-session](https://developers.deepgram.com/docs/flux-tts/feature-overview) | [`speed`, 0.7 to 1.5](https://developers.deepgram.com/docs/tts-voice-controls) |
| Tone control | voice choice only | `expressivity` from -2 calm to 2 animated, in beta | voice choice only |
| 16 kHz PCM | [`output_format=pcm_16000`](https://elevenlabs.io/docs/api-reference/text-to-speech/stream) | `encoding=linear16&sample_rate=16000` | [`encoding=linear16&sample_rate=16000`](https://developers.deepgram.com/docs/tts-media-output-settings) |
| Streaming text in | `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input` with `flush` | [`wss://api.deepgram.com/v2/speak`](https://developers.deepgram.com/docs/flux-tts/quickstart) with `Speak` and `Flush` | [`wss://api.deepgram.com/v1/speak`](https://developers.deepgram.com/reference/text-to-speech/speak-streaming) with `Speak` and `Flush` |
| Price per 1M characters | [$50](https://elevenlabs.io/pricing/api) | [$45](https://deepgram.com/pricing) | [$30](https://deepgram.com/pricing) |
| Free allowance | 10k credits a month, which is 20,000 Flash characters at 0.5 credit each, per the [plans page](https://elevenlabs.io/pricing) | $200 credit across the account | same $200 |
| Concurrency on the lowest plan | [4 on Free, 6 on Starter](https://elevenlabs.io/docs/overview/models) | [45 WebSocket connections](https://developers.deepgram.com/reference/api-rate-limits) | 45 |

One ElevenLabs detail will bite. The WebSocket buffers text until it has about 120 characters, because the default `chunk_length_schedule` is `[120,160,250,290]`. Our whole fast path answer is about 95 characters. Send `flush: true` with the text or set `auto_mode`, or the socket waits for text that never comes. For the template path the plain HTTP streaming endpoint is simpler, since we have the full text up front.

Flux TTS went GA on 2026-08-12, per [Deepgram's launch post](https://deepgram.com/learn/text-to-speech-comes-of-age-deepgram-launches-conversation-native-speech). It's English only. Its [voice list](https://developers.deepgram.com/docs/flux-tts/voices) includes `flux-sean-en`, described as friendly, kind, caring and calming, and `flux-sienna-en`, described as calm, warm and caring.

### The others

- Cartesia Sonic 3.6 leads the arena and takes [`pcm_s16le` at 16,000 Hz with a speed of 0.6 to 1.5](https://docs.cartesia.ai/api-reference/tts/websocket). At 375 ms P50 and 633 ms P95 it's too slow here.
- OpenAI `gpt-4o-mini-tts` streams over chunked HTTP, outputs [24 kHz PCM only](https://developers.openai.com/api/docs/guides/text-to-speech) and has no incremental text socket. Coval's 579 ms P50 and 3.9 s P95 rule it out. It does accept a [`speed` from 0.25 to 4.0](https://developers.openai.com/api/docs/api-reference/audio/createSpeech).

### The call between the two allowed vendors

1. ElevenLabs Flash v2.5. It's the only one with independent proof of first audio under 250 ms at P95. It outputs 16 kHz PCM. Its weak points are rank 42 for naturalness and a 0.7 floor on speed. Pick the voice by ear and start near 0.85.
2. Deepgram Flux TTS. On paper it fits this listener better than anything else here. It slows to 0.5, changes rate mid-session, has a calm dial and voices written for a caring tone, costs less and shares a vendor with our STT. Every number about it comes from Deepgram, and it's five weeks old. `pnpm bench:tts` should time it from the demo network on day one. If it lands under 200 ms, make it the default.
3. Deepgram Aura-2. Cheapest, and too slow. A 528 ms P95 alone spends a third of our P95 target.

The README says a 25 ms gap can't settle the choice. The gap is now 104 ms at P50 and 297 ms at P95 between Flash v2.5 and Aura-2. It settles it.

### The outsider

Inworld TTS-2 beats both allowed vendors on every axis that has an independent number.

| | Inworld TTS-2 | ElevenLabs Flash v2.5 |
|---|---|---|
| Coval P50 and P95 | 166 and 235 ms | 185 and 231 ms |
| Arena Elo | 1247 | 1078 |
| Price per 1M characters | [$25](https://inworld.ai/pricing) | $50 |
| Speed floor | [`speakingRate` 0.5](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket) | 0.7 |
| 16 kHz PCM | `LINEAR16` with `sampleRateHertz` 16000 | `pcm_16000` |

A 169 point Elo gap means listeners would prefer TTS-2 about 73% of the time. That's my arithmetic from the Elo formula, 1 / (1 + 10^(-169/400)). For an anxious older listener, voice quality is the product. The catch is 5 concurrent requests on the on-demand plan and a 70 minute free allowance. I'd raise it with the owner and add it to the benchmark script. It costs one more `TTSProvider` implementation.

## 3. OpenAI Realtime API

- `gpt-realtime-2`, the ID in the README, exists. It shipped on 2026-05-07. [`gpt-realtime-2.1` and `gpt-realtime-2.1-mini`](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896) replaced it on 2026-07-06 at the same price, with better handling of silence, noise and interruptions. The [Realtime guide](https://developers.openai.com/api/docs/guides/realtime) names 2.1 for speech-to-speech agents.
- `gpt-live-1` went GA on 2026-09-10, per the [changelog](https://developers.openai.com/api/docs/changelog). The [models page](https://developers.openai.com/api/docs/models) calls it the premier voice model. It runs on `v1/live/sessions`, is full duplex, and hands reasoning and tools to a backend model, per its [model page](https://developers.openai.com/api/docs/models/gpt-live-1).
- The original `gpt-realtime` and `gpt-realtime-mini` shut down on 2027-01-20, per the [deprecations page](https://developers.openai.com/api/docs/deprecations).

### Price

From the [pricing page](https://developers.openai.com/api/docs/pricing), per 1M tokens.

| Model | Audio in | Cached audio in | Audio out | Text in | Text out |
|---|---|---|---|---|---|
| `gpt-realtime-2.1` and `gpt-realtime-2` | $32 | $0.40 | $64 | $4 | $24 |
| `gpt-realtime-2.1-mini` | $10 | $0.30 | $20 | $0.60 | $2.40 |

The [voice cost guide](https://developers.openai.com/api/docs/guides/voice-latency-cost) says user audio is 1 token per 100 ms and assistant audio is 1 token per 50 ms. That's 600 tokens a minute in and 1,200 a minute out.

- `gpt-realtime-2.1` audio in: 600 x $32 / 1,000,000 = $0.0192 a minute.
- `gpt-realtime-2.1` audio out: 1,200 x $64 / 1,000,000 = $0.0768 a minute.
- `gpt-realtime-2.1-mini`: $0.006 a minute in and $0.024 a minute out by the same sums.
- `gpt-live-1` is $0.05 a minute of session time, silence included, with the backend model billed on top. An open session costs $3 an hour.

The same guide warns that the whole conversation is sent to the model on every response, so later turns cost more.

### Latency

OpenAI publishes no time to first audio. Its only number is a [25% cut in p95 latency](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896) from caching. [Artificial Analysis](https://artificialanalysis.ai/speech-to-speech) measures it independently. Read on 2026-09-19.

| Model and effort | Time to first audio | Big Bench Audio |
|---|---|---|
| GPT-Realtime-2.1, minimal | 0.97 s | 87% |
| GPT-Realtime-2.1, high | 1.21 s | 96% |
| GPT-Realtime-2.1 Mini, minimal | 0.85 s | 63% |
| GPT-Realtime-1.5 | 0.81 s | 81% |
| GPT-Live-1 with Sol at low | 1.24 s | 89% |

### Features

- Tools. The session takes `function` and `mcp` tool types, per the [client secrets reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), and the API can call [remote MCP servers](https://developers.openai.com/api/docs/guides/realtime-mcp) itself.
- Transports are WebRTC, WebSocket and SIP. OpenAI recommends [WebRTC for browsers and phones](https://developers.openai.com/api/docs/guides/voice-webrtc), with an ephemeral key from `POST /v1/realtime/client_secrets` that lives 600 s by default.
- Turn detection. `server_vad` defaults to 500 ms of silence. `semantic_vad` at `low` eagerness waits up to 8 s. Setting `turn_detection` to null lets us commit audio ourselves.
- Voice. Ten voices, and `audio.output.speed` from 0.25 to 1.5, per the same reference.

### Does it fit

No, not as the main loop. Our fast path needs no model. The Realtime API can speak text we supply through `response.create` with instructions to say it exactly, per the [conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations). That still runs the model, bills audio out at $0.0768 a minute, and comes with no promise the words match. 0.97 s to first audio is our entire budget before network and Bluetooth. `gpt-live-1` is worse for us. Its [delegation guide](https://developers.openai.com/api/docs/guides/live-delegation) says injected commentary is "trained to paraphrase the text", and it exposes no pause tuning.

Keep it where the README has it, as the fallback if the three-vendor chain gets flaky, and only for the LLM path. Change the ID to `gpt-realtime-2.1`, set effort to `minimal`, `semantic_vad` to `low`, `speed` below 1.0.

## 4. OpenAI model tier

### The current lineup

From the [pricing page](https://developers.openai.com/api/docs/pricing), standard tier, per 1M tokens.

| Model | Input | Cached input | Output |
|---|---|---|---|
| `gpt-6-astra` | $10 | $1 | $50 |
| `gpt-5.6-sol` | $4 | $0.40 | $20 |
| `gpt-5.6-terra` | $2 | $0.20 | $12 |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 |
| `gpt-4.1-mini` | $0.40 | $0.10 | $1.60 |

The GPT-5.6 family launched on 2026-07-09 and GPT-6 Astra on 2026-09-03, per the [changelog](https://developers.openai.com/api/docs/changelog). OpenAI says [Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) is the mini tier and [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna) the nano tier. All three 5.6 models take images and support structured outputs, function calling and streaming. Reasoning effort takes `none`, `low`, `medium`, `high`, `xhigh` and `max`, and the default is `medium`, per the [GPT-5.6 guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6). Set it to `none` in code. Leaving the default on would triple our first token time. `gpt-6-astra` doesn't support `none`.

### Image tokens

The [vision guide](https://developers.openai.com/api/docs/guides/images-vision) prices GPT-5.6 images by 32 px patches. Tokens are `ceil(width/32) x ceil(height/32)` times 1.2, rounded up. `high` detail fits the image within 2048 x 2048 pixels and 2,500 patches. `low` fits it within 512 x 512. `auto` behaves like `original` on this family, so set `detail` ourselves.

- 1280 x 720 at `high`: 40 x 23 = 920 patches, x 1.2 = 1,104 tokens.
- 768 x 432 at `high`: 24 x 14 = 336 patches, x 1.2 = 404 tokens.
- Any 16:9 frame at `low` becomes 512 x 288: 16 x 9 = 144 patches, x 1.2 = 173 tokens.

### Cost for 300 keyframes a day

Each call is the image, about 300 prompt tokens, and 80 output tokens, at effort `none`.

| Model and image | Input tokens | Cost per frame | Per day | Per 30 days |
|---|---|---|---|---|
| Luna, 1280 x 720 high | 1,404 | 1,404 x $0.20/1M + 80 x $1.20/1M = $0.000377 | $0.113 | $3.39 |
| Luna, 768 x 432 high | 704 | $0.000141 + $0.000096 = $0.000237 | $0.071 | $2.13 |
| Luna, low detail | 473 | $0.000095 + $0.000096 = $0.000191 | $0.057 | $1.72 |
| Terra, 1280 x 720 high | 1,404 | 1,404 x $2/1M + 80 x $12/1M = $0.003768 | $1.13 | $33.91 |
| `gpt-5.4-mini`, 1280 x 720 high | 1,404 | $0.001053 + $0.00036 = $0.001413 | $0.42 | $12.72 |

One wrinkle. On GPT-5.6, [cache writes cost 1.25 times the input rate](https://developers.openai.com/api/docs/guides/prompt-caching) once a prompt passes 1,024 tokens. The 1280 x 720 request passes it. Worst case is 1,404 x $0.25/1M + $0.000096 = $0.000447 a frame, $4.02 per 30 days. Setting `prompt_cache_options.mode` to `explicit` with no breakpoints avoids it.

[Batch](https://developers.openai.com/api/docs/guides/batch) is half price and finishes within 24 hours. [Flex](https://developers.openai.com/api/docs/guides/flex-processing) is the same price with slower and sometimes unavailable responses. We want the sentence within seconds of the sighting, and the saving is $1.70 a month. Skip both.

Send 1280 x 720 at `high`. The extra $1.26 a month over the downscale buys the model a better look at small items and the things next to them, and the sentence depends on both. `low` detail at 512 x 288 is too coarse to read a countertop.

### Time to first token

OpenAI publishes none. Artificial Analysis measures the OpenAI API with text prompts, and an image will add time it doesn't measure. Read on 2026-09-19.

| Model and effort | First token | Output speed |
|---|---|---|
| [GPT-5.6 Luna, none](https://artificialanalysis.ai/models/gpt-5-6-luna-non-reasoning) | 0.78 s | 117 tok/s |
| [GPT-5.6 Luna, low](https://artificialanalysis.ai/models/gpt-5-6-luna-low) | 1.75 s | 127 tok/s |
| [GPT-5.6 Terra, none](https://artificialanalysis.ai/models/gpt-5-6-terra-non-reasoning) | 0.98 s | 73 tok/s |
| [GPT-5.6 Terra, low](https://artificialanalysis.ai/models/gpt-5-6-terra-low) | 2.03 s | 68 tok/s |
| [GPT-5.4 mini, none](https://artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning) | 0.89 s | 177 tok/s |
| [GPT-4.1 mini](https://artificialanalysis.ai/providers/openai) | 0.89 s | 139 tok/s |

[Fast mode](https://developers.openai.com/api/docs/guides/fast-mode), the renamed priority tier, promises "up to 2.5x faster speeds" at about twice the price and gives no first token figure. Its guide names Sol and not Luna, while the pricing page lists a Luna rate. Test before relying on it.

### The call

`gpt-5.6-luna` at effort `none` for both jobs, through the Responses API with structured outputs for the keyframe job.

For the chat job, `none` is the only effort that fits. `low` costs 1.75 s before any speech work. A tool call means two model calls, about 1.6 s before the first answer token, and that misses 2 s once endpointing and TTS are added. So don't make the common case a tool call. On a router miss, run `search_memories` and `list_recent_items` ourselves, put the results in the prompt, and let one model call answer. Keep the tools for the questions that still need them. The LLM path table in the revised latency budget shows the sums.

If Luna at `none` picks tools badly or writes stiff sentences, move the chat job to Terra. At about 3 LLM questions a day the price difference is under a cent. `gpt-4.1-mini` is the second fallback. It has no reasoning step, 0.89 s first token, and no shutdown date listed.

## 5. Text embeddings

### The models

| Model | Dimensions | Price per 1M tokens | Where it runs |
|---|---|---|---|
| [`text-embedding-3-small`](https://developers.openai.com/api/docs/guides/embeddings) | 1536, shortenable with `dimensions` | [$0.02](https://developers.openai.com/api/docs/pricing) | OpenAI API |
| `text-embedding-3-large` | 3072, shortenable | $0.13 | OpenAI API |
| [`voyage-4-lite`](https://docs.voyageai.com/docs/embeddings) | 1024 default, or 256, 512, 2048 | [$0.02](https://docs.voyageai.com/docs/pricing) | Voyage API, Atlas API, Atlas automated embedding |
| `voyage-4` | same | $0.06 | same |
| `voyage-4-large` | same | $0.12 | same |

OpenAI lists nothing newer than the v3 pair. Voyage gives 200M free tokens per model.

### What Atlas supports today

[Automated embedding](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/) went to public preview on Atlas on [2026-05-11](https://www.mongodb.com/company/blog/product-release-announcements/ai-search-for-agents-announcing-automated-embedding-atlas). The [model list](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/) is `voyage-4-lite`, `voyage-4`, `voyage-4-large`, `voyage-code-4` and the legacy `voyage-code-3`. MongoDB recommends `voyage-4` for general text.

You declare a field as `type: "autoEmbed"` with `modality: "text"` and a `model` in the vector index. Atlas embeds the field at write time, keeps it in sync when the text changes, and embeds the query string inside `$vectorSearch` at read time. So yes, for sighting search it removes every embedding call from both services. The perception service writes `sentence` and nothing else.

Three catches.

- The docs say "Do not use this feature in your production environment." It's a preview.
- Query-time embedding on an M0 cluster with no payment method is capped at 3 requests a minute and 2,000 tokens a minute. With a card on file it's 2,000 requests a minute. Index-time embedding is 2,000 a minute either way. Add a card before the demo.
- Atlas stores the vectors in an internal database on the cluster, not on our documents. The README's fuzzy item matching compares a phrase against 30 cached item vectors in app memory. That needs vectors our code can read, so it still needs a direct embedding call. MongoDB does offer one. The [Atlas Embedding and Reranking API](https://www.mongodb.com/docs/voyageai/api-reference/overview/) serves Voyage models at `https://ai.mongodb.com/v1/embeddings`, with the same 3 requests a minute limit until a card is added.

### Retrieval quality

OpenAI publishes MTEB averages of [62.3% for small and 64.6% for large](https://developers.openai.com/api/docs/guides/embeddings). Voyage doesn't publish MTEB averages. It publishes [RTEB](https://blog.voyageai.com/2026/01/15/voyage-4/), where it says `voyage-4-large` beats OpenAI v3 large by 14.05% and `voyage-4-lite` beats it by 3.87% on NDCG@10 across 29 datasets. That's a vendor claim. RTEB is run by the MTEB team, and [its announcement](https://huggingface.co/blog/rteb) lists MongoDB, Voyage's owner, among the contributors. I couldn't load the public leaderboard to check the OpenAI rows.

None of it matters much here. Our corpus is a few thousand sentences of ten words each, filtered to one wearer and a time window before the vector search runs. Any of these models will rank "on the kitchen counter" above "on the bedroom dresser" for a kitchen question.

### The call

`text-embedding-3-small` with `dimensions: 512`, called from app code. It's GA, it's the vendor the rest of the AI calls already use, and it gives us vectors for the in-memory item matching. Atlas automated embedding with `voyage-4` is the runner-up. Try it in M4 if there's time, because deleting the embedding code from two services is a real saving.

Why 512. M0 storage is 0.5 GB. By my arithmetic a 1536-number BSON array of doubles is about 20 KB, since each element carries a type byte, its index as a string key and 8 bytes of value. 300 sightings a day for 30 days is 9,000 documents, or about 180 MB of vectors before indexes. At 512 dimensions it's about 6.5 KB each and 59 MB total. OpenAI documents that shortened v3 embeddings keep their meaning.

## 6. Image embeddings for room classification

### Speed is not the constraint

Room classification runs on keyframes, about 300 a day, plus 20 to 50 enrollment frames per room. One second per image would be fine. That's good, because nobody publishes Mac throughput for any of these models. The only Apple hardware numbers I found are MobileCLIP2's iPhone 12 Pro Max latencies. So pick on recognition quality and license.

### Same place or same kind of place

Two different skills get called scene recognition. CLIP-style models are good at "this is a kitchen". We need "this is the same kitchen I enrolled".

The [DINOv3 paper](https://arxiv.org/html/2508.10104v1) tests both. On Places205 scene categories with a linear probe, the largest models tie. PE-core G scores 71.3, SigLIP 2 g 70.5, DINOv3 7B 70.0. On Oxford-Hard instance retrieval at ViT-B size they don't tie at all.

| ViT-B model | Oxford-Hard mAP |
|---|---|
| DINOv3 | 58.5 |
| DINOv2 | 51.0 |
| SigLIP 2 | 20.2 |
| PE-core | 20.2 |

The [AnyLoc paper](https://arxiv.org/html/2308.00688) compares a CLIP CLS token with a DINOv2 CLS token on place recognition, both from giant models. Indoors it's mixed. CLIP wins Baidu Mall with 56.0 against 49.2 recall at 1. DINOv2 wins Gardens Point with 71.5 against 42.5. 17 Places is a tie at 59.4 and 61.8. Across six datasets DINOv2 averages 64.4 against 53.7. Aggregating DINOv2 patch tokens with VLAD lifts the average to 86.5.

### The candidates

| Model | Embedding size | Image tower | License | Loads with |
|---|---|---|---|---|
| open_clip ViT-B/32, B/16, L/14 | [512, 512, 768](https://github.com/mlfoundations/open_clip/tree/main/src/open_clip/model_configs) | [88M, 86M, 304M params](https://github.com/mlfoundations/open_clip/blob/main/docs/model_profile.csv) | [MIT code](https://github.com/mlfoundations/open_clip/blob/main/LICENSE), MIT for [LAION-2B](https://huggingface.co/laion/CLIP-ViT-B-16-laion2B-s34b-b88K) and DataComp weights | open_clip |
| [SigLIP 2](https://huggingface.co/blog/siglip2) B, L, So400m, g | 768, 1024, 1152, 1536 | 86M to 1B | [Apache 2.0](https://huggingface.co/google/siglip2-base-patch16-224) | transformers, open_clip |
| [DINOv3](https://huggingface.co/facebook/dinov3-vitb16-pretrain-lvd1689m) S, S+, B, L | 384, 384, 768, 1024 | 21M, 29M, 86M, 300M | [DINOv3 License](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md) | timm, transformers |
| [DINOv2](https://github.com/facebookresearch/dinov2) S, B, L, g | 384, 768, 1024, 1536 | 21M to 1.1B | Apache 2.0 | torch.hub, transformers |
| [MobileCLIP2](https://github.com/apple/ml-mobileclip) S0 to L/14 | 512 or 768 | 11M to 304M | MIT code, [research-only weights](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS) | open_clip |
| [`voyage-multimodal-3.5`](https://docs.voyageai.com/docs/multimodal-embeddings) | 1024 default | cloud API | commercial API, [$0.60 per billion pixels](https://docs.voyageai.com/docs/pricing) | HTTP |

Notes on each.

- DINOv3's license is custom. It allows commercial use and isn't OSI open source. It bans military and weapons uses and requires redistribution under the same terms. Meta's Hugging Face repos need a manual access request. The [timm mirror](https://huggingface.co/timm/vit_base_patch16_dinov3.lvd1689m) doesn't, and lists ViT-B/16 at 85.6M parameters, 23.6 GMACs at 256 px and 768 dimensions.
- MobileCLIP2 is the fastest, 3.6 ms for the S2 image tower on an iPhone 12 Pro Max. Apple's model license limits the weights to research and rules out "product development". Fine for a demo, a dead end after. Apple's DFN CLIP weights carry the same [`apple-amlr` tag](https://huggingface.co/apple/DFN2B-CLIP-ViT-B-16).
- Voyage multimodal is [available through Atlas](https://www.mongodb.com/docs/voyageai/models/multimodal-embeddings/). Its published results are on screenshots, PDFs and slides, not rooms. A 720p frame costs about $0.00055 by my arithmetic. The real objection is that every enrollment frame of someone's home would go to one more cloud API. Atlas automated embedding lists text models only.
- Dedicated place-recognition models exist. [MegaLoc](https://arxiv.org/html/2502.17237) reaches 87.7 recall at 1 on Baidu Mall with an MIT license, but its descriptor is 8,448 numbers and [Atlas indexes stop at 8,192](https://www.mongodb.com/docs/vector-search/deployment/compatibility-limitations/). These models target metre-level localisation over thousands of images. Six rooms with 30 frames each doesn't need that.

### The call

DINOv3 ViT-B/16 through timm, CLS token, 768 dimensions, cosine similarity. Drop to ViT-S+ at 384 dimensions if the laptop struggles. DINOv2 ViT-B/14 with registers is the runner-up and the right choice if anyone wants a true Apache 2.0 license.

The indoor CLS-token evidence is mixed enough that I wouldn't trust any pick blind. After enrolling two similar rooms, hold out one frame in five and check top-5 vote accuracy. It takes ten minutes. If rooms get confused, concatenate the CLS token with the mean of the patch tokens before reaching for MegaLoc.

## 7. On-device wake word

### Porcupine is no longer the safe pick

The README plans on Picovoice Porcupine. Picovoice's [FAQ](https://picovoice.ai/docs/faq/general/) now says "there are no dedicated free or paid plans for personal or non-commercial use" and offers only a one-time "Free Trial for enterprise developers". The pricing page redirects to a contact form. A [Home Assistant forum thread](https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744) reports that free AccessKeys stopped working on 2026-06-30 and that the trial lasts 7 days and needs approval. That date comes from the forum, not from Picovoice.

The product itself is still the best documented. It has [iOS](https://picovoice.ai/docs/quick-start/porcupine-ios/) and [Web](https://picovoice.ai/docs/quick-start/porcupine-web/) SDKs, trains a custom word ["in seconds"](https://picovoice.ai/docs/faq/porcupine/), and claims 97% detection at under one false alarm per 10 hours. Apply for the trial on day zero. Don't plan around getting it.

### The alternatives

| | iOS | Browser | Custom word | License | Published accuracy |
|---|---|---|---|---|---|
| [sherpa-onnx keyword spotting](https://k2-fsa.github.io/sherpa/onnx/kws/index.html) | yes, Swift API | yes, WebAssembly | a line in a text file, no training | [Apache 2.0](https://github.com/k2-fsa/sherpa-onnx) | none |
| [livekit-wakeword](https://github.com/livekit/livekit-wakeword) | yes, Swift package, iOS 16+ | no SDK | train from one YAML config on synthetic speech, time not published | Apache 2.0 | 0.08 false positives an hour at 86.1% recall, on its own synthetic test set |
| [openWakeWord](https://github.com/dscripka/openWakeWord) | no official support | not on its roadmap, community ports exist | Colab notebook, under an hour | Apache 2.0 code, CC BY-NC-SA pretrained models | targets of under 0.5 false accepts an hour and under 5% false rejects |
| Porcupine | yes | yes | seconds in the console | Apache 2.0 SDK, AccessKey required | vendor claim above |

- sherpa-onnx is an open-vocabulary spotter. Its docs describe it as a tiny speech recogniser that only decodes the phrases you list, so "you can specify any keywords without re-training the model". Each keyword line takes a boost score and a trigger threshold. The English model has 3.3M parameters. The repo lists keyword spotting, iOS, WebAssembly, Swift and JavaScript as supported.
- livekit-wakeword is new in 2026 and builds on openWakeWord's front end. Its benchmark has openWakeWord's DNN at 8.50 false positives an hour and 68.6% recall on the same set. LiveKit wrote the benchmark.
- openWakeWord's last release was v0.6.0 in February 2024. Two community browser ports run its ONNX models, [`openwakeword-web`](https://registry.npmjs.org/openwakeword-web) and [`openwakeword-wasm-browser`](https://github.com/dnavarrom/openwakeword_wasm). Both are version 0.1.
- The browser's Web Speech API lets the browser [choose local or remote processing](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), which breaks our rule that no audio leaves the device before the wake word. Apple's `SFSpeechRecognizer` can stay on device but Apple says to [plan for a one minute limit](https://developer.apple.com/documentation/speech/sfspeechrecognizer) per task.

### The call

sherpa-onnx keyword spotting. It's the only option that officially covers iOS and the browser, it costs nothing, and changing the wake word is a text edit, which matters because the product name is still open. The price is no published accuracy and some build work, an xcframework for iOS and an Emscripten build for the web. Pick a phrase of three or four syllables and test it against TV audio early.

The runner-up is livekit-wakeword on iOS with the same ONNX classifier loaded through `openwakeword-web` in the simulator. It has the best measured accuracy and the most unknowns.

Whatever we pick, build push to talk first. A hold-to-talk button in the iOS app and a button plus spacebar on `/sim`, calling the same `startListening()` the wake word calls. Then a bad wake word costs one tap on stage.

## 8. MongoDB Atlas M0

| Question | Answer | Source |
|---|---|---|
| Server version | "Atlas uses MongoDB 8.0 for Free clusters." We can't change it | [Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) |
| Search and vector index cap | "3 indexes (regardless of the type, `search` or `vector`) on Free clusters." Flex gets 10 | [Vector Search limitations](https://www.mongodb.com/docs/vector-search/deployment/compatibility-limitations/) |
| Max vector dimensions | 8,192 | same page |
| `$rankFusion` | Needs "MongoDB 8.0 and later", so M0 qualifies | [Hybrid search overview](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/), [`$rankFusion` reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/) |
| `$scoreFusion` | Needs 8.3 or later, so not on M0 | [`$scoreFusion` reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation/scorefusion/) |
| Automated embedding | Works on M0. The hybrid search prerequisites say "For Free (`M0`) and Flex tier clusters, no further action is required", and the rate limit table has a row for "M0 clusters without a payment method" | [Hybrid search overview](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/), [model limits](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/) |
| Storage, throughput, connections | 0.5 GB, 100 operations a second, 500 connections | Free cluster limits |
| Change streams | Supported, with limits on namespace filters | Free cluster limits |
| Flex version | "at least MongoDB 8.0", also not selectable, 5 GB and 500 operations a second | [Flex limits](https://www.mongodb.com/docs/atlas/reference/flex-limitations/) |

Two things follow.

The README says `$rankFusion` needs 8.1. The docs now say 8.0, and M0 runs 8.0. The docs don't name M0 on the `$rankFusion` pages, and the list of stages M0 blocks doesn't include it. Run one `$rankFusion` query on the real cluster in M0 setup. If it fails, the ten lines of reciprocal rank fusion in app code are still the fallback. `$rankFusion` sub-pipelines run one after another, not in parallel, which is fine on the LLM path.

The index budget is exactly spent. The plan needs a vector index on `sightings`, a vector index on `room_refs`, and an Atlas Search index on `sightings.sentence` for the text half of hybrid search. That's three. A `memories` collection for the stretch goal would need a fourth, which means Flex. An `autoEmbed` index is a vector index, so switching to automated embedding wouldn't change the count.

## Revised latency budget

### Fast path

End of speech to first audio in the wearer's ear, at the median.

| Stage | Budget | Notes |
|---|---|---|
| End of speech to `EndOfTurn` | 500 ms | Flux at `eot_threshold` 0.8. Deepgram claims about 260 ms typical. LiveKit measured 548 ms at a 10% false cutoff rate. This replaces the 300 ms line |
| Intent match and item resolve | 5 ms | Unchanged. Starts on `EagerEndOfTurn` |
| MongoDB read | 30 ms | Unchanged. Starts on `EagerEndOfTurn` |
| TTS time to first audio | 185 ms | Coval P50 for Flash v2.5, down from 250 ms. Starts on `EagerEndOfTurn` |
| Speculative work still running at `EndOfTurn` | 50 ms | The three rows above total 220 ms. Deepgram says the eager event leads by 150 to 250 ms, so about 170 to 200 ms of it is already done |
| Network to phone, Bluetooth to glasses | 200 ms | Carried over from the README. I found no source I could read for the Bluetooth share |
| **Total with speculation** | **about 750 ms** | 500 + 50 + 200 |
| **Total without speculation** | **about 920 ms** | 500 + 220 + 200 |

The P50 target of 1 s holds, with 80 ms of slack if speculation isn't built and 250 ms if it is. Build it. On `EagerEndOfTurn`, run the router, the read and the TTS request, and hold the audio. On `EndOfTurn`, play. On `TurnResumed`, throw the audio away. A wasted TTS request costs half a cent.

The P95 target of 1.5 s doesn't hold. Deepgram's own p95 for end of turn is about 1.5 s before anything else runs. With Coval's 231 ms P95 for TTS and 200 ms of transport, P95 lands near 1.9 s. Set the P95 target to 2 s. A wearer who pauses mid-sentence is the P95 case, and waiting for them is the product working.

### LLM path

| Stage | Budget | Notes |
|---|---|---|
| End of speech to `EndOfTurn` | 500 ms | Same as above |
| Router miss, query embedding, `$vectorSearch`, recent items | 150 ms | My estimate. Nobody publishes these. Starts on `EagerEndOfTurn` |
| LLM first token | 780 ms | Artificial Analysis median for Luna at effort `none`, text prompt |
| First clause, about 15 tokens | 130 ms | 15 tokens at 117 tokens a second |
| TTS time to first audio | 185 ms | Coval P50, WebSocket with `flush` at the clause boundary |
| Network to phone, Bluetooth to glasses | 200 ms | Carried over |
| **Total, one model call after `EndOfTurn`** | **about 1,950 ms** | Inside the 2 s target with no room to spare |
| **Total, model call started on the eager event** | **about 1,750 ms** | Costs 50 to 70% more LLM calls per Deepgram, which at Luna prices is nothing |
| Extra for a tool round trip | 800 to 900 ms | A second first-token wait plus the tool. This breaks 2 s |

Two changes keep the LLM path inside 2 s. Fetch memories and recent items before the model call so most questions need one call. And on a router miss, play a short cached line such as "Let me look" at `EndOfTurn`. That puts first audio at about 700 ms on both paths, and the wearer hears a reply while the model works.

## Cost per wearer per day

Assumptions, all mine. 300 keyframes a day. 20 questions a day, 17 on the fast path and 3 on the LLM path. The mic streams for 8 s per question. An answer is 100 characters, since the README's example answer is 94. Speculation wastes 30% extra TTS requests.

| Line | Arithmetic | Per day |
|---|---|---|
| Keyframe descriptions, Luna, 1280 x 720 | 300 x $0.0003768 | $0.113 |
| Text embeddings, `text-embedding-3-small` | about 303 texts x 15 tokens = 4,545 tokens x $0.02/1M | $0.0001 |
| STT, Flux | 20 x 8 s = 2.67 min x $0.0065 | $0.017 |
| TTS, Flash v2.5 | 20 x 100 x 1.3 = 2,600 characters x $50/1M | $0.130 |
| LLM path, Luna | 3 questions x 2 calls x (3,000 x $0.20/1M + 100 x $1.20/1M) = 6 x $0.00072 | $0.004 |
| Atlas M0, wake word, room embeddings on the laptop | free | $0 |
| **Total** | | **about $0.26** |

That's about $7.90 per 30 days. Keyframe storage and the perception machine aren't included.

TTS is half the bill, so the provider choice moves it. The same 2,600 characters cost $0.117 on Flux TTS, $0.078 on Aura-2 and $0.065 on Inworld TTS-2. Terra for keyframes would add $1.02 a day and become the biggest line by far.

For comparison, the Realtime API on the same 20 questions. Audio in is 2.67 min x $0.0192 = $0.051. Audio out at about 6 s per answer is 2 min x $0.0768 = $0.154. That's $0.205 a day before text tokens and repeated context, against $0.147 for Flux plus Flash v2.5. Price doesn't rule the Realtime API out. Latency and control over the exact words do.

During the hackathon the binding limit is the ElevenLabs free plan at 20,000 Flash characters a month, which is 200 answers. Buy the Starter plan or lean on Deepgram's $200 credit while developing.

## Changes to make to README.md

1. **Goals.** Keep goal 1 at a 1 s median. Add that the P95 target is 2 s, because a patient turn detector makes 1.5 s unreachable.
2. **Architecture.** In the diagram, rename the STT node to "Deepgram Flux streaming STT". In the pieces table, change `services/perception` from open_clip to timm with DINOv3, and change `apps/ios` from Porcupine to sherpa-onnx keyword spotting.
3. **What happens when the wearer asks a question.** Rewrite steps 2 to 5 around Flux events. The phone posts on `EagerEndOfTurn`, the server prepares audio, and playback starts on `EndOfTurn` or gets dropped on `TurnResumed`. If the router finds no item in a "where" question, keep listening and join the next segment. In step 6, fetch memories and recent items before the model call and play a cached "Let me look" line.
4. **Latency budget.** Replace the table with the fast path table above and add the LLM path table. Replace "Slow path adds 500 to 900 ms" with the 1,750 to 1,950 ms total. Move "speculate on interim transcripts" from a later idea to a required M2 item. Replace the closing paragraph's "Start at 400 ms of silence" with the Flux starting configuration, `eot_threshold` 0.8, `eager_eot_threshold` 0.4, `eot_timeout_ms` 8000.
5. **Latency budget, the bullet about streamed text over WebSocket.** Add that ElevenLabs buffers about 120 characters by default, so send `flush: true` or use `auto_mode`, and use the HTTP streaming endpoint for template answers.
6. **Text to speech: ElevenLabs or Deepgram.** Replace the independent latency row with Coval's numbers, 185 and 231 ms for Flash v2.5 and 289 and 528 ms for Aura-2 at P50 and P95. Add a Deepgram Flux TTS column with its 0.5 to 1.5 speed range, calm setting, $45 per 1M price and "no independent latency yet". Delete the sentence about a 25 ms gap. Change the warmth claim, since Flash v2.5 ranks 42nd in blind tests and Deepgram has no ranking. Keep Flash v2.5 as the default on latency grounds and name Flux TTS, not Aura-2, as the Deepgram candidate. Add a note that Inworld TTS-2 beats both and is worth a benchmark entry.
7. **Text to speech, the STT paragraph.** Drop Nova-3. State Flux as the pick with Soniox `stt-rt-v5` as the challenger behind an `STTProvider` interface.
8. **Text to speech, the Realtime paragraph.** Change `gpt-realtime-2` to `gpt-realtime-2.1`. Add that `gpt-live-1` exists and doesn't fit, because it paraphrases injected text and bills open session time.
9. **Perception pipeline, description job.** Name `gpt-5.6-luna` with reasoning effort `none`, `detail: "high"`, a 1280 x 720 frame and structured outputs. Change the embedding line to `text-embedding-3-small` with `dimensions: 512`.
10. **Perception pipeline, rooms.** Replace CLIP with DINOv3 ViT-B/16 through timm. Add the hold-out check after enrollment.
11. **Data model.** Change `nameEmbedding` and `sentenceEmbedding` from 1536 to 512. Change the `room_refs` embedding from 512 to 768.
12. **Where vector search earns its place.** Change "needs MongoDB 8.1 or later" to 8.0, and say M0 runs 8.0. Add that `$scoreFusion` needs 8.3 and isn't available. Replace "check the limit before adding a third" with the fact that M0 allows three search indexes of any type and the plan uses all three.
13. **Caregiver dashboard, settings.** Clamp the speaking rate control to the provider's range, 0.7 to 1.2 for Flash v2.5 and 0.5 to 1.5 for Flux TTS.
14. **API sketch.** Keep `GET /api/stt/token`. Note that it calls `POST /v1/auth/grant` and that a 30 s token is enough because it's only checked at connect time.
15. **Repo layout and Running it.** Add `scripts/bench-stt.ts`, which plays recorded slow-speech questions through both STT vendors and counts false cutoffs and time to `EndOfTurn`. Extend `bench-tts.ts` to four entries, Flash v2.5, Flux TTS, Aura-2 and Inworld TTS-2.
16. **Environment variables.** Set `OPENAI_CHAT_MODEL=gpt-5.6-luna`, `OPENAI_VISION_MODEL=gpt-5.6-luna` and `DEEPGRAM_STT_MODEL=flux-general-en`. Add `OPENAI_REASONING_EFFORT=none`, `OPENAI_EMBEDDING_DIMENSIONS=512`, `STT_PROVIDER=deepgram` and `SONIOX_API_KEY`. Set `DEEPGRAM_TTS_MODEL=flux-sean-en` as a starting voice. Remove `PICOVOICE_ACCESS_KEY`.
17. **Testing.** Record the golden question set as audio, with 1 to 4 s pauses inside sentences, and assert on false cutoffs as well as intent.
18. **Build order.** In M0, add a payment method to Atlas if automated embedding is in play, run one `$rankFusion` query, and apply for the Picovoice trial. In M2, add speculation on the eager event and push to talk. In M5, replace Porcupine with sherpa-onnx.
19. **Risks.** Rewrite the Atlas row with the confirmed limits. Rewrite the endpointing row around Flux settings and segment joining. Add a row for the wake word, since Picovoice has no free plan and sherpa-onnx has no published accuracy, with push to talk as the plan.
20. **Open decisions.** Item 5 becomes Flash v2.5, Flux TTS or Inworld TTS-2. Item 6 becomes sherpa-onnx plus push to talk.
21. **References.** Replace the Gradium link with Coval's board. Add eot-bench, the Pipecat STT benchmark, the Flux configuration page, the Atlas limits pages and the OpenAI pricing page.

## What I couldn't verify

- The 200 ms line for network and Bluetooth. I found search snippets putting the hands-free link itself at 20 to 45 ms, but the two Silicon Labs sources wouldn't load, so I'm not citing a number. Measure it with a loopback recording.
- Accuracy of any STT model on people with dementia. Nobody has published it. A Research Square preprint reportedly tested 8 systems on 306 dementia and control recordings, and the page wouldn't load.
- The Flux word error rate of 7.39% on Artificial Analysis. A research subagent read it from the page data. In my own read I confirmed Nova-3 at 6.59%, Flux finalising at 0.02 s and a Soniox row at 4.49%, and that Soniox row was labelled v4, not v5.
- Which model versions LiveKit's eot-bench tested, and when. The repo doesn't say.
- Any independent latency or listener preference number for Deepgram Flux TTS, and any listener preference number for Aura-2.
- The price of ElevenLabs v3 Conversational. The API pricing page lists v3 at $0.10 per 1K characters and doesn't list the conversational variant on its own.
- Whether Fast mode accepts `gpt-5.6-luna`. The guide and the pricing page disagree.
- First token time with an image in the prompt. Artificial Analysis tests text only.
- OpenAI's launch posts and `openai.com/api/pricing`, which returned 403. All OpenAI prices come from `developers.openai.com`.
- The date Picovoice disabled free AccessKeys and the 7 day trial length. Both come from a forum thread. Picovoice's own FAQ confirms only that no free plan exists.
- False accept and false reject rates for sherpa-onnx keyword spotting, and whether a prebuilt WebAssembly bundle for it exists. Porcupine's per-engine miss rates exist only as a chart image in its [benchmark repo](https://github.com/Picovoice/wake-word-benchmark).
- Training time for livekit-wakeword, and whether the openWakeWord Colab notebook still runs.
- Throughput of any image model on Apple Silicon Macs, and Places365 results for any of them.
- RTEB leaderboard rows for the OpenAI embedding models. The Hugging Face page wouldn't render.
- Whether `$rankFusion` runs on an M0 cluster in practice. The docs imply yes by version and never name the tier.
- Whether app code can read the vectors Atlas automated embedding stores, how long its query-time embedding takes, and whether those vectors count against the 0.5 GB M0 quota.
- Flex cluster pricing. The limits page doesn't give it.

## Sources

Speech to text

- [Deepgram Flux configuration](https://developers.deepgram.com/docs/flux/configuration)
- [Deepgram Flux quickstart](https://developers.deepgram.com/docs/flux/quickstart)
- [Deepgram Flux eager end-of-turn guide](https://developers.deepgram.com/docs/flux/voice-agent-eager-eot)
- [Deepgram Flux API reference](https://developers.deepgram.com/reference/speech-to-text/listen-flux)
- [Deepgram, introducing Flux](https://deepgram.com/learn/introducing-flux-conversational-speech-recognition)
- [Deepgram endpointing for Nova](https://developers.deepgram.com/docs/endpointing)
- [Deepgram pricing](https://deepgram.com/pricing)
- [Deepgram token grant endpoint](https://developers.deepgram.com/reference/auth/tokens/grant)
- [Deepgram token-based authentication guide](https://developers.deepgram.com/guides/fundamentals/token-based-authentication)
- [Soniox endpoint detection](https://soniox.com/docs/stt/rt/endpoint-detection)
- [Soniox pricing](https://soniox.com/pricing)
- [Soniox temporary API key](https://soniox.com/docs/api-reference/auth/create_temporary_api_key)
- [Soniox WebSocket API](https://soniox.com/docs/api-reference/stt/websocket-api)
- [AssemblyAI Universal-3 Pro turn detection](https://www.assemblyai.com/docs/streaming/universal-3-pro/turn-detection-and-partials)
- [AssemblyAI pricing](https://www.assemblyai.com/pricing)
- [Cartesia STT turns](https://docs.cartesia.ai/use-the-api/stt/turns.md)
- [OpenAI realtime transcription guide](https://developers.openai.com/api/docs/guides/realtime-transcription)
- [OpenAI Realtime client events reference](https://developers.openai.com/api/reference/resources/realtime/client-events)
- [OpenAI VAD guide](https://developers.openai.com/api/docs/guides/realtime-vad)
- [OpenAI client secrets reference](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create)
- [xAI Grok Voice Transcribe 2.0](https://x.ai/news/grok-voice-transcribe-2)
- [Meta Muse Voice Transcribe](https://developer.meta.com/ai/resources/blog/meet-muse-voice-transcribe-streaming-speech-to-text/)
- [LiveKit eot-bench](https://github.com/livekit/eot-bench)
- [Pipecat STT benchmark](https://github.com/pipecat-ai/stt-benchmark)
- [Artificial Analysis streaming speech to text](https://artificialanalysis.ai/speech-to-text/streaming)
- [Artificial Analysis speech to text methodology](https://artificialanalysis.ai/speech-to-text/methodology)
- [ASR age gap study](https://github.com/Kayvan-Zahiri/asr-age-gap)
- [Commercial ASR on TORGO dysarthric speech](https://arxiv.org/abs/2512.17474)
- [ASR for Dutch older adults](https://arxiv.org/abs/2508.08684)

Text to speech

- [Coval time to first audio board](https://benchmarks.coval.ai/benchmarks/time-to-first-audio)
- [Coval benchmark methodology](https://raw.githubusercontent.com/coval-ai/benchmarks/main/docs/methodology.md)
- [Coval, ElevenLabs Flash v2.5](https://benchmarks.coval.ai/models/eleven_flash_v2_5)
- [Coval, Deepgram Aura-2](https://benchmarks.coval.ai/models/aura-2-thalia-en)
- [Coval, Inworld TTS-2](https://benchmarks.coval.ai/models/inworld-tts-2)
- [Coval, Inworld TTS-2 Flash](https://benchmarks.coval.ai/models/inworld-tts-2-flash)
- [Coval, Cartesia Sonic 3.5](https://benchmarks.coval.ai/models/sonic-3.5)
- [Coval, Cartesia Sonic 3.6](https://benchmarks.coval.ai/models/sonic-3.6)
- [Coval, OpenAI gpt-4o-mini-tts](https://benchmarks.coval.ai/models/gpt-4o-mini-tts)
- [Gradium TTS latency benchmark](https://gradium.ai/content/tts-latency-benchmark-2026)
- [Vapi Humanness Index, Flash v2.5](https://humannessindex.vapi.ai/models/elevenlabs-flash-v2-5)
- [Artificial Analysis text to speech leaderboard](https://artificialanalysis.ai/text-to-speech/leaderboard)
- [ElevenLabs models](https://elevenlabs.io/docs/overview/models)
- [ElevenLabs latency optimization](https://elevenlabs.io/docs/best-practices/latency-optimization)
- [ElevenLabs WebSocket stream-input reference](https://elevenlabs.io/docs/api-reference/text-to-speech/v-1-text-to-speech-voice-id-stream-input)
- [ElevenLabs HTTP stream reference](https://elevenlabs.io/docs/api-reference/text-to-speech/stream)
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs plans](https://elevenlabs.io/pricing)
- [Deepgram, introducing Aura-2](https://deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech)
- [Deepgram TTS voice controls](https://developers.deepgram.com/docs/tts-voice-controls)
- [Deepgram TTS media output settings](https://developers.deepgram.com/docs/tts-media-output-settings)
- [Deepgram streaming speak reference](https://developers.deepgram.com/reference/text-to-speech/speak-streaming)
- [Deepgram API rate limits](https://developers.deepgram.com/reference/api-rate-limits)
- [Deepgram Flux TTS launch](https://deepgram.com/learn/text-to-speech-comes-of-age-deepgram-launches-conversation-native-speech)
- [Deepgram, introducing Flux TTS](https://deepgram.com/learn/introducing-flux-tts-conversation-native-text-to-speech-for-real-time-voice-agents)
- [Deepgram Flux TTS product page](https://deepgram.com/product/text-to-speech/flux)
- [Deepgram Flux TTS feature overview](https://developers.deepgram.com/docs/flux-tts/feature-overview)
- [Deepgram Flux TTS quickstart](https://developers.deepgram.com/docs/flux-tts/quickstart)
- [Deepgram Flux TTS voices](https://developers.deepgram.com/docs/flux-tts/voices)
- [Cartesia Sonic](https://cartesia.ai/sonic)
- [Cartesia TTS WebSocket reference](https://docs.cartesia.ai/api-reference/tts/websocket)
- [OpenAI text to speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)
- [OpenAI createSpeech reference](https://developers.openai.com/api/docs/api-reference/audio/createSpeech)
- [Inworld pricing](https://inworld.ai/pricing)
- [Inworld TTS WebSocket reference](https://docs.inworld.ai/api-reference/ttsAPI/texttospeech/synthesize-speech-websocket)

OpenAI Realtime and model tiers

- [OpenAI models](https://developers.openai.com/api/docs/models)
- [OpenAI pricing](https://developers.openai.com/api/docs/pricing)
- [OpenAI changelog](https://developers.openai.com/api/docs/changelog)
- [OpenAI deprecations](https://developers.openai.com/api/docs/deprecations)
- [OpenAI Realtime guide](https://developers.openai.com/api/docs/guides/realtime)
- [OpenAI, gpt-realtime-2.1 announcement](https://community.openai.com/t/new-realtime-models-on-the-api-gpt-realtime-2-1-and-gpt-realtime-2-1-mini/1385896)
- [OpenAI gpt-live-1 model page](https://developers.openai.com/api/docs/models/gpt-live-1)
- [OpenAI voice latency and cost guide](https://developers.openai.com/api/docs/guides/voice-latency-cost)
- [OpenAI realtime conversations guide](https://developers.openai.com/api/docs/guides/realtime-conversations)
- [OpenAI realtime MCP guide](https://developers.openai.com/api/docs/guides/realtime-mcp)
- [OpenAI WebRTC guide](https://developers.openai.com/api/docs/guides/voice-webrtc)
- [OpenAI live delegation guide](https://developers.openai.com/api/docs/guides/live-delegation)
- [Artificial Analysis speech to speech](https://artificialanalysis.ai/speech-to-speech)
- [OpenAI gpt-5.6-luna model page](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
- [OpenAI gpt-5.6-terra model page](https://developers.openai.com/api/docs/models/gpt-5.6-terra)
- [OpenAI GPT-5.6 guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6)
- [OpenAI images and vision guide](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI Batch guide](https://developers.openai.com/api/docs/guides/batch)
- [OpenAI flex processing guide](https://developers.openai.com/api/docs/guides/flex-processing)
- [OpenAI Fast mode guide](https://developers.openai.com/api/docs/guides/fast-mode)
- [Artificial Analysis, GPT-5.6 Luna non-reasoning](https://artificialanalysis.ai/models/gpt-5-6-luna-non-reasoning)
- [Artificial Analysis, GPT-5.6 Luna low](https://artificialanalysis.ai/models/gpt-5-6-luna-low)
- [Artificial Analysis, GPT-5.6 Terra non-reasoning](https://artificialanalysis.ai/models/gpt-5-6-terra-non-reasoning)
- [Artificial Analysis, GPT-5.6 Terra low](https://artificialanalysis.ai/models/gpt-5-6-terra-low)
- [Artificial Analysis, GPT-5.4 mini non-reasoning](https://artificialanalysis.ai/models/gpt-5-4-mini-non-reasoning)
- [Artificial Analysis, OpenAI provider page](https://artificialanalysis.ai/providers/openai)

Text embeddings and Atlas

- [OpenAI embeddings guide](https://developers.openai.com/api/docs/guides/embeddings)
- [Voyage text embeddings](https://docs.voyageai.com/docs/embeddings)
- [Voyage pricing](https://docs.voyageai.com/docs/pricing)
- [Voyage 4 announcement](https://blog.voyageai.com/2026/01/15/voyage-4/)
- [Hugging Face, introducing RTEB](https://huggingface.co/blog/rteb)
- [Atlas automated embedding overview](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/)
- [Atlas automated embedding models and rate limits](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/models/)
- [Atlas automated embedding billing](https://www.mongodb.com/docs/vector-search/crud-embeddings/automated-embedding/billing/)
- [MongoDB, automated embedding public preview announcement](https://www.mongodb.com/company/blog/product-release-announcements/ai-search-for-agents-announcing-automated-embedding-atlas)
- [Atlas Embedding and Reranking API overview](https://www.mongodb.com/docs/voyageai/api-reference/overview/)
- [Atlas Free cluster limits](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/)
- [Atlas Flex cluster limits](https://www.mongodb.com/docs/atlas/reference/flex-limitations/)
- [MongoDB Vector Search compatibility and limitations](https://www.mongodb.com/docs/vector-search/deployment/compatibility-limitations/)
- [MongoDB hybrid search overview](https://www.mongodb.com/docs/vector-search/hybrid-search/hybrid-search-overview/)
- [`$rankFusion` reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation/rankFusion/)
- [`$scoreFusion` reference](https://www.mongodb.com/docs/manual/reference/operator/aggregation/scorefusion/)

Image embeddings

- [DINOv3 paper](https://arxiv.org/html/2508.10104v1)
- [DINOv3 license](https://github.com/facebookresearch/dinov3/blob/main/LICENSE.md)
- [DINOv3 ViT-B/16 on Hugging Face](https://huggingface.co/facebook/dinov3-vitb16-pretrain-lvd1689m)
- [DINOv3 ViT-B/16 timm mirror](https://huggingface.co/timm/vit_base_patch16_dinov3.lvd1689m)
- [DINOv2 repository](https://github.com/facebookresearch/dinov2)
- [AnyLoc paper](https://arxiv.org/html/2308.00688)
- [MegaLoc paper](https://arxiv.org/html/2502.17237)
- [SigLIP 2 announcement](https://huggingface.co/blog/siglip2)
- [SigLIP 2 base model card](https://huggingface.co/google/siglip2-base-patch16-224)
- [open_clip model configs](https://github.com/mlfoundations/open_clip/tree/main/src/open_clip/model_configs)
- [open_clip model profile](https://github.com/mlfoundations/open_clip/blob/main/docs/model_profile.csv)
- [open_clip license](https://github.com/mlfoundations/open_clip/blob/main/LICENSE)
- [LAION CLIP ViT-B/16 model card](https://huggingface.co/laion/CLIP-ViT-B-16-laion2B-s34b-b88K)
- [Apple MobileCLIP repository](https://github.com/apple/ml-mobileclip)
- [Apple MobileCLIP model license](https://github.com/apple/ml-mobileclip/blob/main/LICENSE_MODELS)
- [Apple DFN2B CLIP model card](https://huggingface.co/apple/DFN2B-CLIP-ViT-B-16)
- [Voyage multimodal embeddings](https://docs.voyageai.com/docs/multimodal-embeddings)
- [Voyage multimodal models on MongoDB docs](https://www.mongodb.com/docs/voyageai/models/multimodal-embeddings/)

Wake word

- [Picovoice general FAQ](https://picovoice.ai/docs/faq/general/)
- [Picovoice Porcupine FAQ](https://picovoice.ai/docs/faq/porcupine/)
- [Porcupine iOS quick start](https://picovoice.ai/docs/quick-start/porcupine-ios/)
- [Porcupine Web quick start](https://picovoice.ai/docs/quick-start/porcupine-web/)
- [Picovoice wake word benchmark](https://github.com/Picovoice/wake-word-benchmark)
- [Home Assistant forum thread on Picovoice free tier](https://community.home-assistant.io/t/fyi-picovoice-confirmed-free-tier-accesskeys-will-stop-working-after-june-30-2026/1012744)
- [sherpa-onnx keyword spotting docs](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)
- [sherpa-onnx repository](https://github.com/k2-fsa/sherpa-onnx)
- [livekit-wakeword repository](https://github.com/livekit/livekit-wakeword)
- [openWakeWord repository](https://github.com/dscripka/openWakeWord)
- [openwakeword-web on npm](https://registry.npmjs.org/openwakeword-web)
- [openwakeword-wasm-browser repository](https://github.com/dnavarrom/openwakeword_wasm)
- [MDN, SpeechRecognition processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally)
- [Apple SFSpeechRecognizer docs](https://developer.apple.com/documentation/speech/sfspeechrecognizer)
