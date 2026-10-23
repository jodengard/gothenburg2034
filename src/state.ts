/** Single authoritative game-state model (DOM-free). */

export type Phase = 'menu' | 'playing' | 'paused' | 'dead';

export interface GameState {
  phase: Phase;
  time: number; // survival seconds
  kills: number;
  trickScore: number; // scooter trick points (spins, tailwhips, roof tops)
  health: number;
  threatLevel: number; // 1..5
  highestThreat: number;
  weaponId: string;
  ammo: number; // magazine (-1 = melee / n/a)
  reserve: number;
  playerX: number;
  playerZ: number;
  playerYaw: number;
  sprinting: boolean;
}

export const state: GameState = {
  phase: 'menu',
  time: 0,
  kills: 0,
  trickScore: 0,
  health: 100,
  threatLevel: 1,
  highestThreat: 1,
  weaponId: 'bat',
  ammo: -1,
  reserve: 0,
  playerX: 0,
  playerZ: 8,
  playerYaw: Math.PI,
  sprinting: false,
};

export function resetState(): void {
  state.phase = 'playing';
  state.time = 0;
  state.kills = 0;
  state.trickScore = 0;
  state.health = 100;
  state.threatLevel = 1;
  state.highestThreat = 1;
  state.weaponId = 'bat';
  state.ammo = -1;
  state.reserve = 0;
  state.playerX = 0;
  state.playerZ = 8;
  state.playerYaw = Math.PI;
  state.sprinting = false;
}

const HS_KEY = 'gbg-zombie-highscore';

export interface HighScore {
  time: number;
  kills: number;
  threat: number;
}

export function loadHighScore(): HighScore | null {
  try {
    const raw = localStorage.getItem(HS_KEY);
    return raw ? (JSON.parse(raw) as HighScore) : null;
  } catch {
    return null;
  }
}

export function saveHighScore(s: HighScore): HighScore {
  const best = loadHighScore();
  if (!best || s.time > best.time) {
    try {
      localStorage.setItem(HS_KEY, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
    return s;
  }
  return best;
}
