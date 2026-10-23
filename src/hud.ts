/** HUD: DOM overlay updates, prompts, damage feedback, menus. */
import { GameState } from './state';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class Hud {
  private els = {
    health: $('hp-fill'),
    hpwrap: $('hp-wrap'),
    time: $('hud-time'),
    kills: $('hud-kills'),
    threat: $('hud-threat'),
    weapon: $('hud-weapon'),
    ammo: $('hud-ammo'),
    prompt: $('prompt'),
    vignette: $('vignette'),
    hitmark: $('hitmark'),
    dmgdir: $('dmgdir'),
    menu: $('menu'),
    pause: $('pause'),
    gameover: $('gameover'),
    goTime: $('go-time'),
    goKills: $('go-kills'),
    goThreat: $('go-threat'),
    goBest: $('go-best'),
    fps: $('hud-fps'),
  };

  private hitmarkT = 0;
  private lastWeapon = '';

  update(s: GameState, dt: number, fps: number, damageFlash: number, damageDir: number, yaw: number): void {
    this.els.health.style.width = `${Math.max(0, s.health)}%`;
    this.els.hpwrap.style.borderColor = s.health < 30 ? '#ff4444' : '#ffffff55';
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60);
    this.els.time.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
    this.els.kills.textContent = String(s.kills);
    this.els.threat.textContent = '★'.repeat(s.threatLevel) + '☆'.repeat(5 - s.threatLevel);
    this.els.threat.style.color = s.threatLevel >= 4 ? '#ff5544' : s.threatLevel >= 3 ? '#ffaa33' : '#ffd75e';
    if (s.weaponId !== this.lastWeapon) {
      this.lastWeapon = s.weaponId;
    }
    this.els.weapon.textContent = weaponName(s.weaponId);
    if (s.ammo >= 0) {
      this.els.ammo.textContent = `${s.ammo} / ${s.reserve}`;
      this.els.ammo.style.display = '';
    } else {
      this.els.ammo.style.display = 'none';
    }
    this.els.fps.textContent = `${Math.round(fps)} fps`;

    this.els.vignette.style.opacity = String(Math.min(0.85, damageFlash * 0.85));
    if (this.hitmarkT > 0) {
      this.hitmarkT -= dt;
      this.els.hitmark.style.opacity = String(Math.max(0, this.hitmarkT * 4));
    }
    if (damageFlash > 0.05) {
      const ang = damageDir - yaw;
      this.els.dmgdir.style.opacity = String(damageFlash);
      this.els.dmgdir.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    } else {
      this.els.dmgdir.style.opacity = '0';
    }
  }

  hitMarker(): void {
    this.hitmarkT = 0.25;
    this.els.hitmark.style.opacity = '1';
  }

  showPrompt(text: string): void {
    this.els.prompt.textContent = text;
    this.els.prompt.style.display = text ? 'block' : 'none';
  }

  showMenu(): void {
    this.els.menu.style.display = 'flex';
    this.els.pause.style.display = 'none';
    this.els.gameover.style.display = 'none';
  }

  showPause(): void {
    this.els.pause.style.display = 'flex';
  }

  hideOverlays(): void {
    this.els.menu.style.display = 'none';
    this.els.pause.style.display = 'none';
    this.els.gameover.style.display = 'none';
  }

  showGameOver(time: number, kills: number, threat: number, best: string): void {
    const m = Math.floor(time / 60);
    const sec = Math.floor(time % 60);
    this.els.goTime.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
    this.els.goKills.textContent = String(kills);
    this.els.goThreat.textContent = '★'.repeat(threat);
    this.els.goBest.textContent = best;
    this.els.gameover.style.display = 'flex';
  }
}

function weaponName(id: string): string {
  const names: Record<string, string> = {
    bat: 'Baseball Bat', axe: 'Axe', sword: 'Sword', chainsaw: 'Chainsaw',
    pistol: 'Pistol', shotgun: 'Shotgun', ak: 'AK-47', bazooka: 'Bazooka',
  };
  return names[id] ?? id;
}
