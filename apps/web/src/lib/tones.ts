// Short beeps through the page's AudioContext. On iPhone the context has to be
// resumed inside a tap before it makes any sound.
function beep(ctx: AudioContext, frequency: number, startAt: number, seconds: number, gain: number) {
  const oscillator = ctx.createOscillator();
  const amplitude = ctx.createGain();
  oscillator.frequency.value = frequency;
  amplitude.gain.setValueAtTime(0, startAt);
  amplitude.gain.linearRampToValueAtTime(gain, startAt + 0.01);
  amplitude.gain.linearRampToValueAtTime(0, startAt + seconds);
  oscillator.connect(amplitude).connect(ctx.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + seconds + 0.02);
}

// A rising pair: the mic is open.
export function playListeningChime(ctx: AudioContext) {
  const now = ctx.currentTime;
  beep(ctx, 660, now, 0.08, 0.15);
  beep(ctx, 880, now + 0.09, 0.08, 0.15);
}

// A low tone: the camera feed froze.
export function playStallTone(ctx: AudioContext) {
  beep(ctx, 330, ctx.currentTime, 0.4, 0.25);
}

// Two quick notes: a new alert reached the caregiver dashboard.
export function playAlertTone(ctx: AudioContext) {
  const now = ctx.currentTime;
  beep(ctx, 784, now, 0.1, 0.15);
  beep(ctx, 784, now + 0.14, 0.1, 0.15);
}

// A single soft chime: someone was just recognized. Deliberately not the
// listening chime's rising pair, so the two are never confused -- this one
// never means the mic is open.
export function playFaceChime(ctx: AudioContext) {
  beep(ctx, 520, ctx.currentTime, 0.15, 0.12);
}
