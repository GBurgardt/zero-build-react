// Minimal backend to call OpenAI securely (no external deps)
// Reads OPENAI_API_KEY from .env or environment and exposes POST /chat

import http from 'node:http';
import https from 'node:https';
import { readFileSync, existsSync } from 'node:fs';
import { URL } from 'node:url';
import { MongoClient, ObjectId } from 'mongodb';

// Store active SSE connections for direct streaming
const activeStreams = new Map();
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
let blogArticlesCollection;
let pragmaticDocsCollection;

async function getDb() {
  if (!mongoClient) {
    mongoClient = new MongoClient(MONGO_URI, { maxPoolSize: 10, directConnection: true });
    await mongoClient.connect();
    const dbName = new URL(MONGO_URI).pathname.replace(/^\//, '') || 'zerodb';
    const db = mongoClient.db(dbName);
    ideasCollection = db.collection('ideas');
    try { await ideasCollection.createIndex({ createdAt: -1 }); } catch (_) {}
    // Useful index for server-side search
    try { await ideasCollection.createIndex({ text: 'text', result: 'text' }); } catch (_) {}
    blogArticlesCollection = db.collection('blog_articles');
    pragmaticDocsCollection = db.collection('pragmatic_docs');
    try { await blogArticlesCollection.createIndex({ createdAt: -1 }); } catch (_) {}
    try { await pragmaticDocsCollection.createIndex({ createdAt: -1 }); } catch (_) {}
    try { await pragmaticDocsCollection.createIndex({ title: 'text', contentMarkdown: 'text' }); } catch (_) {}
  }
  return { ideas: ideasCollection, blogArticles: blogArticlesCollection, pragmaticDocs: pragmaticDocsCollection };
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
    const url = new URL(req.url, `http://${req.headers.host}`);
    const q = String(url.searchParams.get('q') || '').trim();
    const page = Math.max(1, Math.min(1000, parseInt(url.searchParams.get('page') || '1', 10) || 1));
    const pageSizeRaw = parseInt(url.searchParams.get('pageSize') || '10', 10) || 10;
    const pageSize = Math.max(1, Math.min(50, pageSizeRaw));

    // Build filter: prefer $text if available, fallback to regex OR
    let filter = {};
    if (q) {
      filter = {
        $or: [
          { $text: { $search: q } },
          { text: { $regex: q, $options: 'i' } },
          { result: { $regex: q, $options: 'i' } },
        ]
      };
    }

    const totalCount = await ideas.countDocuments(filter);
    const skip = (page - 1) * pageSize;
    const cursor = ideas.find(filter, { projection: { text: 1, status: 1, model: 1, createdAt: 1 } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize);
    const list = await cursor.toArray();
    return json(res, 200, {
      items: list.map(i => ({ id: String(i._id), text: i.text, status: i.status, model: i.model, createdAt: i.createdAt })),
      page,
      pageSize,
      totalCount,
    });
  } catch (e) {
    return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
  }
}

// ===== New handlers: Article/Pragmatic generation and readers =====

// New direct streaming endpoint
async function handleGenerateArticleStream(req, res, ideaId) {
  try {
    const { ideas, blogArticles } = await getDb();
    const _id = new ObjectId(ideaId);
    const thought = await ideas.findOne({ _id });
    if (!thought) return json(res, 404, { error: 'idea_not_found' });
    
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const modelRaw = String(body.model || '').toLowerCase();
    const useClaude = modelRaw === 'claude' || modelRaw === 'claude-opus' || modelRaw.includes('claude');
    
    const originalInput = String(thought.text || '');
    const now = new Date();
    
    // Create article immediately with processing status
    const { insertedId } = await blogArticles.insertOne({
      sourceIdeaId: _id,
      title: 'Generando artículo...',
      content: '',
      language: body.language === 'en' ? 'en' : 'es',
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      raw: '',
      model: useClaude ? 'claude-opus' : 'gpt-5',
    });
    
    // Set up SSE for direct streaming
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    
    // Immediately flush headers to establish connection
    res.flushHeaders();
    
    // Send initial response with article ID
    res.write(`data: ${JSON.stringify({ 
      articleId: String(insertedId),
      status: 'starting'
    })}\n\n`);
    if (res.flush) res.flush();
    
    // Store connection for direct streaming
    const streamKey = String(insertedId);
    activeStreams.set(streamKey, res);
    
    // Clean up on disconnect
    req.on('close', () => {
      activeStreams.delete(streamKey);
      console.log(`[stream] Client disconnected from ${streamKey}`);
    });
    
    // Start generation with direct streaming
    const fullExplanation = String(thought.result || thought.superinfo_raw || '');
    const ideaContent = `INPUT ORIGINAL:\n\n${originalInput}\n\nEXPLICACIÓN COMPLETA:\n\n${fullExplanation}`;
    const invokerModule = useClaude
      ? await import('./server/agents/blog-article-agent-v2/invoker.mjs')
      : await import('./server/agents/blog-article-agent-v2/invoker-openai.mjs');
    const language = body.language === 'en' ? 'en' : 'es';
    const mode = 'german-burgart';
    const userDirection = String(body.userDirection || '').slice(0, 4000);
    
    let accumulatedContent = '';
    let chunkCount = 0;
    let lastDbUpdate = Date.now();
    
    // Stream callback that sends directly to client
    const streamCallback = async (chunk) => {
      accumulatedContent += chunk;
      chunkCount++;
      
      // Send chunk directly to client via SSE
      if (activeStreams.has(streamKey)) {
        res.write(`data: ${JSON.stringify({ 
          chunk: chunk,
          status: 'streaming'
        })}\n\n`);
        if (res.flush) res.flush();
      }
      
      // Update DB periodically (non-blocking)
      const now = Date.now();
      if (chunkCount % 10 === 0 || (now - lastDbUpdate) > 1000) {
        lastDbUpdate = now;
        // Don't await - let it happen in background
        blogArticles.updateOne(
          { _id: insertedId },
          { 
            $set: { 
              content: accumulatedContent,
              updatedAt: new Date()
            } 
          }
        ).catch(e => console.error('[stream] DB update error:', e));
      }
    };
    
    const { article, fullResponse } = await invokerModule.invokeBlogAgent(
      { ideaContent, ideaId, language, mode, userDirection },
      streamCallback
    );
    
    const content = String(article || '');
    const titleMatch = (content.match(/^#\s+(.+)$/m) || [])[1];
    const title = titleMatch || (originalInput || '').substring(0, 100) || 'Artículo';
    
    // Final update
    await blogArticles.updateOne(
      { _id: insertedId },
      { 
        $set: { 
          title,
          content: accumulatedContent,
          status: 'completed',
          raw: fullResponse,
          updatedAt: new Date()
        } 
      }
    );
    
    // Send completion
    if (activeStreams.has(streamKey)) {
      res.write(`data: ${JSON.stringify({ 
        done: true,
        title,
        status: 'completed'
      })}\n\n`);
      if (res.flush) res.flush();
      res.end();
      activeStreams.delete(streamKey);
    }
    
  } catch (e) {
    console.error('[generate-article-stream] ERROR', e);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: String(e?.message || e) })}\n\n`);
      res.end();
    } else {
      return json(res, 500, { error: 'generation_failed', detail: String(e?.message || e) });
    }
  }
}

async function handleGenerateArticle(req, res, ideaId) {
  try {
    const { ideas, blogArticles } = await getDb();
    const _id = new ObjectId(ideaId);
    const thought = await ideas.findOne({ _id });
    if (!thought) return json(res, 404, { error: 'idea_not_found' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const modelRaw = String(body.model || '').toLowerCase();
    const useClaude = modelRaw === 'claude' || modelRaw === 'claude-opus' || modelRaw.includes('claude');
    
    const originalInput = String(thought.text || '');
    const now = new Date();
    
    // Create article immediately with processing status
    const { insertedId } = await blogArticles.insertOne({
      sourceIdeaId: _id,
      title: 'Generando artículo...',
      content: '',
      language: body.language === 'en' ? 'en' : 'es',
      status: 'processing',
      createdAt: now,
      updatedAt: now,
      raw: '',
      model: useClaude ? 'claude-opus' : 'gpt-5',
    });
    
    // Immediately return article ID for redirect
    json(res, 200, { 
      success: true, 
      articleId: String(insertedId), 
      redirectUrl: `/zero/article/${String(insertedId)}` 
    });
    
    // Start generation in background
    (async () => {
      try {
        const fullExplanation = String(thought.result || thought.superinfo_raw || '');
        const ideaContent = `INPUT ORIGINAL:\n\n${originalInput}\n\nEXPLICACIÓN COMPLETA:\n\n${fullExplanation}`;
        const invokerModule = useClaude
          ? await import('./server/agents/blog-article-agent-v2/invoker.mjs')
          : await import('./server/agents/blog-article-agent-v2/invoker-openai.mjs');
        const language = body.language === 'en' ? 'en' : 'es';
        const mode = 'german-burgart';  // Always use German Burgardt mode
        const userDirection = String(body.userDirection || '').slice(0, 4000);
        
        // Stream callback to update DB as content is generated
        let accumulatedContent = '';
        let chunkCount = 0;
        let lastUpdateTime = Date.now();
        
        const streamCallback = async (chunk) => {
          accumulatedContent += chunk;
          chunkCount++;
          
          // Log streaming progress
          if (chunkCount % 10 === 0) {
            console.log(`[streaming] Chunk ${chunkCount}, Total chars: ${accumulatedContent.length}`);
          }
          
          // Update DB more frequently - every 5 chunks or every 500ms
          const now = Date.now();
          if (chunkCount % 5 === 0 || (now - lastUpdateTime) > 500) {
            console.log(`[streaming] Updating DB - chunk ${chunkCount}, ${accumulatedContent.length} chars`);
            await blogArticles.updateOne(
              { _id: insertedId },
              { 
                $set: { 
                  content: accumulatedContent,  // Store raw content with tags
                  updatedAt: new Date()
                } 
              }
            );
            lastUpdateTime = now;
          }
        };
        
        const { article, fullResponse } = await invokerModule.invokeBlogAgent(
          { ideaContent, ideaId, language, mode, userDirection },
          streamCallback
        );
        
        const content = String(article || '');
        const titleMatch = (content.match(/^#\s+(.+)$/m) || [])[1];
        const title = titleMatch || (originalInput || '').substring(0, 100) || 'Artículo';
        
        // Final update with complete content
        await blogArticles.updateOne(
          { _id: insertedId },
          { 
            $set: { 
              title,
              content,
              status: 'completed',
              raw: fullResponse,
              updatedAt: new Date()
            } 
          }
        );
      } catch (e) {
        console.error('[generate-article] Background generation error:', e);
        // Update article status to error
        await blogArticles.updateOne(
          { _id: insertedId },
          { 
            $set: { 
              status: 'error',
              error: String(e?.message || e),
              updatedAt: new Date()
            } 
          }
        );
      }
    })();
  } catch (e) {
    console.error('[generate-article] ERROR', e);
    return json(res, 500, { error: 'generation_failed', detail: String(e?.message || e) });
  }
}

async function handleGeneratePragmatic(req, res, ideaId) {
  try {
    const { ideas, pragmaticDocs } = await getDb();
    const _id = new ObjectId(ideaId);
    const thought = await ideas.findOne({ _id });
    if (!thought) return json(res, 404, { error: 'idea_not_found' });
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const modelRaw = String(body.model || '').toLowerCase();
    const useClaude = modelRaw === 'claude' || modelRaw === 'claude-opus' || modelRaw.includes('claude');
    const ideaContent = String(thought.result || thought.superinfo_raw || thought.text || '');
    const direction = String(body.direction || '').slice(0, 4000);
    const pragmaticConfig = (await import('./server/agents/pragmatic-doc-agent/config-openai.mjs')).default;
    const sp = pragmaticConfig.getSystemPrompt();
    const m = sp.match(/<<<<[\s\S]*>>>>/);
    const oneShot = m ? m[0].replace(/^<<<<\n?|\n?>>>>$/g, '').trim() : '';
    const invoker = useClaude
      ? (await import('./server/agents/pragmatic-doc-agent/invoker.mjs')).invokePragmaticDocClaude
      : (await import('./server/agents/pragmatic-doc-agent/invoker-openai.mjs')).invokePragmaticDocOpenAI;
    const resp = await invoker({ ideaContent, direction, oneShot });
    const now = new Date();
    let jsonObj = null;
    if (resp.json) { try { jsonObj = JSON.parse(resp.json); } catch { jsonObj = resp.json; } }
    const h1 = (resp.document || '').match(/^#\s+(.+)$/m);
    const title = h1?.[1]?.trim() || (thought.text || '').substring(0, 80) || 'Documento pragmático';
    const { insertedId } = await pragmaticDocs.insertOne({
      sourceIdeaId: _id,
      title,
      contentMarkdown: resp.document || resp.fullResponse || '',
      contentJson: jsonObj,
      isPublished: false,
      tags: [],
      status: 'draft',
      createdAt: now,
      updatedAt: now,
      raw: resp.fullResponse,
      model: useClaude ? 'claude-opus' : 'gpt-5',
    });
    return json(res, 200, { success: true, docId: String(insertedId), redirectUrl: `/pragmatic/${String(insertedId)}` });
  } catch (e) {
    console.error('[generate-pragmatic] ERROR', e);
    return json(res, 500, { error: 'generation_failed', detail: String(e?.message || e) });
  }
}

async function handleGetArticle(req, res, articleId) {
  try {
    const { blogArticles } = await getDb();
    const _id = new ObjectId(articleId);
    const doc = await blogArticles.findOne({ _id });
    if (!doc) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { 
      _id: String(doc._id), 
      title: doc.title, 
      content: doc.content, 
      status: doc.status, 
      model: doc.model, 
      createdAt: doc.createdAt, 
      updatedAt: doc.updatedAt 
    });
  } catch (e) {
    return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
  }
}

async function handleArticleStream(req, res, articleId) {
  try {
    const { blogArticles } = await getDb();
    const _id = new ObjectId(articleId);
    
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no', // Disable nginx buffering for SSE
    });
    
    // Immediately flush headers to establish connection
    res.flushHeaders();
    
    // Send keep-alive comment to confirm connection
    res.write(':ok\n\n');
    
    // Send initial article state
    const article = await blogArticles.findOne({ _id });
    if (!article) {
      console.log(`[article-stream] Article not found: ${articleId}`);
      res.write(`data: ${JSON.stringify({ error: 'not_found' })}\n\n`);
      res.end();
      return;
    }
    
    console.log(`[article-stream] Initial state - status: ${article.status}, content length: ${article.content?.length || 0}`);
    res.write(`data: ${JSON.stringify({ 
      title: article.title,
      content: article.content || '',
      status: article.status 
    })}\n\n`);
    if (res.flush) res.flush(); // Force flush if available
    
    // If article is processing, poll for updates
    if (article.status === 'processing') {
      let lastContent = article.content || '';
      let pollCount = 0;
      console.log(`[article-stream] Starting polling for article ${articleId}`);
      
      const pollInterval = setInterval(async () => {
        try {
          pollCount++;
          const updated = await blogArticles.findOne({ _id });
          if (!updated) {
            console.log(`[article-stream] Article not found, stopping poll`);
            clearInterval(pollInterval);
            res.end();
            return;
          }
          
          // Log polling status every 10 polls
          if (pollCount % 10 === 0) {
            console.log(`[article-stream] Poll ${pollCount}, content length: ${updated.content?.length || 0}`);
          }
          
          // Send only new content
          if (updated.content !== lastContent) {
            const newContent = updated.content.substring(lastContent.length);
            console.log(`[article-stream] Sending chunk of ${newContent.length} chars`);
            res.write(`data: ${JSON.stringify({ 
              chunk: newContent,
              status: updated.status 
            })}\n\n`);
            if (res.flush) res.flush(); // Force flush if available
            lastContent = updated.content;
          }
          
          // Stop polling when done
          if (updated.status !== 'processing') {
            res.write(`data: ${JSON.stringify({ 
              done: true,
              title: updated.title,
              status: updated.status 
            })}\n\n`);
            if (res.flush) res.flush(); // Force flush if available
            clearInterval(pollInterval);
            res.end();
          }
        } catch (e) {
          console.error('[article-stream] Poll error:', e);
          clearInterval(pollInterval);
          res.end();
        }
      }, 200); // Poll every 200ms for more responsive updates
      
      // Clean up on disconnect
      req.on('close', () => {
        clearInterval(pollInterval);
      });
    } else {
      // Article is complete, end stream
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    }
  } catch (e) {
    console.error('[article-stream] ERROR', e);
    res.write(`data: ${JSON.stringify({ error: 'stream_error', detail: String(e?.message || e) })}\n\n`);
    res.end();
  }
}

async function handleGetPragmatic(req, res, docId) {
  try {
    const { pragmaticDocs } = await getDb();
    const _id = new ObjectId(docId);
    const doc = await pragmaticDocs.findOne({ _id });
    if (!doc) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { _id: String(doc._id), title: doc.title, contentMarkdown: doc.contentMarkdown, contentJson: doc.contentJson, status: doc.status, model: doc.model, createdAt: doc.createdAt, updatedAt: doc.updatedAt });
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
    console.log('🎯 TEST LOG: Este es un mensaje de prueba para verificar que logs.sh funciona correctamente!');
    console.log('📊 Métricas:', { memory: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB', uptime: process.uptime() + 's' });
    return json(res, 200, { ok: true, t: Date.now(), path: url.pathname, params });
  }
  if (req.method === 'POST' && url.pathname === '/chat') return handleChat(req, res);
  // Duelista AI action endpoint (Cerebras Qwen with graceful fallback)
  if (req.method === 'POST' && (url.pathname === '/duelista/act' || url.pathname === '/zero-api/duelista/act')) {
    return handleDuelistaAct(req, res);
  }
  if (req.method === 'POST' && url.pathname === '/zero-api/chat') return handleChat(req, res);
  // Support both direct and nginx-rewritten paths
  if (req.method === 'POST' && (url.pathname === '/zero-api/ideas' || url.pathname === '/ideas')) return handleCreateIdea(req, res);
  if (req.method === 'GET' && (url.pathname === '/zero-api/ideas' || url.pathname === '/ideas')) return handleListIdeas(req, res);
  let ideaMatch = url.pathname.match(/^\/zero-api\/ideas\/(\w{24})$/);
  if (!ideaMatch) ideaMatch = url.pathname.match(/^\/ideas\/(\w{24})$/);
  if (req.method === 'GET' && ideaMatch) return handleIdeaStatus(req, res, ideaMatch[1]);
  // Generation endpoints
  const genArticle = url.pathname.match(/^\/(?:zero-api\/)?ideas\/(\w{24})\/generate-article$/);
  if (req.method === 'POST' && genArticle) return handleGenerateArticle(req, res, genArticle[1]);
  const genArticleStream = url.pathname.match(/^\/(?:zero-api\/)?ideas\/(\w{24})\/generate-article-stream$/);
  if (req.method === 'POST' && genArticleStream) return handleGenerateArticleStream(req, res, genArticleStream[1]);
  const genPrag = url.pathname.match(/^\/(?:zero-api\/)?ideas\/(\w{24})\/generate-pragmatic$/);
  if (req.method === 'POST' && genPrag) return handleGeneratePragmatic(req, res, genPrag[1]);

  // Readers
  const artGet = url.pathname.match(/^\/(?:zero-api\/)?article\/(\w{24})$/);
  if (req.method === 'GET' && artGet) return handleGetArticle(req, res, artGet[1]);
  const artStream = url.pathname.match(/^\/(?:zero-api\/)?article\/(\w{24})\/stream$/);
  if (req.method === 'GET' && artStream) return handleArticleStream(req, res, artStream[1]);
  const pragGet = url.pathname.match(/^\/(?:zero-api\/)?pragmatic\/(\w{24})$/);
  if (req.method === 'GET' && pragGet) return handleGetPragmatic(req, res, pragGet[1]);
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

// ================= Duelista AI Proxy =================
async function handleDuelistaAct(req, res) {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyStr = Buffer.concat(chunks).toString('utf8');
    // The client may send XML or JSON. Accept both for simplicity.
    let payload = null;
    try { payload = JSON.parse(bodyStr || '{}'); } catch { payload = { xml: bodyStr }; }

    const model = 'qwen-3-coder-480b';
    const apiKey = process.env.CEREBRAS_API_KEY;

    // If no key present, return a simple heuristic XML so the demo works offline
    if (!apiKey) {
      const heuristic = duelistaHeuristicActions(payload);
      return json(res, 200, heuristic);
    }

    // Try dynamic import so the server doesn't crash if the SDK is not installed
    let Cerebras = null;
    try {
      ({ default: Cerebras } = await import('@cerebras/cerebras_cloud_sdk'));
    } catch (e) {
      console.warn('[duelista] Cerebras SDK not installed, using heuristic fallback:', e?.message || e);
      const heuristic = duelistaHeuristicActions(payload);
      return json(res, 200, heuristic);
    }

    const cerebras = new Cerebras({ apiKey });
    const system = buildDuelistaSystemPrompt();
    const user = buildDuelistaUserPrompt(payload);

    try {
      const resp = await cerebras.chat.completions.create({
        model,
        stream: false,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.4,
        top_p: 0.9,
        max_completion_tokens: 512,
      });
      const text = resp?.choices?.[0]?.message?.content || '';
      const xml = extractXml(text) || text;
      return json(res, 200, { xml, source: 'cerebras' });
    } catch (e) {
      // Graceful 429 / errors
      console.warn('[duelista] Cerebras error, using heuristic fallback:', e?.message || e);
      const heuristic = duelistaHeuristicActions(payload);
      return json(res, 200, heuristic);
    }
  } catch (e) {
    return json(res, 500, { error: 'server_error', detail: String(e?.message || e) });
  }
}

function buildDuelistaSystemPrompt() {
  return `You are the tactical controller of a 1v1 2D duel (side view). Respond ONLY with compact XML that respects the contract. Keep horizon short (<= 600ms) and prioritize safety and fairness. Avoid impossible actions.

<contract>
  <action name="microStep" dxMin="-1.0" dxMax="1.0" dyMin="-0.5" dyMax="0.5" durMsMin="40" durMsMax="180"/>
  <action name="parry" dir="high|mid|low" whenMsMin="40" whenMsMax="180"/>
  <action name="strike" kind="light|heavy" whenMsMin="80" whenMsMax="240"/>
</contract>

Return format:
<actions t="TS">
  <npc id="boss">
    <microStep dx="..." dy="..." durMs="..."/>
    <parry dir="mid" whenMs="..."/>
    <strike kind="light" whenMs="..."/>
    <why>short reason</why>
  </npc>
</actions>`;
}

function buildDuelistaUserPrompt(payload) {
  // Accept either {xml} or structured JSON { t, player, boss, events }
  if (payload && payload.xml) return String(payload.xml).slice(0, 5000);
  const t = payload?.t || Date.now();
  const p = payload?.player || {};
  const b = payload?.boss || {};
  const ev = Array.isArray(payload?.events) ? payload.events : [];
  const xml = [
    `<tick t="${t}">`,
    `  <player x="${num(p.x)}" y="${num(p.y)}" vx="${num(p.vx)}" facing="${p.facing||'right'}" stamina="${num(p.stamina,0)}" lastAction="${p.lastAction||''}" lastTs="${p.lastTs||0}"/>`,
    `  <npc id="boss" x="${num(b.x)}" y="${num(b.y)}" vx="${num(b.vx)}" facing="${b.facing||'left'}" stamina="${num(b.stamina,0)}" state="${b.state||'neutral'}"/>`,
    `  <events>`,
    ...ev.map(e => `    <event kind="${e.kind}" actor="${e.actor}" detail="${e.detail||''}" t="${e.t||t}"/>`),
    `  </events>`,
    `  <request actionsFor="boss" horizonMs="600" budget="2"/>`,
    `</tick>`
  ].join('\n');
  return xml;
}

function num(v, def = 0) { return Number.isFinite(v) ? Number(v).toFixed(1) : def; }

function extractXml(text) {
  if (!text) return '';
  const m = text.match(/<actions[\s\S]*?<\/actions>/i);
  return m ? m[0] : '';
}

function duelistaHeuristicActions(payload) {
  // Simple, fast, token-free: maintain preferred distance and parry heavy windups
  try {
    const t = payload?.t || Date.now();
    const p = payload?.player || {};
    const b = payload?.boss || {};
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const dx = (p.x ?? 0) - (b.x ?? 0);
    const absdx = Math.abs(dx);
    const prefer = 120; // preferred spacing in pixels
    let step = 0;
    if (absdx < prefer - 10) step = dx > 0 ? -0.6 : 0.6; // back off if too close
    else if (absdx > prefer + 20) step = dx > 0 ? 0.6 : -0.6; // approach if too far
    const micro = `<microStep dx="${step.toFixed(1)}" dy="0.0" durMs="120"/>`;
    const wind = events.find(e => e.kind === 'windup' && e.actor === 'player');
    const parry = wind ? `<parry dir="mid" whenMs="120"/>` : '';
    const strike = (!wind && absdx < 110) ? `<strike kind="light" whenMs="160"/>` : '';
    const why = wind ? 'Backstep y parry tardío del heavy.' : (absdx > prefer ? 'Cerrar distancia con micro pasos.' : 'Mantener spacing y amenazar light.');
    const xml = [
      `<actions t="${t}">`,
      `  <npc id="boss">`,
      `    ${micro}`,
      parry ? `    ${parry}` : '',
      strike ? `    ${strike}` : '',
      `    <why>${why}</why>`,
      `  </npc>`,
      `</actions>`
    ].filter(Boolean).join('\n');
    return { xml, source: 'heuristic' };
  } catch (e) {
    return { xml: `<actions t="${Date.now()}"><npc id="boss"><microStep dx="0.0" dy="0.0" durMs="80"/><why>fallback</why></npc></actions>`, source: 'heuristic' };
  }
}
