/**
 * Mobile touch controls: left virtual joystick (move), right-side drag
 * (look), and thumb buttons for fire / jump / reload / grab / sprint / pause.
 * Only instantiated on coarse-pointer devices; desktop keeps mouse+keyboard.
 */

export interface TouchCallbacks {
  look(dx: number, dy: number): void;
  fire(on: boolean): void;
  jump(): void;
  reload(): void;
  pickup(): void;
  pause(): void;
}

const STICK_RADIUS = 58; // px at full deflection
const DEAD_ZONE = 7;

export function isTouchDevice(): boolean {
  // ?forcetouch=1 lets the touch UI be tested on a desktop browser.
  if (location.search.includes('forcetouch')) return true;
  return navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches;
}

const CSS = `
#touch-root { position: fixed; inset: 0; z-index: 6; pointer-events: none;
  touch-action: none; user-select: none; -webkit-user-select: none; }
#touch-root.hidden { display: none; }
.tch-zone { position: absolute; pointer-events: auto; touch-action: none; }
#stick-zone { left: 0; bottom: 0; width: 52%; height: 55%; }
#look-zone { right: 0; top: 0; width: 48%; height: 100%; }
#stick-base { position: absolute; width: 128px; height: 128px; margin: -64px 0 0 -64px;
  border-radius: 50%; border: 2px solid #ffffff55; background: #ffffff14; display: none; }
#stick-knob { position: absolute; width: 54px; height: 54px; margin: -27px 0 0 -27px;
  border-radius: 50%; background: #ffffff66; display: none; }
.tch-btn { position: absolute; pointer-events: auto; touch-action: none;
  border-radius: 50%; border: 2px solid #ffffff66; background: #ffffff22; color: #fff;
  font: 700 13px/1 'Segoe UI', Arial, sans-serif; text-align: center;
  display: flex; align-items: center; justify-content: center;
  text-shadow: 0 1px 2px #000; -webkit-tap-highlight-color: transparent; }
.tch-btn:active, .tch-btn.on { background: #ffffff55; }
#btn-fire { right: 22px; bottom: 96px; width: 96px; height: 96px; font-size: 15px;
  background: #b3282d55; border-color: #ff8888aa; }
#btn-fire:active, #btn-fire.on { background: #b3282dcc; }
#btn-jump { right: 136px; bottom: 34px; width: 62px; height: 62px; }
#btn-sprint { left: 24px; bottom: 172px; width: 58px; height: 58px; }
#btn-reload { right: 34px; bottom: 210px; width: 54px; height: 54px; }
#btn-grab { right: 104px; bottom: 250px; width: 54px; height: 54px; }
#btn-pause { right: 12px; top: 12px; width: 40px; height: 40px; font-size: 16px; }
`;

export class TouchControls {
  /** Analog move vector, -1..1 (x = strafe, y = forward-negative). */
  moveX = 0;
  moveY = 0;
  sprint = false;
  /** Timestamp of last touch interaction — used to swallow synthetic mouse events. */
  lastTouch = 0;

  private root: HTMLElement;
  private stickBase: HTMLElement;
  private stickKnob: HTMLElement;
  private stickId = -1;
  private originX = 0;
  private originY = 0;
  private lookId = -1;
  private lookX = 0;
  private lookY = 0;

  constructor(private cb: TouchCallbacks) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'touch-root';
    this.root.className = 'hidden';
    this.root.innerHTML = `
      <div class="tch-zone" id="look-zone"></div>
      <div class="tch-zone" id="stick-zone"></div>
      <div id="stick-base"></div><div id="stick-knob"></div>
      <div class="tch-btn" id="btn-fire">FIRE</div>
      <div class="tch-btn" id="btn-jump">JUMP</div>
      <div class="tch-btn" id="btn-sprint">RUN</div>
      <div class="tch-btn" id="btn-reload">R</div>
      <div class="tch-btn" id="btn-grab">E</div>
      <div class="tch-btn" id="btn-pause">II</div>`;
    document.body.appendChild(this.root);

    this.stickBase = this.el('stick-base');
    this.stickKnob = this.el('stick-knob');

    const stickZone = this.el('stick-zone');
    const lookZone = this.el('look-zone');

    // --- joystick ---
    stickZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.stickId >= 0) return;
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      this.originX = t.clientX;
      this.originY = t.clientY;
      this.stickBase.style.display = 'block';
      this.stickKnob.style.display = 'block';
      this.placeStick(t.clientX, t.clientY);
      this.mark();
    }, { passive: false });
    stickZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stickId) continue;
        const dx = t.clientX - this.originX;
        const dy = t.clientY - this.originY;
        const len = Math.hypot(dx, dy);
        if (len < DEAD_ZONE) {
          this.moveX = 0;
          this.moveY = 0;
        } else {
          const k = Math.min(1, (len - DEAD_ZONE) / STICK_RADIUS) / len;
          this.moveX = Math.max(-1, Math.min(1, dx * k));
          this.moveY = Math.max(-1, Math.min(1, dy * k));
        }
        this.placeStick(t.clientX, t.clientY);
      }
      this.mark();
    }, { passive: false });
    const stickEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.stickId) continue;
        this.stickId = -1;
        this.moveX = 0;
        this.moveY = 0;
        this.stickBase.style.display = 'none';
        this.stickKnob.style.display = 'none';
      }
      this.mark();
    };
    stickZone.addEventListener('touchend', stickEnd);
    stickZone.addEventListener('touchcancel', stickEnd);

    // --- look drag ---
    lookZone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (this.lookId >= 0) return;
      const t = e.changedTouches[0];
      this.lookId = t.identifier;
      this.lookX = t.clientX;
      this.lookY = t.clientY;
      this.mark();
    }, { passive: false });
    lookZone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier !== this.lookId) continue;
        this.cb.look(t.clientX - this.lookX, t.clientY - this.lookY);
        this.lookX = t.clientX;
        this.lookY = t.clientY;
      }
      this.mark();
    }, { passive: false });
    const lookEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.lookId) this.lookId = -1;
      }
      this.mark();
    };
    lookZone.addEventListener('touchend', lookEnd);
    lookZone.addEventListener('touchcancel', lookEnd);

    // --- buttons ---
    this.holdButton('btn-fire', (on) => {
      this.cb.fire(on);
      this.el('btn-fire').classList.toggle('on', on);
    });
    this.holdButton('btn-sprint', (on) => {
      this.sprint = on;
      this.el('btn-sprint').classList.toggle('on', on);
    });
    this.tapButton('btn-jump', () => this.cb.jump());
    this.tapButton('btn-reload', () => this.cb.reload());
    this.tapButton('btn-grab', () => this.cb.pickup());
    this.tapButton('btn-pause', () => this.cb.pause());
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    if (!v) {
      // release everything so nothing stays stuck while an overlay is up
      this.moveX = 0;
      this.moveY = 0;
      this.sprint = false;
      this.stickId = -1;
      this.lookId = -1;
      this.stickBase.style.display = 'none';
      this.stickKnob.style.display = 'none';
      this.cb.fire(false);
      this.el('btn-fire').classList.remove('on');
      this.el('btn-sprint').classList.remove('on');
    }
  }

  private mark(): void {
    this.lastTouch = Date.now();
  }

  private el(id: string): HTMLElement {
    return this.root.querySelector('#' + id) as HTMLElement;
  }

  private placeStick(x: number, y: number): void {
    const dx = x - this.originX;
    const dy = y - this.originY;
    const len = Math.hypot(dx, dy);
    const k = len > STICK_RADIUS ? STICK_RADIUS / len : 1;
    this.stickBase.style.left = `${this.originX}px`;
    this.stickBase.style.top = `${this.originY}px`;
    this.stickKnob.style.left = `${this.originX + dx * k}px`;
    this.stickKnob.style.top = `${this.originY + dy * k}px`;
  }

  /** Press-and-hold button (fire, sprint). */
  private holdButton(id: string, set: (on: boolean) => void): void {
    const node = this.el(id);
    const on = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      set(true);
      this.mark();
    };
    const off = (e: TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      set(false);
      this.mark();
    };
    node.addEventListener('touchstart', on, { passive: false });
    node.addEventListener('touchend', off);
    node.addEventListener('touchcancel', off);
  }

  /** Single-tap button (jump, reload, grab, pause). */
  private tapButton(id: string, act: () => void): void {
    const node = this.el(id);
    node.addEventListener('touchstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      act();
      this.mark();
    }, { passive: false });
  }
}
