/** HUD: DOM overlay updates, prompts, damage feedback, menus. */
import { GameState } from './state';

const $ = (id: string): HTMLElement => document.getElementById(id)!;

export class Hud {
  private els = {
    health: $('hp-fill'),
    hpwrap: $('hp-wrap'),
    time: $('hud-time'),
    kills: $('hud-kills'),
    tricks: $('hud-tricks'),
    trickpop: $('trickpop'),
    threat: $('hud-threat'),
    weapon: $('hud-weapon'),
    ammo: $('hud-ammo'),
    battery: $('battery-wrap'),
    batteryFill: $('battery-fill'),
    batteryLabel: $('battery-label'),
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
  private trickT = 0;
  private lastWeapon = '';

  update(
    s: GameState, dt: number, fps: number,
    damageFlash: number, damageDir: number, yaw: number,
    battery = -1, // 0..1 while riding a scooter, -1 to hide the bar
  ): void {
    this.els.health.style.width = `${Math.max(0, s.health)}%`;
    this.els.hpwrap.style.borderColor = s.health < 30 ? '#ff4444' : '#ffffff55';
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60);
    this.els.time.textContent = `${m}:${sec.toString().padStart(2, '0')}`;
    this.els.kills.textContent = String(s.kills);
    this.els.tricks.textContent = `Tricks: ${s.trickScore}`;
    this.els.tricks.style.display = s.trickScore > 0 ? '' : 'none';
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

    if (battery >= 0) {
      this.els.battery.style.display = 'block';
      this.els.batteryLabel.style.display = 'block';
      this.els.batteryFill.style.width = `${Math.round(Math.max(0, battery) * 100)}%`;
      this.els.batteryFill.style.background = battery < 0.25
        ? 'linear-gradient(90deg,#8c2a1a,#ff5544)'
        : 'linear-gradient(90deg,#b8952a,#ffd75e)';
    } else {
      this.els.battery.style.display = 'none';
      this.els.batteryLabel.style.display = 'none';
    }

    this.els.vignette.style.opacity = String(Math.min(0.85, damageFlash * 0.85));
    if (this.hitmarkT > 0) {
      this.hitmarkT -= dt;
      this.els.hitmark.style.opacity = String(Math.max(0, this.hitmarkT * 4));
    }
    if (this.trickT > 0) {
      this.trickT -= dt;
      this.els.trickpop.style.opacity = String(Math.max(0, Math.min(1, this.trickT * 2.5)));
    }
    if (damageFlash > 0.05) {
      const ang = damageDir - yaw;
      this.els.dmgdir.style.opacity = String(damageFlash);
      this.els.dmgdir.style.transform = `translate(-50%,-50%) rotate(${-ang}rad)`;
    } else {
      this.els.dmgdir.style.opacity = '0';
    }
  }

  hitMarker(headshot = false): void {
    this.hitmarkT = headshot ? 0.4 : 0.25;
    this.els.hitmark.textContent = headshot ? '✕ HEADSHOT' : '✕';
    this.els.hitmark.style.color = headshot ? '#ffd75e' : '#ff4444';
    this.els.hitmark.style.fontSize = headshot ? '22px' : '26px';
    this.els.hitmark.style.opacity = '1';
  }

  trick(text: string): void {
    this.trickT = 1.7;
    this.els.trickpop.textContent = text;
    this.els.trickpop.style.opacity = '1';
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
