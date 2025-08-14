// Minimal backend to call OpenAI securely (no external deps)
// Reads OPENAI_API_KEY from .env or environment and exposes POST /chat

import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { URL } from 'node:url';

function loadDotEnvIfPresent(envPath = '.env') {
  try {
    if (!existsSync(envPath)) return;
    const file = readFileSync(envPath, 'utf8');
    for (const rawLine of file.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch (err) {
    console.error('Failed to load .env:', err);
  }
}

loadDotEnvIfPresent('.env');

const PORT = Number(process.env.PORT || 3004);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Set OPENAI_MODEL=gpt-5 if available

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY. Add it to .env or environment.');
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function notFound(res) {
  json(res, 404, { error: 'not_found' });
}

async function handleChat(req, res) {
  if (!OPENAI_API_KEY) {
    return json(res, 500, { error: 'server_missing_api_key' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const bodyString = Buffer.concat(chunks).toString('utf8');
    const body = bodyString ? JSON.parse(bodyString) : {};

    const messages = Array.isArray(body.messages) && body.messages.length > 0
      ? body.messages
      : [{ role: 'user', content: body.prompt || 'Decime hola desde una app zero-build.' }];

    const model = body.model || DEFAULT_MODEL;

    async function callOpenAI(selectedModel) {
      return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      }),
      });
    }

    let response = await callOpenAI(model);
    if (!response.ok) {
      const errText = await response.text();
      // Fallback si el modelo pedido no existe en la cuenta
      const shouldFallback = model !== DEFAULT_MODEL && /model|not\s*found|unknown_model/i.test(errText);
      if (shouldFallback) {
        response = await callOpenAI(DEFAULT_MODEL);
      }
      if (!response.ok) {
        return json(res, response.status, { error: 'openai_error', detail: errText });
      }
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    return json(res, 200, { model: model || DEFAULT_MODEL, text });
  } catch (error) {
    return json(res, 500, { error: 'server_error', detail: String(error?.message || error) });
  }
}

const server = http.createServer(async (req, res) => {
  // Basic CORS support
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === 'POST' && url.pathname === '/chat') return handleChat(req, res);
  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`[zero-api] listening on http://127.0.0.1:${PORT}`);
});
