// ECHO CHAMBER - Platformer 2D con IA Psicológica
console.log('[ECHO] echo-chamber.js iniciado - VERSION PLATFORMER CON GRAVEDAD');

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const GRAVITY = 800;
const PLAYER_SPEED = 250;
const JUMP_VELOCITY = -400;
const BULLET_SPEED = 600; // Aumentamos velocidad de balas
const MAX_AMMO = 12;
const RELOAD_TIME = 2000;

// Estado global para patrones
const PlayerPatterns = {
  reload_at: [],
  jump_spots: [],
  preferred_height: [],
  shot_timing: [],
  movement_rhythm: []
};

class EchoArena extends Phaser.Scene {
  constructor() {
    super({ key: 'arena' });
    console.log('[ECHO] EchoArena constructor - PLATFORMER MODE');
  }

  preload() {
    console.log('[ECHO] Preloading assets...');
  }

  create() {
    console.log('[ECHO] ==========================================');
    console.log('[ECHO] Creating PLATFORMER arena with GRAVITY');
    console.log('[ECHO] ==========================================');
    
    // Física con gravedad
    this.physics.world.gravity.y = GRAVITY;
    
    // Fondo
    this.add.rectangle(GAME_WIDTH/2, GAME_HEIGHT/2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a0c);
    
    // Plataformas
    this.platforms = this.physics.add.staticGroup();
    this.createPlatforms();
    
    // Jugador
    this.player = this.physics.add.sprite(100, 400, null);
    this.player.setSize(24, 32);
    this.player.setDisplaySize(24, 32);
    this.player.setBounce(0.1);
    this.player.setCollideWorldBounds(true);
    this.playerGraphics = this.add.rectangle(0, 0, 24, 32, 0x0a84ff);
    
    // Estado del jugador
    this.playerState = {
      hp: 100,
      ammo: MAX_AMMO,
      reloading: false,
      reloadTimer: 0,
      lastShot: 0,
      onGround: false,
      facing: 'right',
      aimX: 1,  // -1 left, 0 center, 1 right
      aimY: 0,  // -1 up, 0 center, 1 down
      shootCooldown: false
    };
    
    // Echo (IA)
    this.echo = this.physics.add.sprite(700, 400, null);
    this.echo.setSize(24, 32);
    this.echo.setDisplaySize(24, 32);
    this.echo.setBounce(0.1);
    this.echo.setCollideWorldBounds(true);
    this.echoGraphics = this.add.rectangle(0, 0, 24, 32, 0xff453a);
    
    // Estado del Echo
    this.echoState = {
      hp: 100,
      ammo: MAX_AMMO,
      reloading: false,
      thinking: false,
      lastThought: 0,
      confidence: 0.5,
      aggression: 0.5,
      currentPlan: null,
      onGround: false,
      facing: 'left'
    };
    
    // Grupos de balas con configuración especial
    this.playerBullets = this.physics.add.group({
      allowGravity: false,
      immovable: false
    });
    this.echoBullets = this.physics.add.group({
      allowGravity: false,
      immovable: false
    });
    
    // Colisiones
    this.physics.add.collider(this.player, this.platforms, () => {
      this.playerState.onGround = true;
    });
    this.physics.add.collider(this.echo, this.platforms, () => {
      this.echoState.onGround = true;
    });
    this.physics.add.collider(this.playerBullets, this.platforms, this.bulletHitWall, null, this);
    this.physics.add.collider(this.echoBullets, this.platforms, this.bulletHitWall, null, this);
    this.physics.add.overlap(this.playerBullets, this.echo, this.bulletHitEcho, null, this);
    this.physics.add.overlap(this.echoBullets, this.player, this.bulletHitPlayer, null, this);
    
    // Input - Solo teclado!
    this.cursors = this.input.keyboard.addKeys('W,A,S,D,R,SPACE,UP,DOWN,LEFT,RIGHT,J,K');
    // Quitamos el mouse completamente
    
    // IA tick timer
    this.lastAITick = 0;
    this.aiTickRate = 100; // 10 Hz
    
    // UI elements
    this.narrationElement = document.getElementById('narration');
    this.updateUI();
    
    // Aim indicator visual
    this.aimIndicator = this.add.line(0, 0, 0, 0, 20, 0, 0x0a84ff, 0.8);
    this.aimIndicator.setLineWidth(3);
    this.aimIndicator.setDepth(10); // Asegurar que se vea encima
    
    console.log('[ECHO] Arena PLATFORMER ready!');
    console.log('[ECHO] Gravity:', GRAVITY);
    console.log('[ECHO] Jump velocity:', JUMP_VELOCITY);
    console.log('[ECHO] Controls: WASD move, Arrows aim, J/K shoot!');
    this.showNarration("Aim with arrows, shoot with J/K!");
  }

  update(time, delta) {
    // Check ground state
    this.playerState.onGround = Math.abs(this.player.body.velocity.y) < 10;
    this.echoState.onGround = Math.abs(this.echo.body.velocity.y) < 10;
    
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
    
    // Face direction for Echo only (player facing is handled in movement)
    if (this.echo.body.velocity.x > 0) this.echoState.facing = 'right';
    if (this.echo.body.velocity.x < 0) this.echoState.facing = 'left';
    
    // Visual indicator for aim direction (optional)
    this.updateAimIndicator();
    
    // Limpiar balas fuera de pantalla
    this.playerBullets.children.entries.forEach(bullet => {
      if (bullet.x < 0 || bullet.x > GAME_WIDTH || bullet.y < 0 || bullet.y > GAME_HEIGHT) {
        console.log('[ECHO] Bullet destroyed (out of bounds)');
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
    let vx = 0;
    
    // Movimiento horizontal
    if (this.cursors.A.isDown) {
      vx = -PLAYER_SPEED;
      this.playerState.facing = 'left';
      this.playerState.aimX = -1;
      if (!this.cursors.UP.isDown && !this.cursors.DOWN.isDown) {
        this.playerState.aimY = 0; // Reset to horizontal when moving
      }
      PlayerPatterns.movement_rhythm.push({ time: Date.now(), dir: 'left' });
    }
    if (this.cursors.D.isDown) {
      vx = PLAYER_SPEED;
      this.playerState.facing = 'right';
      this.playerState.aimX = 1;
      if (!this.cursors.UP.isDown && !this.cursors.DOWN.isDown) {
        this.playerState.aimY = 0; // Reset to horizontal when moving
      }
      PlayerPatterns.movement_rhythm.push({ time: Date.now(), dir: 'right' });
    }
    
    // Apuntado estilo Contra con flechas
    if (this.cursors.UP.isDown) {
      this.playerState.aimY = -1;
      if (!this.cursors.A.isDown && !this.cursors.D.isDown) {
        this.playerState.aimX = 0; // Straight up
      }
      console.log('[ECHO] Aiming UP');
    } else if (this.cursors.DOWN.isDown && !this.playerState.onGround) {
      this.playerState.aimY = 1;
      if (!this.cursors.A.isDown && !this.cursors.D.isDown) {
        this.playerState.aimX = 0; // Straight down
      }
      console.log('[ECHO] Aiming DOWN');
    } else if (!this.cursors.A.isDown && !this.cursors.D.isDown) {
      // Not moving horizontally and not pressing up/down
      this.playerState.aimY = 0;
    }
    
    this.player.setVelocityX(vx);
    
    // Salto
    if ((this.cursors.W.isDown || this.cursors.SPACE.isDown) && this.playerState.onGround) {
      console.log('[ECHO] Player JUMP at position:', this.player.x, this.player.y);
      this.player.setVelocityY(JUMP_VELOCITY);
      PlayerPatterns.jump_spots.push({ x: this.player.x, y: this.player.y, time: Date.now() });
      PlayerPatterns.preferred_height.push(this.player.y);
    }
    
    // Disparar con J o K
    if ((Phaser.Input.Keyboard.JustDown(this.cursors.J) || Phaser.Input.Keyboard.JustDown(this.cursors.K)) && !this.playerState.shootCooldown) {
      this.playerShootKeyboard();
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
        console.log('[ECHO] Player reload complete. Ammo:', this.playerState.ammo);
        this.updateUI();
      }
    }
  }

  playerShootKeyboard() {
    if (this.playerState.ammo <= 0 || this.playerState.reloading) {
      console.log('[ECHO] Cannot shoot - Ammo:', this.playerState.ammo, 'Reloading:', this.playerState.reloading);
      return;
    }
    
    // Calcular ángulo basado en dirección de apuntado (estilo Contra)
    let angle;
    const { aimX, aimY } = this.playerState;
    
    if (aimX === 0 && aimY === -1) {
      angle = -Math.PI / 2; // Straight up
    } else if (aimX === 0 && aimY === 1) {
      angle = Math.PI / 2; // Straight down
    } else if (aimX === 1 && aimY === -1) {
      angle = -Math.PI / 4; // Up-right diagonal
    } else if (aimX === 1 && aimY === 1) {
      angle = Math.PI / 4; // Down-right diagonal
    } else if (aimX === -1 && aimY === -1) {
      angle = -3 * Math.PI / 4; // Up-left diagonal
    } else if (aimX === -1 && aimY === 1) {
      angle = 3 * Math.PI / 4; // Down-left diagonal
    } else if (aimX === -1 && aimY === 0) {
      angle = Math.PI; // Left
    } else {
      angle = 0; // Right (default)
    }
    
    console.log('[ECHO] Player shooting - Direction:', aimX, aimY, 'Angle:', angle);
    this.createBullet(this.player.x, this.player.y, angle, 'player');
    
    // Cooldown para evitar spam
    this.playerState.shootCooldown = true;
    setTimeout(() => {
      this.playerState.shootCooldown = false;
    }, 100);
    
    this.playerState.ammo--;
    this.playerState.lastShot = Date.now();
    PlayerPatterns.shot_timing.push(Date.now());
    
    // Auto-reload si se queda sin balas
    if (this.playerState.ammo === 0) {
      console.log('[ECHO] Auto-reload triggered (out of ammo)');
      this.startReload('player');
    }
    
    // Registrar patrón de recarga
    if (this.playerState.ammo <= 3) {
      PlayerPatterns.reload_at.push(this.playerState.ammo);
      console.log('[ECHO] Pattern detected - Player reloads at:', this.playerState.ammo, 'bullets');
    }
    
    this.updateUI();
  }

  startReload(who) {
    if (who === 'player') {
      this.playerState.reloading = true;
      this.playerState.reloadTimer = RELOAD_TIME;
      console.log('[ECHO] Player started reloading. Will take', RELOAD_TIME, 'ms');
    } else {
      this.echoState.reloading = true;
      console.log('[ECHO] Echo started reloading');
      setTimeout(() => {
        this.echoState.reloading = false;
        this.echoState.ammo = MAX_AMMO;
        console.log('[ECHO] Echo reload complete');
      }, RELOAD_TIME);
    }
  }

  createBullet(x, y, angle, owner) {
    console.log('[ECHO] Creating bullet - Owner:', owner, 'Position:', x, y, 'Angle:', angle);
    
    const bullet = this.add.circle(x, y, 4, owner === 'player' ? 0x0a84ff : 0xff453a);
    this.physics.add.existing(bullet);
    
    // Configurar física de la bala correctamente
    bullet.body.setGravityY(0); // Sin gravedad
    bullet.body.setDrag(0, 0); // Sin fricción
    bullet.body.setFriction(0, 0); // Sin fricción
    bullet.body.setBounce(0); // Sin rebote
    bullet.body.setAllowGravity(false); // Asegurar que no le afecte la gravedad
    
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;
    bullet.body.setVelocity(vx, vy);
    
    console.log('[ECHO] Bullet velocity set - VX:', vx, 'VY:', vy, 'Speed:', BULLET_SPEED);
    
    if (owner === 'player') {
      this.playerBullets.add(bullet);
    } else {
      this.echoBullets.add(bullet);
    }
  }

  createPlatforms() {
    console.log('[ECHO] Creating platforms...');
    
    // Suelo
    const ground = this.add.rectangle(400, 580, 800, 40, 0x2c2c2e);
    this.physics.add.existing(ground, true);
    this.platforms.add(ground);
    
    // Plataformas flotantes
    const platformData = [
      { x: 200, y: 450, w: 150, h: 20 },
      { x: 600, y: 450, w: 150, h: 20 },
      { x: 400, y: 350, w: 120, h: 20 },
      { x: 150, y: 250, w: 100, h: 20 },
      { x: 650, y: 250, w: 100, h: 20 },
      { x: 400, y: 150, w: 80, h: 20 }
    ];
    
    platformData.forEach(p => {
      const platform = this.add.rectangle(p.x, p.y, p.w, p.h, 0x3c3c3e);
      this.physics.add.existing(platform, true);
      this.platforms.add(platform);
      console.log('[ECHO] Platform created at:', p.x, p.y);
    });
  }

  bulletHitWall(bullet, wall) {
    console.log('[ECHO] Bullet hit wall/platform');
    bullet.destroy();
  }

  bulletHitPlayer(bullet, player) {
    bullet.destroy();
    this.playerState.hp -= 15;
    console.log('[ECHO] !!!!! PLAYER HIT !!!!! HP now:', this.playerState.hp);
    this.updateUI();
    
    if (this.playerState.hp <= 0) {
      console.log('[ECHO] GAME OVER - Player died');
      this.gameOver(false);
    }
  }

  bulletHitEcho(bullet, echo) {
    bullet.destroy();
    this.echoState.hp -= 15;
    console.log('[ECHO] !!!!! ECHO HIT !!!!! HP now:', this.echoState.hp);
    this.updateUI();
    
    if (this.echoState.hp <= 0) {
      console.log('[ECHO] GAME OVER - Echo defeated!');
      this.gameOver(true);
    }
  }

  async thinkAndAct(time) {
    if (this.echoState.thinking) return;
    this.echoState.thinking = true;
    
    console.log('[ECHO] ========== AI THINKING CYCLE START ==========');
    console.log('[ECHO] Time:', time);
    console.log('[ECHO] Echo state:', {
      position: { x: this.echo.x, y: this.echo.y },
      hp: this.echoState.hp,
      ammo: this.echoState.ammo,
      onGround: this.echoState.onGround,
      reloading: this.echoState.reloading
    });
    console.log('[ECHO] Player state:', {
      position: { x: this.player.x, y: this.player.y },
      hp: this.playerState.hp,
      ammo: this.playerState.ammo,
      reloading: this.playerState.reloading
    });
    
    // Construir estado del juego para la IA
    const gameState = this.buildGameStateXML();
    console.log('[ECHO] Game state XML built:');
    console.log(gameState);
    
    try {
      console.log('[ECHO] Calling AI endpoint /zero-api/echo/think...');
      const startTime = Date.now();
      
      // Llamar al endpoint de IA
      const response = await fetch('/zero-api/echo/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ xml: gameState })
      });
      
      const responseTime = Date.now() - startTime;
      console.log('[ECHO] AI Response received in', responseTime, 'ms');
      console.log('[ECHO] Response status:', response.status);
      
      if (!response.ok) {
        console.error('[ECHO] AI Response NOT OK:', response.status, response.statusText);
        throw new Error('IA response failed');
      }
      
      const data = await response.json();
      console.log('[ECHO] AI Response data:', data);
      console.log('[ECHO] AI Response XML:');
      console.log(data.xml);
      
      this.executeEchoActions(data.xml);
      
    } catch (error) {
      console.error('[ECHO] !!!! AI ERROR !!!!:', error);
      console.log('[ECHO] Falling back to basic AI');
      this.executeBasicAI();
    }
    
    console.log('[ECHO] ========== AI THINKING CYCLE END ==========');
    this.echoState.thinking = false;
  }

  buildGameStateXML() {
    const patterns = this.analyzePatterns();
    console.log('[ECHO] Analyzed patterns:', patterns);
    
    return `<game_state t="${Date.now()}" phase="combat">
  <player x="${Math.round(this.player.x)}" y="${Math.round(this.player.y)}" 
          vx="${Math.round(this.player.body.velocity.x)}" vy="${Math.round(this.player.body.velocity.y)}"
          hp="${this.playerState.hp}" ammo="${this.playerState.ammo}" 
          reloading="${this.playerState.reloading}" onGround="${this.playerState.onGround}" />
  <echo x="${Math.round(this.echo.x)}" y="${Math.round(this.echo.y)}" 
        vx="${Math.round(this.echo.body.velocity.x)}" vy="${Math.round(this.echo.body.velocity.y)}"
        hp="${this.echoState.hp}" ammo="${this.echoState.ammo}" 
        onGround="${this.echoState.onGround}" />
  <patterns>
    <pattern type="reload_threshold" value="${patterns.reloadAt}" confidence="${patterns.reloadConfidence}" />
    <pattern type="jump_frequency" value="${patterns.jumpFreq}" />
    <pattern type="preferred_height" value="${patterns.avgHeight}" />
  </patterns>
</game_state>`;
  }

  analyzePatterns() {
    // Analizar umbral de recarga
    const reloadAt = PlayerPatterns.reload_at.length > 0 
      ? Math.round(PlayerPatterns.reload_at.reduce((a,b) => a+b, 0) / PlayerPatterns.reload_at.length)
      : 3;
    
    // Frecuencia de saltos
    const recentJumps = PlayerPatterns.jump_spots.filter(j => Date.now() - j.time < 10000);
    const jumpFreq = recentJumps.length;
    
    // Altura preferida
    const avgHeight = PlayerPatterns.preferred_height.length > 0
      ? Math.round(PlayerPatterns.preferred_height.reduce((a,b) => a+b, 0) / PlayerPatterns.preferred_height.length)
      : 400;
    
    return {
      reloadAt,
      reloadConfidence: Math.min(PlayerPatterns.reload_at.length / 5, 1),
      jumpFreq,
      avgHeight
    };
  }

  executeEchoActions(xml) {
    console.log('[ECHO] Executing Echo actions from XML...');
    
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, 'text/xml');
      
      // Movimiento
      const movement = doc.querySelector('movement');
      if (movement) {
        const targetX = parseInt(movement.getAttribute('x'));
        const targetY = parseInt(movement.getAttribute('y'));
        console.log('[ECHO] Echo moving to:', targetX, targetY);
        
        // Movimiento horizontal
        const dx = targetX - this.echo.x;
        if (Math.abs(dx) > 10) {
          this.echo.setVelocityX(Math.sign(dx) * PLAYER_SPEED);
        }
        
        // Salto si es necesario
        const jump = movement.getAttribute('jump');
        if (jump === 'true' && this.echoState.onGround) {
          console.log('[ECHO] Echo JUMPING!');
          this.echo.setVelocityY(JUMP_VELOCITY);
        }
      }
      
      // Disparo
      const shoot = doc.querySelector('shoot');
      if (shoot && this.echoState.ammo > 0 && !this.echoState.reloading) {
        const atMs = parseInt(shoot.getAttribute('at_ms') || '0');
        console.log('[ECHO] Echo will shoot in', atMs, 'ms');
        
        setTimeout(() => {
          if (this.echoState.ammo > 0) {
            const angle = Phaser.Math.Angle.Between(this.echo.x, this.echo.y, this.player.x, this.player.y);
            console.log('[ECHO] Echo SHOOTING at angle:', angle);
            this.createBullet(this.echo.x, this.echo.y, angle, 'echo');
            this.echoState.ammo--;
            
            if (this.echoState.ammo === 0) {
              console.log('[ECHO] Echo out of ammo, auto-reloading');
              this.startReload('echo');
            }
          }
        }, atMs);
      }
      
      // Narración (sin audio)
      const narration = doc.querySelector('narration');
      if (narration) {
        const text = narration.textContent;
        console.log('[ECHO] NARRATION:', text);
        this.showNarration(text);
      }
      
    } catch (error) {
      console.error('[ECHO] Error parsing AI response:', error);
      this.executeBasicAI();
    }
  }

  executeBasicAI() {
    console.log('[ECHO] Executing BASIC AI fallback');
    
    const dx = this.player.x - this.echo.x;
    const dy = this.player.y - this.echo.y;
    const distance = Math.sqrt(dx*dx + dy*dy);
    
    console.log('[ECHO] Distance to player:', distance);
    console.log('[ECHO] Delta X:', dx, 'Delta Y:', dy);
    
    // Movimiento horizontal hacia el jugador
    if (Math.abs(dx) > 50) {
      this.echo.setVelocityX(Math.sign(dx) * PLAYER_SPEED * 0.8);
    }
    
    // Saltar si el jugador está arriba
    if (dy < -50 && this.echoState.onGround) {
      console.log('[ECHO] Basic AI: Jumping to reach player');
      this.echo.setVelocityY(JUMP_VELOCITY);
    }
    
    // Disparar si tiene munición
    if (this.echoState.ammo > 0 && !this.echoState.reloading && distance < 400 && Math.random() < 0.3) {
      const angle = Math.atan2(dy, dx);
      console.log('[ECHO] Basic AI: Shooting');
      this.createBullet(this.echo.x, this.echo.y, angle, 'echo');
      this.echoState.ammo--;
      
      if (this.echoState.ammo === 0) {
        this.startReload('echo');
      }
    }
  }

  showNarration(text) {
    console.log('[ECHO] SHOWING NARRATION:', text);
    this.narrationElement.textContent = text;
    this.narrationElement.classList.add('active');
    
    // NO AUDIO - Solo subtítulos
    // Quitamos speechSynthesis completamente
    
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

  updateAimIndicator() {
    // Show where player is aiming
    const { aimX, aimY } = this.playerState;
    const startX = this.player.x;
    const startY = this.player.y - 16;
    const endX = startX + (aimX * 40);
    const endY = startY + (aimY * 40);
    
    this.aimIndicator.setTo(startX, startY, endX, endY);
    
    // Color change when ready to shoot
    if (!this.playerState.shootCooldown && this.playerState.ammo > 0) {
      this.aimIndicator.setStrokeStyle(3, 0x0a84ff, 1);
    } else {
      this.aimIndicator.setStrokeStyle(2, 0x666666, 0.5);
    }
  }
  
  gameOver(playerWon) {
    console.log('[ECHO] !!!!! GAME OVER !!!!!');
    console.log('[ECHO] Player won:', playerWon);
    this.physics.pause();
    
    if (playerWon) {
      this.showNarration("Impressive... but I learn from defeat.");
      console.log('[ECHO] Player victory!');
    } else {
      this.showNarration("Too predictable. I knew every move.");
      console.log('[ECHO] Echo victory! Patterns learned:', PlayerPatterns);
    }
    
    setTimeout(() => {
      console.log('[ECHO] Restarting scene...');
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
      gravity: { y: 0 }, // Gravedad se aplica individualmente
      debug: false
    }
  },
  scene: [EchoArena],
  backgroundColor: '#0a0a0c'
};

console.log('[ECHO] ==========================================');
console.log('[ECHO] Iniciando ECHO CHAMBER PLATFORMER');
console.log('[ECHO] Config:', config);
console.log('[ECHO] ==========================================');
const game = new Phaser.Game(config);