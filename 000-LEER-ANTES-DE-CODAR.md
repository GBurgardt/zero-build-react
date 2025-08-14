# LEER ANTES DE CODAR — MODO PRODUCCIÓN EN VIVO

Este repositorio usa una metodología de desarrollo con deploy directo a producción. Es simple y poderosa, pero requiere disciplina.

## Principios clave
- **Desarrollo en producción**: cada feature/ajuste que merges aquí, se despliega en `getreels.app/zero` inmediatamente después de ejecutar el script `./deploy.sh`.
- **Un único flujo**: no hay builds locales ni pipelines complejos. La UI es zero‑build (ESM) y el backend es Node sin bundlers. Por eso, el estado del repo ≈ estado de producción.
- **Cambios pequeños, reversibles**: priorizá iteraciones chicas, atómicas y con rollback fácil. Si algo sale mal, hacé un fix inmediato y ejecutá `./deploy.sh` de nuevo.

## Reglas operativas
1. **Antes de tocar código**
   - Leé este archivo completo.
   - Pensá el cambio para que pueda salir en **una iteración pequeña**.
   - Si implica riesgos, agregá un `guard` en código para poder desactivar rápido (flags simples, checks, try/catch con fallback a comportamiento anterior).

2. **Al terminar una edición**
   - Commiteá con un mensaje claro y orientado a propósito (qué problema resuelve y por qué). Evitá ruido.
   - Ejecutá siempre:
     ```bash
     ./deploy.sh
     ```
   - Verificá en producción: `https://getreels.app/zero` y, si aplica, la ruta profunda (`/zero/idea/:id` o `/zero/idea/:id/:section`).

3. **Si algo falla en producción**
   - Tené a mano los logs remotos:
     ```bash
     ./logs.sh all
     ```
   - Si el fix es obvio, aplicalo y volvés a desplegar.
   - Si no, revertí al commit anterior o desactivá la nueva ruta/feature con el guard que preparaste.

## Convenciones de UI/UX (Zero‑Build)
- La UI se sirve desde `public/` directamente, sin build. Usamos ESM (`import(...)`) y estilo propio.
- Las vistas deben ser **legibles y cómodas**: tipografía clara, bloques Markdown con citas (`blockquote`), listas y código formateado.
- La ruta de detalle (`/zero/idea/:id/:section?`) muestra un **sidebar** con los subtítulos `##` y el contenido de cada sección a la derecha.

## Convenciones de Backend
- API minimal en `server.mjs` expuesta como `/zero-api/*` detrás de Nginx.
- Si agregás endpoints, mantené la compatibilidad hacia atrás. Evitá romper consumidores existentes.

## Seguridad práctica
- Nunca commitees secretos. `./deploy.sh` sube `.env` si existe localmente.
- Sanitizá todo lo que se renderice como HTML (ya hay DOMPurify en la UI).

## Checklist de salida (cada feature)
- [ ] Cambios pequeños y revisados localmente (si aplica).
- [ ] Mensaje de commit claro (por qué) y sin secretos.
- [ ] Ejecutado `./deploy.sh` sin errores.
- [ ] Validado en producción. Si hay rutas nuevas, probalas manualmente.
- [ ] Si hubo migraciones o flags, documentalos aquí o en el PR/commit.

## TL;DR
- Editás.
- Commiteás.
- `./deploy.sh`.
- Verificás en `getreels.app/zero`.
- Si falla, corregís y deployás de nuevo.

Gracias por mantener el ciclo corto y la calidad alta. ¡Producción es nuestra verdad! 
