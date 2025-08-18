// ECHO CHAMBER - Arena Shooter 2D con IA Psicológica
console.log('[ECHO] echo-chamber.js iniciado');

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const PLAYER_SPEED = 200;
const BULLET_SPEED = 600;
const DASH_SPEED = 500;
const DASH_DURATION = 200;
const MAX_AMMO = 12;
const RELOAD_TIME = 2000;

// Estado global para patrones
const PlayerPatterns = {
  reload_at: [],
  movement_tendency: { left: 0, right: 0, up: 0, down: 0 },
  cover_usage: {},
  shot_timing: [],
  dash_usage: []
};

class EchoArena extends Phaser.Scene {
  constructor() {
    super({ key: 'arena' });
    console.log('[ECHO] EchoArena constructor');
  }

  preload() {
    console.log('[ECHO] Preloading assets...');
  }

  create() {
    console.log('[ECHO] Creating arena...');
    
    // Fondo y bordes
    this.add.rectangle(GAME_WIDTH/2, GAME_HEIGHT/2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a0c);
    
    // Grid sutil para referencia visual
    for (let x = 0; x < GAME_WIDTH; x += 50) {
      this.add.line(0, 0, x, 0, x, GAME_HEIGHT, 0x1c1c1e, 0.3);
    }
    for (let y = 0; y < GAME_HEIGHT; y += 50) {
      this.add.line(0, 0, 0, y, GAME_WIDTH, y, 0x1c1c1e, 0.3);
    }
    
    // Coberturas destructibles
    this.covers = this.physics.add.staticGroup();
    this.createCovers();
    
    // Jugador
    this.player = this.physics.add.sprite(200, 300, null);
    this.player.setSize(24, 24);
    this.player.setDisplaySize(24, 24);
    this.playerGraphics = this.add.circle(0, 0, 12, 0x0a84ff);
    this.playerAimLine = this.add.line(0, 0, 0, 0, 50, 0, 0x0a84ff, 0.5);
    
    // Estado del jugador
    this.playerState = {
      hp: 100,
      ammo: MAX_AMMO,
      reloading: false,
      reloadTimer: 0,
      dashCooldown: 0,
      isDashing: false,
      lastShot: 0
    };
    
    // Echo (IA)
    this.echo = this.physics.add.sprite(600, 300, null);
    this.echo.setSize(24, 24);
    this.echo.setDisplaySize(24, 24);
    this.echoGraphics = this.add.circle(0, 0, 12, 0xff453a);
    this.echoAimLine = this.add.line(0, 0, 0, 0, 50, 0, 0xff453a, 0.5);
    
    // Estado del Echo
    this.echoState = {
      hp: 100,
      ammo: MAX_AMMO,
      reloading: false,
      thinking: false,
      lastThought: 0,
      confidence: 0.5,
      aggression: 0.5,
      currentPlan: null
    };
    
    // Grupos de balas
    this.playerBullets = this.physics.add.group();
    this.echoBullets = this.physics.add.group();
    
    // Colisiones
    this.physics.add.collider(this.player, this.covers);
    this.physics.add.collider(this.echo, this.covers);
    this.physics.add.collider(this.playerBullets, this.covers, this.bulletHitCover, null, this);
    this.physics.add.collider(this.echoBullets, this.covers, this.bulletHitCover, null, this);
    this.physics.add.overlap(this.playerBullets, this.echo, this.bulletHitEcho, null, this);
    this.physics.add.overlap(this.echoBullets, this.player, this.bulletHitPlayer, null, this);
    
    // Input
    this.cursors = this.input.keyboard.addKeys('W,A,S,D,R,SHIFT');
    this.input.on('pointerdown', this.playerShoot, this);
    
    // IA tick timer
    this.lastAITick = 0;
    this.aiTickRate = 100; // 10 Hz
    
    // UI elements
    this.narrationElement = document.getElementById('narration');
    this.updateUI();
    
    console.log('[ECHO] Arena ready. The Echo awakens...');
    this.showNarration("Let's see what you've got...", 'confident');
  }

  update(time, delta) {
    // Update jugador
    this.handlePlayerMovement(delta);
    this.updatePlayerReload(delta);
    
    // Update Echo IA
    if (time - this.lastAITick > this.aiTickRate) {
      this.lastAITick = time;
      this.thinkAndAct(time);
    }
    
    // Update posiciones visuales
    this.playerGraphics.x = this.player.x;
    this.playerGraphics.y = this.player.y;
    this.echoGraphics.x = this.echo.x;
    this.echoGraphics.y = this.echo.y;
    
    // Update líneas de apuntado
    const mouseX = this.input.activePointer.x;
    const mouseY = this.input.activePointer.y;
    const playerAngle = Phaser.Math.Angle.Between(this.player.x, this.player.y, mouseX, mouseY);
    this.playerAimLine.setTo(
      this.player.x, this.player.y,
      this.player.x + Math.cos(playerAngle) * 50,
      this.player.y + Math.sin(playerAngle) * 50
    );
    
    // Echo apunta al jugador (por ahora)
    const echoAngle = Phaser.Math.Angle.Between(this.echo.x, this.echo.y, this.player.x, this.player.y);
    this.echoAimLine.setTo(
      this.echo.x, this.echo.y,
      this.echo.x + Math.cos(echoAngle) * 50,
      this.echo.y + Math.sin(echoAngle) * 50
    );
    
    // Limpiar balas fuera de pantalla
    this.playerBullets.children.entries.forEach(bullet => {
      if (bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT) {
        bullet.destroy();
      }
    });
    this.echoBullets.children.entries.forEach(bullet => {
      if (bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT) {
        bullet.destroy();
      }
    });
  }

  handlePlayerMovement(delta) {
    let vx = 0, vy = 0;
    
    if (this.cursors.A.isDown) {
      vx -= PLAYER_SPEED;
      PlayerPatterns.movement_tendency.left++;
    }
    if (this.cursors.D.isDown) {
      vx += PLAYER_SPEED;
      PlayerPatterns.movement_tendency.right++;
    }
    if (this.cursors.W.isDown) {
      vy -= PLAYER_SPEED;
      PlayerPatterns.movement_tendency.up++;
    }
    if (this.cursors.S.isDown) {
      vy += PLAYER_SPEED;
      PlayerPatterns.movement_tendency.down++;
    }
    
    // Dash
    if (this.cursors.SHIFT.isDown && this.playerState.dashCooldown <= 0 && !this.playerState.isDashing) {
      this.playerState.isDashing = true;
      this.playerState.dashCooldown = 3000;
      const dashAngle = Math.atan2(vy, vx);
      vx = Math.cos(dashAngle) * DASH_SPEED;
      vy = Math.sin(dashAngle) * DASH_SPEED;
      PlayerPatterns.dash_usage.push(Date.now());
      
      setTimeout(() => {
        this.playerState.isDashing = false;
      }, DASH_DURATION);
    }
    
    if (!this.playerState.isDashing) {
      this.player.setVelocity(vx, vy);
    } else {
      // Durante dash, mantener velocidad
    }
    
    // Cooldown del dash
    if (this.playerState.dashCooldown > 0) {
      this.playerState.dashCooldown -= delta;
    }
  }

  updatePlayerReload(delta) {
    if (this.cursors.R.isDown && !this.playerState.reloading && this.playerState.ammo < MAX_AMMO) {
      this.startReload('player');
    }
    
    if (this.playerState.reloading) {
      this.playerState.reloadTimer -= delta;
      if (this.playerState.reloadTimer <= 0) {
        this.playerState.reloading = false;
        this.playerState.ammo = MAX_AMMO;
        this.updateUI();
      }
    }
  }

  playerShoot(pointer) {
    if (this.playerState.ammo <= 0 || this.playerState.reloading) return;
    
    const angle = Phaser.Math.Angle.Between(this.player.x, this.player.y, pointer.x, pointer.y);
    this.createBullet(this.player.x, this.player.y, angle, 'player');
    
    this.playerState.ammo--;
    this.playerState.lastShot = Date.now();
    PlayerPatterns.shot_timing.push(Date.now());
    
    // Auto-reload si se queda sin balas
    if (this.playerState.ammo === 0) {
      this.startReload('player');
    }
    
    // Registrar patrón de recarga
    if (this.playerState.ammo <= 3) {
      PlayerPatterns.reload_at.push(this.playerState.ammo);
    }
    
    this.updateUI();
  }

  startReload(who) {
    if (who === 'player') {
      this.playerState.reloading = true;
      this.playerState.reloadTimer = RELOAD_TIME;
      console.log('[ECHO] Player reloading...');
    } else {
      this.echoState.reloading = true;
      setTimeout(() => {
        this.echoState.reloading = false;
        this.echoState.ammo = MAX_AMMO;
      }, RELOAD_TIME);
    }
  }

  createBullet(x, y, angle, owner) {
    const bullet = this.add.circle(x, y, 3, owner === 'player' ? 0x0a84ff : 0xff453a);
    this.physics.add.existing(bullet);
    
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;
    bullet.body.setVelocity(vx, vy);
    
    if (owner === 'player') {
      this.playerBullets.add(bullet);
    } else {
      this.echoBullets.add(bullet);
    }
  }

  createCovers() {
    // Coberturas estratégicas en el mapa
    const coverPositions = [
      { x: 200, y: 150, w: 80, h: 20 },
      { x: 600, y: 150, w: 80, h: 20 },
      { x: 200, y: 450, w: 80, h: 20 },
      { x: 600, y: 450, w: 80, h: 20 },
      { x: 400, y: 300, w: 60, h: 60 }
    ];
    
    coverPositions.forEach((pos, i) => {
      const cover = this.add.rectangle(pos.x, pos.y, pos.w, pos.h, 0x2c2c2e);
      cover.hp = 3;
      cover.id = `cover_${i}`;
      this.physics.add.existing(cover, true);
      this.covers.add(cover);
    });
  }

  bulletHitCover(bullet, cover) {
    bullet.destroy();
    cover.hp--;
    if (cover.hp <= 0) {
      cover.destroy();
      console.log('[ECHO] Cover destroyed:', cover.id);
    }
  }

  bulletHitPlayer(bullet, player) {
    bullet.destroy();
    this.playerState.hp -= 15;
    this.updateUI();
    console.log('[ECHO] Player hit! HP:', this.playerState.hp);
    
    if (this.playerState.hp <= 0) {
      this.gameOver(false);
    }
  }

  bulletHitEcho(bullet, echo) {
    bullet.destroy();
    this.echoState.hp -= 15;
    this.updateUI();
    console.log('[ECHO] Echo hit! HP:', this.echoState.hp);
    
    if (this.echoState.hp <= 0) {
      this.gameOver(true);
    }
  }

  async thinkAndAct(time) {
    if (this.echoState.thinking) return;
    this.echoState.thinking = true;
    
    // Construir estado del juego para la IA
    const gameState = this.buildGameStateXML();
    
    try {
      // Llamar al endpoint de IA
      const response = await fetch('/zero-api/echo/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: gameState })
      });
      
      if (!response.ok) throw new Error('IA response failed');
      
      const data = await response.json();
      this.executeEchoActions(data.xml);
      
    } catch (error) {
      console.log('[ECHO] IA fallback mode:', error);
      // Comportamiento básico de fallback
      this.executeBasicAI();
    }
    
    this.echoState.thinking = false;
  }

  buildGameStateXML() {
    const patterns = this.analyzePatterns();
    
    return `<game_state t="${Date.now()}" phase="combat">
  <player x="${Math.round(this.player.x)}" y="${Math.round(this.player.y)}" 
          hp="${this.playerState.hp}" ammo="${this.playerState.ammo}" 
          reloading="${this.playerState.reloading}" />
  <echo x="${Math.round(this.echo.x)}" y="${Math.round(this.echo.y)}" 
        hp="${this.echoState.hp}" ammo="${this.echoState.ammo}" />
  <patterns>
    <pattern type="reload_threshold" value="${patterns.reloadAt}" confidence="${patterns.reloadConfidence}" />
    <pattern type="movement_bias" value="${patterns.movementBias}" />
  </patterns>
</game_state>`;
  }

  analyzePatterns() {
    // Analizar umbral de recarga
    const reloadAt = PlayerPatterns.reload_at.length > 0 
      ? Math.round(PlayerPatterns.reload_at.reduce((a,b) => a+b, 0) / PlayerPatterns.reload_at.length)
      : 3;
    
    // Calcular sesgo de movimiento
    const moves = PlayerPatterns.movement_tendency;
    const totalMoves = moves.left + moves.right + moves.up + moves.down;
    let movementBias = 'balanced';
    if (totalMoves > 0) {
      if (moves.left > totalMoves * 0.3) movementBias = 'left';
      else if (moves.right > totalMoves * 0.3) movementBias = 'right';
    }
    
    return {
      reloadAt,
      reloadConfidence: Math.min(PlayerPatterns.reload_at.length / 5, 1),
      movementBias
    };
  }

  executeEchoActions(xml) {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      
      // Movimiento
      const movement = doc.querySelector('movement');
      if (movement) {
        const targetX = parseInt(movement.getAttribute('x'));
        const targetY = parseInt(movement.getAttribute('y'));
        const angle = Phaser.Math.Angle.Between(this.echo.x, this.echo.y, targetX, targetY);
        const distance = Phaser.Math.Distance.Between(this.echo.x, this.echo.y, targetX, targetY);
        const speed = Math.min(distance * 10, PLAYER_SPEED);
        
        this.echo.setVelocity(
          Math.cos(angle) * speed,
          Math.sin(angle) * speed
        );
      }
      
      // Disparo
      const shoot = doc.querySelector('shoot');
      if (shoot && this.echoState.ammo > 0 && !this.echoState.reloading) {
        const atMs = parseInt(shoot.getAttribute('at_ms') || '0');
        setTimeout(() => {
          if (this.echoState.ammo > 0) {
            const angle = Phaser.Math.Angle.Between(this.echo.x, this.echo.y, this.player.x, this.player.y);
            this.createBullet(this.echo.x, this.echo.y, angle, 'echo');
            this.echoState.ammo--;
            
            if (this.echoState.ammo === 0) {
              this.startReload('echo');
            }
          }
        }, atMs);
      }
      
      // Narración
      const narration = doc.querySelector('narration');
      if (narration) {
        const text = narration.textContent;
        const tone = narration.getAttribute('tone') || 'neutral';
        const timing = narration.getAttribute('timing') || 'immediate';
        
        if (timing === 'immediate') {
          this.showNarration(text, tone);
        } else {
          const delay = parseInt(timing);
          setTimeout(() => this.showNarration(text, tone), delay);
        }
      }
      
    } catch (error) {
      console.error('[ECHO] Error parsing AI response:', error);
      this.executeBasicAI();
    }
  }

  executeBasicAI() {
    // IA básica de fallback
    const angle = Phaser.Math.Angle.Between(this.echo.x, this.echo.y, this.player.x, this.player.y);
    const distance = Phaser.Math.Distance.Between(this.echo.x, this.echo.y, this.player.x, this.player.y);
    
    // Mantener distancia óptima
    const optimalDistance = 200;
    if (distance > optimalDistance + 50) {
      // Acercarse
      this.echo.setVelocity(
        Math.cos(angle) * PLAYER_SPEED * 0.8,
        Math.sin(angle) * PLAYER_SPEED * 0.8
      );
    } else if (distance < optimalDistance - 50) {
      // Alejarse
      this.echo.setVelocity(
        -Math.cos(angle) * PLAYER_SPEED * 0.8,
        -Math.sin(angle) * PLAYER_SPEED * 0.8
      );
    } else {
      // Strafe
      const strafeAngle = angle + Math.PI/2;
      this.echo.setVelocity(
        Math.cos(strafeAngle) * PLAYER_SPEED * 0.5,
        Math.sin(strafeAngle) * PLAYER_SPEED * 0.5
      );
    }
    
    // Disparar si tiene munición
    if (this.echoState.ammo > 0 && !this.echoState.reloading && Math.random() < 0.3) {
      this.createBullet(this.echo.x, this.echo.y, angle, 'echo');
      this.echoState.ammo--;
      
      if (this.echoState.ammo === 0) {
        this.startReload('echo');
      }
    }
  }

  showNarration(text, tone = 'neutral') {
    this.narrationElement.textContent = text;
    this.narrationElement.classList.add('active');
    
    // Text to speech si está disponible
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.2;
      utterance.pitch = tone === 'confident' ? 0.9 : tone === 'desperate' ? 1.3 : 1.0;
      speechSynthesis.speak(utterance);
    }
    
    clearTimeout(this.narrationTimeout);
    this.narrationTimeout = setTimeout(() => {
      this.narrationElement.classList.remove('active');
    }, 3000);
  }

  updateUI() {
    document.getElementById('player-hp').textContent = Math.max(0, this.playerState.hp);
    document.getElementById('player-ammo').textContent = this.playerState.ammo;
    document.getElementById('echo-hp').textContent = Math.max(0, this.echoState.hp);
  }

  gameOver(playerWon) {
    this.physics.pause();
    
    if (playerWon) {
      this.showNarration("Impressive... but I learn from defeat.", 'defeated');
    } else {
      this.showNarration("Too predictable. I knew every move.", 'triumphant');
      // Echo aprende los patrones para la próxima ronda
      console.log('[ECHO] Patterns absorbed:', PlayerPatterns);
    }
    
    setTimeout(() => {
      this.scene.restart();
    }, 5000);
  }
}

// Inicializar Phaser
const config = {
  type: Phaser.AUTO,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  parent: 'game',
  physics: {
    default: 'arcade',
    arcade: {
      gravity: { y: 0 },
      debug: false
    }
  },
  scene: [EchoArena],
  backgroundColor: '#0a0a0c'
};

console.log('[ECHO] Iniciando Phaser con config:', config);
const game = new Phaser.Game(config);