/** Procedurally generated sound effects via WebAudio. No asset files. */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function initAudio(): void {
  if (ctx) return;
  try {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

export function resumeAudio(): void {
  ctx?.resume().catch(() => undefined);
}

function noiseBuffer(dur: number): AudioBuffer {
  const c = ctx!;
  const buf = c.createBuffer(1, Math.max(1, Math.floor(c.sampleRate * dur)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function playNoise(dur: number, freq: number, q: number, gain: number, decay = true): void {
  if (!ctx || !master) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(dur);
  const flt = ctx.createBiquadFilter();
  flt.type = 'bandpass';
  flt.frequency.value = freq;
  flt.Q.value = q;
  const g = ctx.createGain();
  g.gain.value = gain;
  if (decay) g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  src.connect(flt).connect(g).connect(master);
  src.start();
}

function playTone(freq: number, dur: number, gain: number, type: OscillatorType = 'sine', slide = 0): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
  const g = ctx.createGain();
  g.gain.value = gain;
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start();
  o.stop(ctx.currentTime + dur);
}

export const sfx = {
  gunshot(kind: string): void {
    if (kind === 'shotgun') {
      playNoise(0.35, 900, 0.6, 0.9);
      playTone(90, 0.25, 0.5, 'square', -60);
    } else if (kind === 'ak') {
      playNoise(0.12, 1600, 0.8, 0.55);
      playTone(140, 0.08, 0.3, 'square', -80);
    } else if (kind === 'bazooka') {
      playNoise(0.5, 500, 0.5, 0.8);
      playTone(60, 0.4, 0.6, 'sawtooth', -30);
    } else {
      playNoise(0.15, 2200, 0.9, 0.5);
      playTone(180, 0.1, 0.25, 'square', -120);
    }
  },
  explosion(): void {
    playNoise(0.9, 220, 0.4, 1.0);
    playTone(45, 0.8, 0.8, 'sine', -25);
  },
  swing(): void {
    playNoise(0.18, 700, 1.2, 0.25);
  },
  hitFlesh(): void {
    playNoise(0.12, 240, 1.5, 0.5);
    playTone(110, 0.09, 0.3, 'triangle', -50);
  },
  hitConfirm(): void {
    playTone(880, 0.05, 0.12, 'square');
  },
  zombieHurt(): void {
    playTone(160 + Math.random() * 60, 0.25, 0.2, 'sawtooth', -80);
    playNoise(0.2, 400, 1.0, 0.2);
  },
  zombieDie(): void {
    playTone(120, 0.5, 0.25, 'sawtooth', -90);
  },
  growl(): void {
    playTone(85 + Math.random() * 40, 0.6, 0.12, 'sawtooth', -30);
  },
  playerHurt(): void {
    playTone(220, 0.2, 0.3, 'square', -120);
    playNoise(0.15, 500, 1.0, 0.3);
  },
  horn(kind: 'tram' | 'car'): void {
    if (kind === 'tram') {
      playTone(311, 0.55, 0.22, 'square');
      playTone(415, 0.55, 0.18, 'square');
    } else {
      playTone(220, 0.22, 0.16, 'sawtooth');
    }
  },
  crash(): void {
    playNoise(0.35, 700, 0.5, 0.55);
    playTone(70, 0.3, 0.45, 'square', -30);
  },
  pickup(): void {
    playTone(660, 0.08, 0.2, 'square');
    playTone(990, 0.12, 0.2, 'square');
  },
  empty(): void {
    playTone(1200, 0.04, 0.1, 'square');
  },
  reload(): void {
    playNoise(0.08, 3000, 2, 0.2);
  },
  throwWhoosh(): void {
    playNoise(0.25, 1000, 0.8, 0.25);
  },
  objectHit(): void {
    playNoise(0.1, 1500, 1.5, 0.4);
  },
  chainsaw(on: boolean): void {
    if (on) playTone(95, 0.15, 0.18, 'sawtooth', 20);
    else playTone(80, 0.3, 0.15, 'sawtooth', -40);
  },
};
