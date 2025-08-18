import Phaser from 'https://cdn.jsdelivr.net/npm/phaser@3.80.0/dist/phaser.esm.js';

const GAME_W = 960;
const GAME_H = 540;

const Keys = { Light: 'Z', Heavy: 'X', Dash: 'SHIFT', Parry: 'CTRL' };

const State = {
  Idle: 'idle',
  Move: 'move',
  WindupLight: 'windup_light',
  WindupHeavy: 'windup_heavy',
  AttackLight: 'attack_light',
  AttackHeavy: 'attack_heavy',
  Guard: 'guard',
  ParryWindow: 'parry_window',
  Recovery: 'recovery',
};

class DuelScene extends Phaser.Scene {
  constructor() { 
    super('duel');
    console.log('[DUELISTA] DuelScene constructor iniciado');
  }
  preload() {
    console.log('[DUELISTA] preload iniciado');
  }
  create() {
    console.log('[DUELISTA] create iniciado, configurando mundo y sprites');
    this.add.rectangle(GAME_W/2, GAME_H/2, GAME_W, GAME_H, 0x0b0b0c).setOrigin(0.5);
    this.add.rectangle(GAME_W/2, 420, GAME_W, 4, 0x2c2c2e);

    // Player and Boss setup
    this.physics.world.setBounds(40, 80, GAME_W-80, 340);

    this.player = this.physics.add.sprite(240, 380, null).setOrigin(0.5, 1);
    this.player.displayWidth = 40; this.player.displayHeight = 80;
    this.player.setCollideWorldBounds(true); this.player.setImmovable(false);
    this.playerState = { state: State.Idle, stamina: 100, facing: 'right', lastAction: 'idle', lastTs: 0 };

    this.boss = this.physics.add.sprite(720, 380, null).setOrigin(0.5, 1);
    this.boss.displayWidth = 48; this.boss.displayHeight = 92;
    this.boss.setCollideWorldBounds(true);
    this.bossState = { state: State.Idle, stamina: 100, facing: 'left', lastAction: 'idle', lastTs: 0 };

    // Visuals
    this.playerRect = this.add.rectangle(0,0, this.player.displayWidth, this.player.displayHeight, 0x0a84ff).setOrigin(0.5,1);
    this.bossRect = this.add.rectangle(0,0, this.boss.displayWidth, this.boss.displayHeight, 0xff453a).setOrigin(0.5,1);

    this.playerLabel = this.add.text(0,0,'Tú',{ fontFamily:'monospace', fontSize:12, color:'#f5f5f7' }).setOrigin(0.5,1.2);
    this.bossLabel = this.add.text(0,0,'Boss',{ fontFamily:'monospace', fontSize:12, color:'#f5f5f7' }).setOrigin(0.5,1.2);

    this.whyText = this.add.text(GAME_W/2, 100, '', { fontFamily:'monospace', fontSize:14, color:'#a1a1a6' }).setOrigin(0.5,0.5);

    // Input
    this.cursors = this.input.keyboard.createCursorKeys();
    this.keyZ = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Z);
    this.keyX = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.X);
    this.keyShift = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.keyCtrl = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    // Timers and events buffer
    this.eventsBuf = [];
    this.nextIntentAt = 0;
    this.intentBudgetMs = 125; // 8Hz
    this.inFlight = false;
    this.bossActionQueue = [];
    this.bossParryWindowUntil = 0;

    // Simple ground collisions by clamping Y
    this.player.body.setAllowGravity(false); this.boss.body.setAllowGravity(false);

    // Status DOM
    this.statusEl = document.getElementById('status');
    console.log('[DUELISTA] statusEl encontrado:', this.statusEl);
    this.statusEl.innerHTML = '<span class="warn">IA:</span> a la espera…';
    console.log('[DUELISTA] create completado, juego listo');
  }
  update(time, dt) {
    // Position visuals
    this.playerRect.x = this.player.x; this.playerRect.y = this.player.y;
    this.bossRect.x = this.boss.x; this.bossRect.y = this.boss.y;
    this.playerLabel.x = this.player.x; this.playerLabel.y = this.player.y - this.player.displayHeight - 6;
    this.bossLabel.x = this.boss.x; this.bossLabel.y = this.boss.y - this.boss.displayHeight - 6;

    // Face direction by relative positions
    this.playerState.facing = (this.boss.x >= this.player.x) ? 'right' : 'left';
    this.bossState.facing = (this.player.x >= this.boss.x) ? 'right' : 'left';

    this.handlePlayer(dt);
    this.updateBoss(dt, time);

    // Intentions/interrupt loop
    if (time >= this.nextIntentAt && !this.inFlight) {
      this.nextIntentAt = time + this.intentBudgetMs;
      this.sendTick(time).catch(()=>{});
    }
  }

  handlePlayer(dt) {
    const speed = 180;
    const dashSpeed = 380;
    const now = performance.now();
    let vx = 0;
    if (this.cursors.left.isDown) vx -= speed;
    if (this.cursors.right.isDown) vx += speed;

    const canAct = ![State.WindupLight, State.WindupHeavy, State.AttackLight, State.AttackHeavy, State.Recovery].includes(this.playerState.state);

    if (canAct && Phaser.Input.Keyboard.JustDown(this.keyShift)) {
      vx = (this.playerState.facing === 'right' ? speed : -speed) + (this.playerState.facing === 'right' ? dashSpeed : -dashSpeed);
      this.playerState.state = State.Move; this.playerState.lastAction = 'dash'; this.playerState.lastTs = now;
      this.eventsBuf.push({ kind:'dash', actor:'player', t: now });
    }

    if (canAct && Phaser.Input.Keyboard.JustDown(this.keyZ)) {
      this.playerState.state = State.WindupLight; this.playerState.lastAction = 'windup_light'; this.playerState.lastTs = now;
      this.eventsBuf.push({ kind:'windup', actor:'player', detail:'light', t: now });
      setTimeout(()=>{
        this.playerState.state = State.AttackLight; this.playerState.lastAction = 'attack_light'; this.playerState.lastTs = performance.now();
        this.eventsBuf.push({ kind:'commit_attack', actor:'player', detail:'light', t: performance.now() });
        this.resolveHit('light');
        setTimeout(()=>{ this.playerState.state = State.Recovery; setTimeout(()=>{ this.playerState.state = State.Idle; }, 140); }, 60);
      }, 120);
    }

    if (canAct && Phaser.Input.Keyboard.JustDown(this.keyX)) {
      this.playerState.state = State.WindupHeavy; this.playerState.lastAction = 'windup_heavy'; this.playerState.lastTs = now;
      this.eventsBuf.push({ kind:'windup', actor:'player', detail:'heavy', t: now });
      setTimeout(()=>{
        this.playerState.state = State.AttackHeavy; this.playerState.lastAction = 'attack_heavy'; this.playerState.lastTs = performance.now();
        this.eventsBuf.push({ kind:'commit_attack', actor:'player', detail:'heavy', t: performance.now() });
        this.resolveHit('heavy');
        setTimeout(()=>{ this.playerState.state = State.Recovery; setTimeout(()=>{ this.playerState.state = State.Idle; }, 220); }, 100);
      }, 300);
    }

    if (canAct && (this.keyCtrl.isDown)) {
      this.playerState.state = State.Guard; this.playerState.lastAction = 'guard'; this.playerState.lastTs = now;
    } else if (this.playerState.state === State.Guard) {
      this.playerState.state = State.Idle;
    }

    this.player.setVelocityX(vx);
  }

  resolveHit(kind) {
    const reach = kind === 'heavy' ? 120 : 80;
    const px = this.player.x;
    const bx = this.boss.x;
    const dir = (this.playerState.facing === 'right') ? 1 : -1;
    const dist = Math.abs(bx - px);

    // Parry check window
    const now = performance.now();
    const parryActive = now < this.bossParryWindowUntil;

    if (dist <= reach) {
      if (parryActive) {
        this.flash(this.bossRect, 0x90ee90);
        this.whyText.setText('Parry!');
        // small knockback to player
        this.player.x -= 20 * dir;
      } else {
        this.flash(this.bossRect, 0xffc0cb);
        this.whyText.setText('Hit!');
        this.boss.x += 24 * dir;
      }
    }
  }

  updateBoss(dt, time) {
    // Execute queued actions
    if (this.bossActionQueue.length) {
      const now = performance.now();
      for (let i=0;i<this.bossActionQueue.length;i++) {
        const a = this.bossActionQueue[i];
        if (!a.started && now >= a.startAt) {
          a.started = true;
          if (a.type === 'microStep') {
            const dx = a.dx; const dur = a.durMs;
            const vx = (dx * 140) * (1000/dur); // scale impulse into velocity
            this.boss.setVelocityX(vx);
            setTimeout(()=>{ if (this.boss.body) this.boss.setVelocityX(0); }, dur);
          } else if (a.type === 'parry') {
            const until = now + a.whenMs;
            setTimeout(()=>{ this.bossParryWindowUntil = performance.now() + 120; this.flash(this.bossRect, 0x90ee90); }, a.whenMs);
          } else if (a.type === 'strike') {
            setTimeout(()=>{ this.flash(this.bossRect, 0xffd700); /* could add boss attack logic */ }, a.whenMs);
          }
        }
      }
      // Remove finished ones
      this.bossActionQueue = this.bossActionQueue.filter(a => !a.started || (performance.now() < a.startAt + 800));
    }
  }

  flash(rect, color) {
    const orig = rect.fillColor;
    rect.fillColor = color;
    setTimeout(()=> rect.fillColor = orig, 120);
  }

  async sendTick(time) {
    console.log('[DUELISTA] sendTick iniciado, time:', time);
    this.inFlight = true;
    const t = Date.now();
    const payload = {
      t,
      player: {
        x: this.player.x, y: this.player.y, vx: this.player.body.velocity.x/100, facing: this.playerState.facing,
        stamina: 80, lastAction: this.playerState.lastAction, lastTs: this.playerState.lastTs
      },
      boss: {
        x: this.boss.x, y: this.boss.y, vx: this.boss.body.velocity.x/100, facing: this.bossState.facing,
        stamina: 70, state: this.bossState.state
      },
      events: this.eventsBuf.splice(0, this.eventsBuf.length)
    };

    console.log('[DUELISTA] Payload a enviar:', JSON.stringify(payload));
    // Build small XML for the model (and send JSON to server that will construct XML too)
    try {
      console.log('[DUELISTA] Iniciando fetch a /zero-api/duelista/act');
      const ctrl = new AbortController();
      const timeout = setTimeout(()=> ctrl.abort(), 300);
      const resp = await fetch('/zero-api/duelista/act', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: ctrl.signal
      });
      clearTimeout(timeout);
      console.log('[DUELISTA] Respuesta status:', resp.status);
      const data = await resp.json();
      console.log('[DUELISTA] Data recibida:', data);
      const xml = String(data.xml || '').slice(0, 4000);
      console.log('[DUELISTA] XML recibido:', xml);
      if (!xml) throw new Error('empty AI xml');
      this.statusEl.innerHTML = `<span class="ok">IA:</span> ${Phaser.Utils.String.Ellipsis((data.source||'').toUpperCase(), 16)} ok`;
      this.applyActionsXML(xml);
    } catch (e) {
      console.log('[DUELISTA] Error en sendTick:', e);
      console.log('[DUELISTA] Usando fallback local heurístico');
      this.statusEl.innerHTML = `<span class=\"warn\">IA:</span> fallback local`;
      // Local heuristic when server is unavailable
      const xml = localHeuristicXML(payload);
      console.log('[DUELISTA] XML fallback generado:', xml);
      this.applyActionsXML(xml);
    } finally {
      this.inFlight = false;
    }
  }

  applyActionsXML(xml) {
    console.log('[DUELISTA] applyActionsXML recibido:', xml);
    try {
      const dom = new DOMParser().parseFromString(xml, 'application/xml');
      console.log('[DUELISTA] DOM parseado:', dom);
      const why = dom.querySelector('why')?.textContent || '';
      if (why) this.whyText.setText(why);
      const npc = dom.querySelector('npc');
      if (!npc) return;
      const ms = npc.querySelector('microStep');
      if (ms) {
        const dx = parseFloat(ms.getAttribute('dx')||'0');
        const durMs = parseInt(ms.getAttribute('durMs')||'80',10);
        this.enqueueAction({ type:'microStep', dx, durMs, startAt: performance.now() });
      }
      const parry = npc.querySelector('parry');
      if (parry) {
        const whenMs = parseInt(parry.getAttribute('whenMs')||'100',10);
        this.enqueueAction({ type:'parry', whenMs, startAt: performance.now() });
      }
      const strike = npc.querySelector('strike');
      if (strike) {
        const whenMs = parseInt(strike.getAttribute('whenMs')||'140',10);
        const kind = strike.getAttribute('kind')||'light';
        this.enqueueAction({ type:'strike', whenMs, kind, startAt: performance.now() });
      }
    } catch (e) {
      console.warn('XML parse/apply error', e);
    }
  }

  enqueueAction(a) {
    // Replace existing action of same type if queued
    const idx = this.bossActionQueue.findIndex(x => x.type === a.type);
    if (idx >= 0) this.bossActionQueue.splice(idx, 1);
    this.bossActionQueue.push(a);
  }
}

console.log('[DUELISTA] Iniciando Phaser.Game con configuración');
const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: GAME_W,
  height: GAME_H,
  parent: 'game',
  physics: { default: 'arcade', arcade: { gravity: { y: 0 }, debug: false } },
  scene: [DuelScene],
  backgroundColor: '#000000',
});

function localHeuristicXML(payload) {
  console.log('[DUELISTA] localHeuristicXML llamado con payload:', payload);
  try {
    const t = payload?.t || Date.now();
    const p = payload?.player || {}; const b = payload?.boss || {};
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const dx = (p.x ?? 0) - (b.x ?? 0);
    const absdx = Math.abs(dx);
    const prefer = 120;
    let step = 0;
    if (absdx < prefer - 10) step = dx > 0 ? -0.6 : 0.6;
    else if (absdx > prefer + 20) step = dx > 0 ? 0.6 : -0.6;
    const wind = events.find(e => e.kind === 'windup' && e.actor === 'player');
    const parry = wind ? `<parry dir=\"mid\" whenMs=\"120\"/>` : '';
    const strike = (!wind && absdx < 110) ? `<strike kind=\"light\" whenMs=\"160\"/>` : '';
    const why = wind ? 'Backstep y parry tardío del heavy.' : (absdx > prefer ? 'Cerrar distancia con micro pasos.' : 'Mantener spacing y amenazar light.');
    return [
      `<actions t=\"${t}\">`,
      `  <npc id=\"boss\">`,
      `    <microStep dx=\"${step.toFixed(1)}\" dy=\"0.0\" durMs=\"120\"/>`,
      parry ? `    ${parry}` : '',
      strike ? `    ${strike}` : '',
      `    <why>${why}</why>`,
      `  </npc>`,
      `</actions>`
    ].filter(Boolean).join('\n');
  } catch {
    return `<actions t=\"${Date.now()}\"><npc id=\"boss\"><microStep dx=\"0.0\" dy=\"0.0\" durMs=\"80\"/><why>fallback</why></npc></actions>`;
  }
}
