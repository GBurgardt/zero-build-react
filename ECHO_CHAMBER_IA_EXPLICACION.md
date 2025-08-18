# Echo Chamber - Flujo de IA Explicado

## 📊 Resumen del Sistema

Echo Chamber usa un sistema de IA táctica que NO usa Cerebras/Qwen realmente. En su lugar, utiliza una **heurística inteligente local** que simula comportamiento de IA mediante análisis del estado del juego.

## 🎮 Flujo de Datos (Frontend → Backend → Frontend)

### 1. **Frontend Envía Estado del Juego** (cada 100ms)

El juego construye un XML con el estado actual y lo envía a `/zero-api/echo/think`:

```xml
<game_state t="1755484081067" phase="combat">
  <player x="100" y="400" 
          vx="0" vy="0"
          hp="100" ammo="12" 
          reloading="false" onGround="true" />
  <echo x="700" y="400" 
        vx="0" vy="0"
        hp="100" ammo="12" 
        onGround="true" />
  <patterns>
    <pattern type="reload_threshold" value="3" confidence="0" />
    <pattern type="jump_frequency" value="0" />
    <pattern type="preferred_height" value="400" />
  </patterns>
</game_state>
```

**Datos que envía:**
- `player`: Posición (x,y), velocidad (vx,vy), HP, munición, estado de recarga, si está en el suelo
- `echo`: Los mismos datos pero para la IA
- `patterns`: Patrones de comportamiento del jugador detectados (cuándo recarga, frecuencia de saltos, altura preferida)

### 2. **Backend Procesa con Heurística** (`server.mjs`)

La función `handleEchoThink` recibe el XML y lo pasa a `generateEchoResponse`:

```javascript
// NO usa LLM real, usa heurística local
function generateEchoResponse(payload) {
  // 1. Parsea el XML para extraer datos
  const playerData = { x, y, vx, vy, hp, ammo, reloading, onGround };
  const echoData = { x, y, vx, vy, hp, ammo, onGround };
  
  // 2. Calcula distancias y toma decisiones tácticas
  const dx = playerData.x - echoData.x;
  const dy = playerData.y - echoData.y;
  const distance = Math.sqrt(dx*dx + dy*dy);
  
  // 3. Decisiones basadas en reglas:
  if (playerData.reloading) {
    // "El jugador está recargando, ¡atacar!"
    narration = "Reloading? Time to rush!";
    moveX = playerData.x; // Ir hacia el jugador
    shouldShoot = true;
  }
  else if (!playerData.onGround && playerData.vy > 0) {
    // "El jugador está cayendo, predecir dónde aterrizará"
    narration = "I know where you'll land";
    moveX = playerData.x + playerData.vx * 0.5;
    shouldShoot = true;
  }
  // ... más reglas tácticas
}
```

### 3. **Backend Responde con Acciones XML**

El servidor devuelve un XML con las acciones que debe tomar la IA:

```xml
<echo_actions t="1755484081305">
  <movement x="650" y="400" jump="false" speed="normal" reason="tactical"/>
  <aim_at x="100" y="400" lead_time="50"/>
  <shoot at_ms="100" confidence="high"/>
  <narration timing="immediate" tone="neutral">Getting closer...</narration>
  <next_plan horizon_ms="1000">maintain_distance</next_plan>
  <internal_state confidence="0.75" aggression="0.6" tilt="0.1"/>
</echo_actions>
```

**Acciones que puede responder:**
- `movement`: Hacia dónde moverse (x,y) y si debe saltar
- `aim_at`: A dónde apuntar (normalmente hacia el jugador)
- `shoot`: Si debe disparar y cuándo (en milisegundos)
- `narration`: Texto psicológico para mostrar (sin audio)
- `next_plan`: Plan estratégico (rush, climb, maintain_distance)
- `internal_state`: Estado interno de la IA (confianza, agresión)

### 4. **Frontend Ejecuta las Acciones**

La función `executeEchoActions` en `echo-chamber.js` parsea el XML y ejecuta:

```javascript
// Movimiento
if (movement) {
  const targetX = parseInt(movement.getAttribute('x'));
  const dx = targetX - this.echo.x;
  if (Math.abs(dx) > 10) {
    this.echo.setVelocityX(Math.sign(dx) * PLAYER_SPEED);
  }
  
  // Salto si es necesario
  if (jump === 'true' && this.echoState.onGround) {
    this.echo.setVelocityY(JUMP_VELOCITY);
  }
}

// Disparo
if (shoot && this.echoState.ammo > 0) {
  const atMs = parseInt(shoot.getAttribute('at_ms'));
  setTimeout(() => {
    this.createBullet(this.echo.x, this.echo.y, angle, 'echo');
  }, atMs);
}

// Narración (solo texto, sin audio)
if (narration) {
  this.showNarration(narration.textContent);
}
```

## 🧠 Reglas de Decisión de la IA

La IA toma decisiones basándose en estas reglas prioritarias:

1. **Si el jugador está recargando** → Rushear agresivamente
2. **Si el jugador está en el aire** → Predecir dónde aterrizará
3. **Si el jugador tiene poca munición** → Mantener presión
4. **Si el jugador está arriba** → Saltar para alcanzarlo
5. **Si está muy lejos** → Acercarse a distancia óptima (250px)
6. **Si está muy cerca** → Alejarse y disparar
7. **Por defecto** → Mantener distancia y disparar si puede

## 🎯 NO USA LLM REAL

**IMPORTANTE**: El juego NO usa Cerebras ni Qwen realmente. Todo es heurística local:

- **No hay API Key de Cerebras configurada**
- **No hay SDK de Cerebras instalado**
- **El servidor usa `generateEchoResponse` que es pura lógica if/else**
- **Las narraciones son strings hardcodeados, no generados por IA**

## 🐛 Problema Actual: Balas Chocan con el Suelo

En los logs se ve que las balas chocan inmediatamente con el suelo:

```
[ECHO] Creating bullet - Owner: echo Position: 625 424 Angle: 2.99
[ECHO] Bullet hit wall/platform
```

**Posible causa**: Las balas se crean en la posición del personaje (y=424) que está muy cerca del suelo (y=420), y al tener algo de velocidad hacia abajo, chocan inmediatamente.

**Solución sugerida**: Crear las balas un poco más arriba del personaje para que tengan espacio para viajar.

## 📝 Resumen Pragmático

1. **Input al "LLM"**: XML con estado del juego (posiciones, velocidades, HP, munición)
2. **Procesamiento**: Heurística local con if/else basada en distancias y estados
3. **Output del "LLM"**: XML con acciones (moverse, saltar, disparar, narración)
4. **No hay LLM real**: Todo es simulado con reglas predefinidas
5. **Frecuencia**: 10Hz (cada 100ms se actualiza la IA)