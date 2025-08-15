// Minimal backend to call OpenAI securely (no external deps)
// Reads OPENAI_API_KEY from .env or environment and exposes POST /chat

import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { URL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt as superInfoSystem, userPrompt as superInfoUser } from './server/prompts/superinformation.prompt.mjs';
import { systemPrompt as bukSystem, userPrompt as bukUser } from './server/prompts/bukowsky.prompt.mjs';

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
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'; // Set OPENAI_MODEL=gpt-5 if available
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/zerodb';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';

console.log('[startup] Server initialization:');
console.log('[startup] PORT:', PORT);
console.log('[startup] OPENAI_API_KEY present:', !!OPENAI_API_KEY);
console.log('[startup] ANTHROPIC_API_KEY present:', !!ANTHROPIC_API_KEY);
console.log('[startup] ANTHROPIC_API_KEY length:', ANTHROPIC_API_KEY?.length || 0);
console.log('[startup] DEFAULT_MODEL:', DEFAULT_MODEL);
console.log('[startup] OPENAI_MODEL:', OPENAI_MODEL);

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

console.log('[startup] OpenAI client initialized:', !!openai);
console.log('[startup] Anthropic client initialized:', !!anthropic);

let mongoClient;
let ideasCollection;

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 10, directConnection: true });
    await mongoClient.connect();
    const dbName = new URL(MONGO_URI).pathname.replace(/^\//, '') || 'zerodb';
    const db = mongoClient.db(dbName);
    ideasCollection = db.collection('ideas');
    try { await ideasCollection.createIndex({ createdAt: -1 }); } catch (_) {}
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
    
    // Elegir procesador según modelo
    const model = body.model || 'gpt-5';
    console.log('[handleCreateIdea] Selected model:', model);
    console.log('[handleCreateIdea] Starting async processing for id:', String(insertedId));
    
    if (model === 'claude-opus') {
      console.log('[handleCreateIdea] Routing to processWithClaude...');
      processWithClaude(insertedId).catch(err => {
        console.error('[handleCreateIdea] processWithClaude error:', err);
        console.error('[handleCreateIdea] Error details:', JSON.stringify(err, null, 2));
      });
    } else {
      console.log('[handleCreateIdea] Routing to processIdea (GPT-5)...');
      processIdea(insertedId).catch(err => {
        console.error('[handleCreateIdea] processIdea error:', err);
        console.error('[handleCreateIdea] Error details:', JSON.stringify(err, null, 2));
      });
    }
    
    return json(res, 200, { id: String(insertedId), status: 'processing' });
  } catch (err) {
    return json(res, 500, { error: 'server_error', detail: String(err?.message || err) });
  }
}

async function processWithClaude(id) {
  const { ideas } = await getDb();
  const _id = new ObjectId(id);
  const doc = await ideas.findOne({ _id });
  
  console.log('[claude] Starting processWithClaude for id:', id);
  console.log('[claude] Document found:', !!doc);
  console.log('[claude] Anthropic client initialized:', !!anthropic);
  console.log('[claude] ANTHROPIC_API_KEY present:', !!ANTHROPIC_API_KEY);
  
  if (!doc) {
    console.error('[claude] ERROR: Document not found for id:', id);
    return;
  }
  
  if (!anthropic) {
    console.error('[claude] ERROR: Anthropic client not initialized');
    console.error('[claude] API Key present:', !!ANTHROPIC_API_KEY);
    await ideas.updateOne({ _id }, { $set: { status: 'error', error: 'Claude not configured', updatedAt: new Date() } });
    return;
  }
  
  try {
    console.log('[claude] Processing with Claude Opus 4.1...');
    console.log('[claude] Input text length:', doc.text?.length || 0);
    
    // Paso 1: Super Information con Claude
    const superInfoMessages = [{
      role: 'user',
      content: superInfoUser.replace('{input}', doc.text)
    }];
    
    console.log('[claude] Creating super info request...');
    console.log('[claude] System prompt length:', superInfoSystem?.length || 0);
    console.log('[claude] User message:', superInfoMessages[0]?.content?.substring(0, 100) + '...');
    
    const superInfoResponse = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805', // Claude Opus 4.1
      max_tokens: 32000, // Máximo soportado por Claude Opus 4.1
      temperature: 0.7,
      system: superInfoSystem,
      messages: superInfoMessages
    });
    
    console.log('[claude] Super info response received');
    console.log('[claude] Response type:', typeof superInfoResponse);
    console.log('[claude] Response content array length:', superInfoResponse.content?.length || 0);
    
    const superText = superInfoResponse.content[0]?.text || '';
    const superinfo = (superText.match(/<superinfo>([\s\S]*?)<\/superinfo>/i)?.[1] || superText).trim();
    await ideas.updateOne({ _id }, { $set: { superinfo_raw: superinfo, updatedAt: new Date() } });
    
    // Paso 2: Bukowsky con Claude
    const bukMessages = [{
      role: 'user',
      content: `${bukUser}\nInput: ${superinfo}`
    }];
    
    console.log('[claude] Creating Bukowski request...');
    console.log('[claude] Bukowski system prompt length:', bukSystem?.length || 0);
    console.log('[claude] Bukowski input length:', superinfo?.length || 0);
    
    const bukResponse = await anthropic.messages.create({
      model: 'claude-opus-4-1-20250805', // Claude Opus 4.1
      max_tokens: 32000, // Máximo soportado por Claude Opus 4.1
      temperature: 0.7,
      system: bukSystem,
      messages: bukMessages
    });
    
    console.log('[claude] Bukowski response received');
    console.log('[claude] Response content array length:', bukResponse.content?.length || 0);
    
    const bukText = bukResponse.content[0]?.text || '';
    const resume = (bukText.match(/<resume>([\s\S]*?)<\/resume>/i)?.[1] || bukText).trim();
    
    const { toc, sections } = deriveSectionsFromResume(resume);
    await ideas.updateOne({ _id }, { $set: { status: 'done', result: resume, toc, sections, updatedAt: new Date() } });
    
    console.log('[claude] Processing completed successfully');
    console.log('[claude] Final result length:', resume?.length || 0);
  } catch (e) {
    console.error('[claude] ERROR in processWithClaude:', e);
    console.error('[claude] Error name:', e?.name);
    console.error('[claude] Error message:', e?.message);
    console.error('[claude] Error stack:', e?.stack);
    
    // Check for specific Anthropic API errors
    if (e?.status) {
      console.error('[claude] API Status Code:', e.status);
    }
    if (e?.error?.type) {
      console.error('[claude] API Error Type:', e.error.type);
    }
    if (e?.error?.message) {
      console.error('[claude] API Error Message:', e.error.message);
    }
    
    await ideas.updateOne({ _id }, { $set: { status: 'error', error: String(e?.message || e), updatedAt: new Date() } });
  }
}

async function processIdea(id) {
  const { ideas } = await getDb();
  const _id = new ObjectId(id);
  const doc = await ideas.findOne({ _id });
  if (!doc) return;
  try {
    // Paso 1: Super Information con GPT-5
    const superInput = [
      { role: 'system', content: [{ type: 'input_text', text: superInfoSystem }] },
      { role: 'user', content: [{ type: 'input_text', text: superInfoUser.replace('{input}', doc.text) }] },
    ];
    // @ts-ignore
    const superResp = await openai.responses.create({
      model: OPENAI_MODEL,
      input: superInput,
      text: { format: { type: 'text' }, verbosity: 'medium' },
      reasoning: { effort: 'high', summary: 'auto' },
      tools: [],
      store: true,
      max_output_tokens: 128000, // Máximo soportado por GPT-5
    });
    const superText = superResp.output_text || (superResp.output?.[0]?.content?.[0]?.text) || '';
    const superinfo = (superText.match(/<superinfo>([\s\S]*?)<\/superinfo>/i)?.[1] || superText).trim();
    await ideas.updateOne({ _id }, { $set: { superinfo_raw: superinfo, updatedAt: new Date() } });

    // Paso 2: Bukowsky con GPT-5
    const bukInput = [
      { role: 'system', content: [{ type: 'input_text', text: bukSystem }] },
      { role: 'user', content: [{ type: 'input_text', text: `${bukUser}\nInput: ${superinfo}` }] },
    ];
    // @ts-ignore
    const bukResp = await openai.responses.create({
      model: OPENAI_MODEL,
      input: bukInput,
      text: { format: { type: 'text' }, verbosity: 'medium' },
      reasoning: { effort: 'high', summary: 'auto' },
      tools: [],
      store: true,
      max_output_tokens: 128000, // Máximo soportado por GPT-5
    });
    const bukText = bukResp.output_text || (bukResp.output?.[0]?.content?.[0]?.text) || '';
    const resume = (bukText.match(/<resume>([\s\S]*?)<\/resume>/i)?.[1] || bukText).trim();

    const { toc, sections } = deriveSectionsFromResume(resume);
    await ideas.updateOne({ _id }, { $set: { status: 'done', result: resume, toc, sections, updatedAt: new Date() } });
  } catch (e) {
    await ideas.updateOne({ _id }, { $set: { status: 'error', error: String(e?.message || e), updatedAt: new Date() } });
  }
}

function deriveSectionsFromResume(resumeText) {
  const lines = resumeText.split(/\r?\n/);
  const sections = [];
  const toc = [];
  let current = { id: 'intro', title: 'Introducción', content: '' };
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)/);
    const h2 = line.match(/^##\s+(.*)/);
    if (h1) {
      if (current.content.trim()) { sections.push({ ...current }); }
      const title = h1[1].trim();
      const id = slugify(title);
      current = { id, title, content: '' };
      toc.push({ id, title });
      continue;
    }
    if (h2) {
      if (current.content.trim()) { sections.push({ ...current }); }
      const title = h2[1].trim();
      const id = slugify(title);
      current = { id, title, content: '' };
      toc.push({ id, title });
      continue;
    }
    current.content += line + '\n';
  }
  if (current.content.trim()) sections.push(current);
  if (!toc.length) toc.push({ id: 'contenido', title: 'Contenido' });
  return { toc, sections };
}

function slugify(str) {
  return (str || 'seccion')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

async function handleIdeaStatus(req, res, id) {
  try {
    const { ideas } = await getDb();
    const doc = await ideas.findOne({ _id: new ObjectId(id) });
    if (!doc) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { id, status: doc.status, result: doc.result, model: doc.model, updatedAt: doc.updatedAt });
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
  if (req.method === 'GET' && (url.pathname === '/zero-api/ping' || url.pathname === '/ping')) {
    const params = Object.fromEntries(url.searchParams.entries());
    const ua = String(req.headers['user-agent'] || '').slice(0, 120);
    console.log('[zero-api] PING', { t: new Date().toISOString(), path: url.pathname, ...params, ua });
    return json(res, 200, { ok: true, t: Date.now(), path: url.pathname, params });
  }
  if (req.method === 'POST' && url.pathname === '/chat') return handleChat(req, res);
  // Support both direct and nginx-rewritten paths
  if (req.method === 'POST' && (url.pathname === '/zero-api/ideas' || url.pathname === '/ideas')) return handleCreateIdea(req, res);
  if (req.method === 'GET' && (url.pathname === '/zero-api/ideas' || url.pathname === '/ideas')) return handleListIdeas(req, res);
  let ideaMatch = url.pathname.match(/^\/zero-api\/ideas\/(\w{24})$/);
  if (!ideaMatch) ideaMatch = url.pathname.match(/^\/ideas\/(\w{24})$/);
  if (req.method === 'GET' && ideaMatch) return handleIdeaStatus(req, res, ideaMatch[1]);
  // Full payload for detail view
  const ideaFull = url.pathname.match(/^\/(?:zero-api\/)?ideas\/(\w{24})\/full$/);
  if (req.method === 'GET' && ideaFull) {
    console.log('[zero-api] GET /ideas/:id/full', ideaFull[1]);
    try {
      const { ideas } = await getDb();
      const doc = await ideas.findOne({ _id: new ObjectId(ideaFull[1]) });
      if (!doc) return json(res, 404, { error: 'not_found' });
      return json(res, 200, {
        id: String(doc._id),
        status: doc.status,
        text: doc.text,
        model: doc.model, // Incluir el modelo usado
        superinfo_raw: doc.superinfo_raw,
        resume_raw: doc.result,
        toc: doc.toc || [],
        sections: doc.sections || [],
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      });
    } catch (e) {
      console.error('[zero-api] ERROR /ideas/:id/full', String(e?.message || e));
      return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
    }
  }
  return notFound(res);
});

server.listen(PORT, () => {
  console.log(`[zero-api] listening on http://127.0.0.1:${PORT}`);
  console.log('[zero-api] LOG-READY: para ver estos logs usa ./logs.sh api');
});
