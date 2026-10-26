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

// --- Shanghai street music ---------------------------------------------------
// A tiny MIDI-style step sequencer: square-wave lead over a triangle bass,
// C pentatonic (C D E G A), looped. Runs on a lookahead scheduler so the
// melody stays in time even when the game hiccups.

const BEAT = 0.3; // seconds per quarter note (~100 BPM)

// [frequency Hz, length in beats] — two 8-bar phrases, 32 beats per loop.
const E4 = 330, G4 = 392, A4 = 440, C5 = 523, D5 = 587, E5 = 659;
const D4 = 294, C4 = 262;
const MELODY: [number, number][] = [
  [E4, 1], [G4, 1], [A4, 1], [C5, 1], [D5, 1], [C5, 1], [A4, 1], [G4, 1],
  [A4, 1], [C5, 1], [A4, 1], [G4, 1], [E4, 1], [G4, 1], [D4, 2],
  [E4, 1], [G4, 1], [A4, 1], [C5, 1], [D5, 1], [E5, 1], [C5, 1], [A4, 1],
  [G4, 1], [A4, 1], [C5, 1], [A4, 1], [G4, 1], [E4, 1], [D4, 1], [C4, 2],
];
const BASS = [131, 110, 98, 110]; // C3 A2 G2 A2, one per bar

function scheduleTone(freq: number, dur: number, when: number, type: OscillatorType, gain: number): void {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  o.connect(g).connect(master);
  o.start(when);
  o.stop(when + dur + 0.02);
}

let musicTimer: number | null = null;
let musicNext = 0;
let musicStep = 0;
let musicBeat = 0;

function startMusic(): void {
  if (!ctx || musicTimer !== null) return;
  musicNext = ctx.currentTime + 0.12;
  musicStep = 0;
  musicBeat = 0;
  musicTimer = window.setInterval(() => {
    if (!ctx) return;
    while (musicNext < ctx.currentTime + 0.25) {
      const [f, beats] = MELODY[musicStep];
      scheduleTone(f, beats * BEAT * 0.92, musicNext, 'square', 0.04);
      scheduleTone(f * 2, beats * BEAT * 0.45, musicNext, 'triangle', 0.014); // octave shimmer
      if (musicBeat % 4 === 0) scheduleTone(BASS[(musicBeat / 4) % 4], BEAT * 1.8, musicNext, 'triangle', 0.07);
      musicNext += beats * BEAT;
      musicBeat += beats;
      musicStep = (musicStep + 1) % MELODY.length;
    }
  }, 60);
}

function stopMusic(): void {
  if (musicTimer !== null) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
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
  headshot(): void {
    // bright metallic "tink" + crack
    playTone(1950, 0.07, 0.16, 'triangle');
    playTone(2600, 0.05, 0.1, 'sine');
    playNoise(0.08, 3200, 1.6, 0.25);
  },
  gore(): void {
    // wet detonation: low thump + mid splatter + high spray
    playTone(58, 0.4, 0.6, 'sine', -28);
    playNoise(0.35, 260, 0.7, 0.7);
    playNoise(0.18, 1400, 1.1, 0.3);
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
  bell(): void {
    // annoying e-scooter "get out of the way" ding
    playTone(1750, 0.09, 0.14, 'triangle');
    playTone(2340, 0.12, 0.1, 'triangle');
  },
  crash(): void {
    playNoise(0.35, 700, 0.5, 0.55);
    playTone(70, 0.3, 0.45, 'square', -30);
  },
  jump(): void {
    playTone(240, 0.12, 0.16, 'square', 280);
  },
  thud(): void {
    playNoise(0.18, 160, 0.5, 0.6);
    playTone(55, 0.16, 0.45, 'sine', -20);
  },
  trick(): void {
    playTone(660, 0.1, 0.18, 'square');
    playTone(990, 0.16, 0.16, 'square', 180);
  },
  pickup(): void {
    playTone(660, 0.08, 0.2, 'square');
    playTone(990, 0.12, 0.2, 'square');
  },
  slurp(): void {
    // ramen slurp: breathy bandpass noise + a falling gulp tone
    playNoise(0.28, 900, 1.4, 0.3);
    playTone(520, 0.22, 0.12, 'sine', -260);
  },
  gulp(): void {
    playTone(320, 0.12, 0.18, 'sine', -180);
    playTone(240, 0.1, 0.12, 'triangle', -120);
  },
  sizzle(): void {
    // wok hitting hot oil: long quiet high hiss
    playNoise(0.7, 4200, 0.7, 0.12);
    playNoise(0.3, 2600, 0.9, 0.08);
  },
  musicStart(): void {
    startMusic();
  },
  musicStop(): void {
    stopMusic();
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
    // LOUD: detuned two-stroke growl plus the chain rasp cutting air
    if (on) {
      playTone(95, 0.15, 0.5, 'sawtooth', 20);
      playTone(143, 0.15, 0.22, 'sawtooth', 26);
      playNoise(0.12, 2600, 4, 0.3);
    } else playTone(80, 0.3, 0.42, 'sawtooth', -40);
  },
};
