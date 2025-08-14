// Minimal backend to call OpenAI securely (no external deps)
// Reads OPENAI_API_KEY from .env or environment and exposes POST /chat

import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { URL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';

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
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/zerodb';

let mongoClient;
let ideasCollection;

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 10 });
    await mongoClient.connect();
    const dbName = new URL(MONGO_URI).pathname.replace(/^\//, '') || 'zerodb';
    const db = mongoClient.db(dbName);
    ideasCollection = db.collection('ideas');
    await ideasCollection.createIndex({ createdAt: -1 });
  }
  return { ideas: ideasCollection };
}

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
      if (typeof fetch === 'function') {
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
      // Fallback for very old Node without fetch
      const payload = JSON.stringify({
        model: selectedModel,
        messages,
        temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      });
      const options = {
        method: 'POST',
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Length': Buffer.byteLength(payload),
        },
      };
      return new Promise((resolve) => {
        const req = https.request(options, (resp) => {
          let data = '';
          resp.on('data', (chunk) => (data += chunk));
          resp.on('end', () => {
            resolve({
              ok: resp.statusCode >= 200 && resp.statusCode < 300,
              status: resp.statusCode,
              async text() { return data; },
              async json() { return JSON.parse(data || '{}'); },
            });
          });
        });
        req.on('error', (err) => {
          resolve({
            ok: false,
            status: 500,
            async text() { return String(err?.message || err); },
            async json() { return { error: 'network_error', detail: String(err?.message || err) }; },
          });
        });
        req.write(payload);
        req.end();
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

async function handleCreateIdea(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const text = String(body.text || '').trim();
    if (!text) return json(res, 400, { error: 'text_required' });

    const { ideas } = await getDb();
    const idea = {
      text,
      status: 'processing',
      result: null,
      model: body.model || DEFAULT_MODEL,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const { insertedId } = await ideas.insertOne(idea);
    processIdea(insertedId).catch(err => console.error('processIdea error', err));
    return json(res, 200, { id: String(insertedId), status: 'processing' });
  } catch (err) {
    return json(res, 500, { error: 'server_error', detail: String(err?.message || err) });
  }
}

async function processIdea(id) {
  const { ideas } = await getDb();
  const _id = new ObjectId(id);
  const doc = await ideas.findOne({ _id });
  if (!doc) return;
  try {
    const messages = [
      { role: 'system', content: 'Eres un analista que resume en 5 bullets claros.' },
      { role: 'user', content: doc.text },
    ];
    const response = await callOpenAIChat(doc.model || DEFAULT_MODEL, messages, 0.4);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content ?? '';
    await ideas.updateOne({ _id }, { $set: { status: 'done', result: text, updatedAt: new Date() } });
  } catch (e) {
    await ideas.updateOne({ _id }, { $set: { status: 'error', error: String(e?.message || e), updatedAt: new Date() } });
  }
}

async function handleIdeaStatus(req, res, id) {
  try {
    const { ideas } = await getDb();
    const doc = await ideas.findOne({ _id: new ObjectId(id) });
    if (!doc) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { id, status: doc.status, result: doc.result, updatedAt: doc.updatedAt });
  } catch (e) {
    return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
  }
}

async function handleListIdeas(req, res) {
  try {
    const { ideas } = await getDb();
    const list = await ideas.find({}, { projection: { text: 1, status: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(50).toArray();
    return json(res, 200, { items: list.map(i => ({ id: String(i._id), text: i.text, status: i.status, createdAt: i.createdAt })) });
  } catch (e) {
    return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
  }
}

async function callOpenAIChat(model, messages, temperature = 0.7) {
  if (typeof fetch === 'function') {
    return fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      body: JSON.stringify({ model, messages, temperature }),
    });
  }
  const payload = JSON.stringify({ model, messages, temperature });
  const options = { method: 'POST', hostname: 'api.openai.com', path: '/v1/chat/completions', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Length': Buffer.byteLength(payload) } };
  return new Promise((resolve) => {
    const req2 = https.request(options, (resp) => {
      let data = '';
      resp.on('data', (ch) => (data += ch));
      resp.on('end', () => resolve({ ok: resp.statusCode >= 200 && resp.statusCode < 300, status: resp.statusCode, async text() { return data; }, async json() { return JSON.parse(data || '{}'); } }));
    });
    req2.on('error', (err) => resolve({ ok: false, status: 500, async text() { return String(err?.message || err); }, async json() { return { error: 'network_error', detail: String(err?.message || err) }; } }));
    req2.write(payload); req2.end();
  });
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
  if (req.method === 'POST' && url.pathname === '/zero-api/ideas') return handleCreateIdea(req, res);
  if (req.method === 'GET' && url.pathname === '/zero-api/ideas') return handleListIdeas(req, res);
  const ideaMatch = url.pathname.match(/^\/zero-api\/ideas\/(\w{24})$/);
  if (req.method === 'GET' && ideaMatch) return handleIdeaStatus(req, res, ideaMatch[1]);
  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`[zero-api] listening on http://127.0.0.1:${PORT}`);
});
