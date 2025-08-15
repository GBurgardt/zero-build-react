// API functions
import { POLL_DELAY, MAX_POLL_ATTEMPTS } from './constants.js';
import { slugify } from './utils.js';

export async function fetchIdeas() {
  try {
    const r = await fetch("/zero-api/ideas");
    if (!r.ok) return null;
    const data = await r.json();
    return Array.isArray(data.items) ? data.items : [];
  } catch (error) {
    return null;
  }
}

export async function createIdea(text) {
  const r = await fetch("/zero-api/ideas", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const data = await r.json();
  if (!r.ok || data.error) {
    throw new Error(data.detail || data.error || "Error creando idea");
  }
  return data;
}

export async function fetchIdeaDetail(id) {
  // Try enriched endpoint first
  try {
    const rFull = await fetch(`/zero-api/ideas/${id}/full`);
    const data = await rFull.json();
    if (rFull.ok) {
      const toc = Array.isArray(data.toc) ? data.toc : [];
      const sectionMap = {};
      if (Array.isArray(data.sections)) {
        for (const s of data.sections) {
          if (s?.id) sectionMap[s.id] = s.content || '';
        }
      }
      const raw = data.resume_raw || data.result || '';
      const m1 = raw.match(/^#\s+(.+)$/m);
      const mainTitle = m1 ? m1[1].trim() : 'Idea';
      
      return {
        status: data.status || "",
        result: data.resume_raw || data.result || "",
        toc,
        sectionMap,
        mainTitle
      };
    }
  } catch (error) {
    // Silent fallback to simple endpoint
  }

  // Fallback to simple endpoint
  const r = await fetch(`/zero-api/ideas/${id}`);
  const data = await r.json();
  if (!r.ok) {
    throw new Error(data.detail || data.error || "Error obteniendo idea");
  }
  
  const result = data.result || "";
  const titles = [...result.matchAll(/^## (.+)$/gm)].map(m => m[1]);
  const toc = titles.map(t => ({ id: slugify(t), title: t }));
  
  const lines = result.split('\n');
  const sectionMap = {};
  for (let i = 0; i < toc.length; i++) {
    const title = toc[i].title;
    const idSlug = toc[i].id;
    const start = lines.findIndex(l => l.startsWith(`## ${title}`));
    if (start !== -1) {
      let buf = '';
      for (let j = start + 1; j < lines.length; j++) {
        if (lines[j].startsWith('## ')) break;
        buf += lines[j] + '\n';
      }
      sectionMap[idSlug] = buf;
    }
  }
  
  const m1 = result.match(/^#\s+(.+)$/m);
  const mainTitle = m1 ? m1[1].trim() : 'Idea';
  
  return {
    status: data.status || "",
    result,
    toc,
    sectionMap,
    mainTitle
  };
}

export async function pollStatus(id, onUpdate) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((resolve) => setTimeout(resolve, POLL_DELAY));
    
    try {
      const response = await fetch(`/zero-api/ideas/${id}`);
      if (!response.ok) continue;
      
      const data = await response.json();
      if (data.status && data.status !== "processing") {
        onUpdate({ id, status: data.status, result: data.result });
        return;
      }
    } catch (error) {
      // Continue polling on error
    }
  }
}