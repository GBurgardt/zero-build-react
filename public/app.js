// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // Constants
  const IDEA_ID_REGEX = /^\/zero\/idea\/([0-9a-fA-F]{24})(?:\/([^\/]+))?$/;
  const ARTICLE_ID_REGEX = /^\/zero\/article\/([0-9a-fA-F]{24})$/;
  const POLL_INTERVAL = 3000;
  const MAX_INPUT_LENGTH = 999999; // Prácticamente infinito
  const SECTION_SLUG_MAX_LENGTH = 64;
  
  // State - Main input
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-5");
  const [docType, setDocType] = useState("article"); // 'article' | 'pragmatic'
  const [userDirection, setUserDirection] = useState("");

  // State - Ideas list
  const [ideas, setIdeas] = useState([]);

  // State - Routing
  const [route, setRoute] = useState({ mode: "home", ideaId: null, articleId: null, section: null });

  const evaluateRoute = React.useCallback(() => {
    const ideaMatch = window.location.pathname.match(IDEA_ID_REGEX);
    const articleMatch = window.location.pathname.match(ARTICLE_ID_REGEX);
    
    if (articleMatch) {
      setRoute({ 
        mode: "article", 
        ideaId: null,
        articleId: articleMatch[1],
        section: null 
      });
    } else if (ideaMatch) {
      setRoute({ 
        mode: "detail", 
        ideaId: ideaMatch[1], 
        articleId: null,
        section: ideaMatch[2] ? decodeURIComponent(ideaMatch[2]) : null 
      });
    } else {
      setRoute({ mode: "home", ideaId: null, articleId: null, section: null });
    }
  }, []);

  useEffect(() => {
    evaluateRoute();
    const onPop = () => evaluateRoute();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // State - UI
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);
  
  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyPress = (e) => {
      // CMD+B o CTRL+B para toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarCollapsed(!sidebarCollapsed);
      }
    };
    
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [sidebarCollapsed]);
  
  // State - Detail view
  const [detail, setDetail] = useState({ loading: false, status: "", result: "", model: "" });
  const [toc, setToc] = useState([]);
  const [sectionMap, setSectionMap] = useState({});
  const [mainTitle, setMainTitle] = useState("Idea");
  
  // State - External libraries
  const [mdLib, setMdLib] = useState(null);
  const [purifyLib, setPurifyLib] = useState(null);
  
  // State - Article view
  const [article, setArticle] = useState({ 
    loading: false, 
    title: "", 
    content: "", 
    status: "", 
    model: "",
    error: null 
  });
  const [showMonologue, setShowMonologue] = useState(false);

  function slugify(str) {
    return (str || 'seccion')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, SECTION_SLUG_MAX_LENGTH);
  }

  const loadDetail = async (id) => {
    try {
      setDetail((d) => ({ ...d, loading: true }));
      // Intentar endpoint enriquecido primero
      let data;
      let ok = false;
      try {
        const rFull = await fetch(`/zero-api/ideas/${id}/full`);
        data = await rFull.json();
        ok = rFull.ok;
        if (ok) {
          setDetail({ loading: false, status: data.status || "", result: data.resume_raw || data.result || "", model: data.model || "" });
          const nextToc = Array.isArray(data.toc) ? data.toc : [];
          setToc(nextToc);
          const nextMap = {};
          if (Array.isArray(data.sections)) {
            for (const s of data.sections) {
              if (s?.id) nextMap[s.id] = s.content || '';
            }
          }
          setSectionMap(nextMap);
          // Título principal desde markdown
          const raw = data.resume_raw || data.result || '';
          const m1 = raw.match(/^#\s+(.+)$/m);
          setMainTitle(m1 ? m1[1].trim() : 'Idea');
          if (data.status === "processing") pollStatus(id);
          return;
        }
      } catch (error) {
        // Silent fallback to simple endpoint
      }

      // Fallback to simple endpoint
      const r = await fetch(`/zero-api/ideas/${id}`);
      data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "Error obteniendo idea");
      setDetail({ loading: false, status: data.status || "", result: data.result || "", model: data.model || "" });
      if (data.result) {
        const titles = [...data.result.matchAll(/^## (.+)$/gm)].map(m => m[1]);
        const nextToc = titles.map(t => ({ id: slugify(t), title: t }));
        setToc(nextToc);
        // Construir mapa id->contenido
        const lines = data.result.split('\n');
        const nextMap = {};
        for (let i = 0; i < nextToc.length; i++) {
          const title = nextToc[i].title;
          const idSlug = nextToc[i].id;
          const start = lines.findIndex(l => l.startsWith(`## ${title}`));
          if (start !== -1) {
            let buf = '';
            for (let j = start + 1; j < lines.length; j++) {
              if (lines[j].startsWith('## ')) break;
              buf += lines[j] + '\n';
            }
            nextMap[idSlug] = buf;
          }
        }
        setSectionMap(nextMap);
        const m1 = data.result.match(/^#\s+(.+)$/m);
        setMainTitle(m1 ? m1[1].trim() : 'Idea');
      }
      if (data.status === "processing") pollStatus(id);
    } catch (e) {
      setDetail({ loading: false, status: "error", result: String(e?.message || e), model: "" });
      setToc([]);
      setSectionMap({});
      setMainTitle('Idea');
    }
  };

  const loadArticle = async (articleId) => {
    try {
      setArticle(prev => ({ ...prev, loading: true, error: null }));
      
      // Fetch initial article data
      const resp = await fetch(`/zero-api/article/${articleId}`);
      const data = await resp.json();
      
      if (!resp.ok) {
        throw new Error(data.error || 'Error loading article');
      }
      
      setArticle({
        loading: false,
        title: data.title || 'Artículo',
        content: data.content || '',
        status: data.status || '',
        model: data.model || '',
        error: null
      });
      
      // If article is still processing, connect to stream
      if (data.status === 'processing') {
        console.log('[Article] Connecting to stream for article:', articleId);
        const eventSource = new EventSource(`/zero-api/article/${articleId}/stream`);
        
        eventSource.onmessage = (event) => {
          try {
            const streamData = JSON.parse(event.data);
            console.log('[Article] Stream data received:', streamData);
            
            if (streamData.chunk) {
              console.log('[Article] Appending chunk of', streamData.chunk.length, 'chars');
              // Append raw content with tags
              setArticle(prev => ({
                ...prev,
                content: prev.content + streamData.chunk
              }));
            }
            
            if (streamData.title && streamData.title !== 'Generando artículo...') {
              setArticle(prev => ({
                ...prev,
                title: streamData.title
              }));
            }
            
            if (streamData.done) {
              eventSource.close();
              setArticle(prev => ({
                ...prev,
                status: streamData.status || 'completed'
              }));
              
              // Extract title from content if available
              const titleMatch = streamData.content?.match(/^#\s+(.+)$/m);
              if (titleMatch) {
                setArticle(prev => ({
                  ...prev,
                  title: titleMatch[1]
                }));
              }
            }
            
            if (streamData.error) {
              eventSource.close();
              setArticle(prev => ({
                ...prev,
                error: streamData.error,
                status: 'error'
              }));
            }
          } catch(e) {
            console.error('Error parsing stream data:', e);
          }
        };
        
        eventSource.onopen = () => {
          console.log('[Article] EventSource connection opened');
        };
        
        eventSource.onerror = (err) => {
          console.error('[Article] EventSource error:', err);
          eventSource.close();
          setArticle(prev => ({
            ...prev,
            status: 'error',
            error: 'Connection lost'
          }));
        };
        
        // Cleanup on unmount
        return () => {
          eventSource.close();
        };
      }
    } catch (e) {
      setArticle({
        loading: false,
        title: 'Error',
        content: '',
        status: 'error',
        model: '',
        error: String(e?.message || e)
      });
    }
  };

  useEffect(() => {
    if (route.mode === "detail" && route.ideaId) {
      loadDetail(route.ideaId);
    } else if (route.mode === "article" && route.articleId) {
      loadArticle(route.articleId);
    }
  }, [route.mode, route.ideaId, route.articleId]);

  // Contenido actual según sección
  const currentContent = React.useMemo(() => {
    if (!detail.result) return "";
    if (!route.section) return detail.result;
    // Buscar por id de sección en el mapa
    if (sectionMap[route.section]) {
      const currentItem = toc.find(t => t.id === route.section);
      // Only add header if it's the first section (where main title is shown)
      const isFirstSection = toc.length > 0 && toc[0].id === route.section;
      const header = (currentItem && isFirstSection) ? `## ${currentItem.title}\n\n` : '';
      return header + sectionMap[route.section];
    }
    return "Sección no encontrada";
  }, [detail.result, route.section, sectionMap, toc]);

  // Auto-select first section if none selected
  useEffect(() => {
    if (route.mode === 'detail' && route.ideaId && !route.section && toc.length > 0) {
      const firstSection = toc[0];
      const newPath = `/zero/idea/${route.ideaId}/${encodeURIComponent(firstSection.id)}`;
      window.history.replaceState(null, '', newPath);
      setRoute({ mode: 'detail', ideaId: route.ideaId, section: firstSection.id });
    }
  }, [route.mode, route.ideaId, route.section, toc]);

  // Load Markdown libraries
  useEffect(() => {
    const loadMarkdownLibs = async () => {
      try {
        const [markedModule, purifyModule] = await Promise.all([
          import('https://esm.sh/marked@13'),
          import('https://esm.sh/dompurify@3')
        ]);
        
        // Extract marked
        const marked = markedModule.marked || markedModule.default || markedModule;
        
        // Extract and initialize DOMPurify
        let DOMPurify = purifyModule.default || purifyModule;
        if (typeof DOMPurify === 'function') {
          DOMPurify = DOMPurify(window);
        }
        
        // Configure marked
        if (marked?.setOptions) {
          marked.setOptions({ 
            breaks: true, 
            gfm: true,
            mangle: false, 
            headerIds: false 
          });
        }
        
        // Save libraries
        if (marked) setMdLib(() => marked);
        if (DOMPurify?.sanitize) setPurifyLib(() => DOMPurify);
      } catch (err) {
        // Markdown libraries failed to load
      }
    };
    loadMarkdownLibs();
  }, []);

  // Persist model selection
  useEffect(() => {
    try {
      const stored = localStorage.getItem('zero:selectedModel');
      if (stored) setSelectedModel(stored);
      const dt = localStorage.getItem('zero:docType');
      if (dt) setDocType(dt);
    } catch (_) {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('zero:selectedModel', selectedModel); } catch (_) {}
  }, [selectedModel]);
  useEffect(() => {
    try { localStorage.setItem('zero:docType', docType); } catch (_) {}
  }, [docType]);

  const htmlContent = React.useMemo(() => {
    if (!mdLib || !purifyLib || !currentContent) return null;
    
    try {
      const safeContent = typeof currentContent === 'string' ? currentContent : String(currentContent || '');
      if (!safeContent || safeContent.trim() === '') return '';
      
      let html = '';
      
      // Intentar usar marked.parse si está disponible
      if (mdLib.parse && typeof mdLib.parse === 'function') {
        html = mdLib.parse(safeContent);
      } 
      // Fallback a marked como función
      else if (typeof mdLib === 'function') {
        html = mdLib(safeContent);
      }
      // Si no hay método de parseo disponible, usar texto plano
      else {
        return `<pre>${safeContent.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</pre>`;
      }
      
      // Sanitizar el HTML si es posible
      if (purifyLib && typeof purifyLib.sanitize === 'function') {
        return purifyLib.sanitize(html);
      }
      
      return html;
    } catch (err) {
      // Fallback to plain text on error
      const safeContent = String(currentContent || '');
      const escaped = safeContent.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
      return `<pre>${escaped}</pre>`;
    }
  }, [mdLib, purifyLib, currentContent]);

  // Home list state (search + pagination)
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const pageSize = 10;

  const loadIdeas = async (opts = {}) => {
    const q = opts.q ?? query;
    const p = opts.page ?? page;
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
      if (q && q.trim()) params.set('q', q.trim());
      const r = await fetch(`/zero-api/ideas?${params.toString()}`);
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.items)) setIdeas(data.items);
      if (typeof data.totalCount === 'number') setTotalCount(data.totalCount);
      if (typeof data.page === 'number') setPage(data.page);
    } catch (error) {
      // Silent fail on ideas load
    }
  };

  useEffect(() => { loadIdeas({ page: 1 }); }, []);

  // Debounced search
  useEffect(() => {
    const h = setTimeout(() => { loadIdeas({ q: query, page: 1 }); }, 350);
    return () => clearTimeout(h);
  }, [query]);

  const upsertIdea = (draft) => {
    setIdeas((prev) => {
      const exists = prev.find((i) => i.id === draft.id);
      if (exists) {
        return prev.map((i) => (i.id === draft.id ? { ...exists, ...draft } : i));
      }
      return [draft, ...prev];
    });
  };

  const pollStatus = async (id, attempts = 40) => {
    const POLL_DELAY = 1500;
    
    for (let i = 0; i < attempts; i++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_DELAY));
      
      try {
        const response = await fetch(`/zero-api/ideas/${id}`);
        if (!response.ok) continue;
        
        const data = await response.json();
        if (data.status && data.status !== "processing") {
          upsertIdea({ id, status: data.status, result: data.result });
          return;
        }
      } catch (error) {
        // Continue polling on error
      }
    }
  };

  const onSubmit = React.useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setErrorMsg("");
    try {
      const r = await fetch("/zero-api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, model: selectedModel })
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.detail || data.error || "Error creando idea");
      const draft = { id: data.id, text, status: data.status || "processing", createdAt: new Date().toISOString() };
      upsertIdea(draft);
      setInput("");
      pollStatus(data.id);
    } catch (e) {
      setErrorMsg(e.message);
    } finally {
      setSending(false);
    }
  }, [input, sending, selectedModel]);

  const [generatingArticle, setGeneratingArticle] = useState(false);
  
  const generateFromIdea = React.useCallback(async (id) => {
    if (!id) return;
    setGeneratingArticle(true);
    
    const body = docType === 'article'
      ? { model: selectedModel, language: 'es', mode: 'pete-komon', userDirection }
      : { model: selectedModel, direction: userDirection };
    const path = docType === 'article'
      ? `/zero-api/ideas/${id}/generate-article`
      : `/zero-api/ideas/${id}/generate-pragmatic`;
    
    try {
      const resp = await fetch(path, { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(body) 
      });
      
      if (!resp.ok) {
        const data = await resp.json();
        throw new Error(data.detail || data.error || 'Error generando');
      }
      
      const data = await resp.json();
      if (data.redirectUrl) {
        // Redirect to article page immediately
        window.location.href = data.redirectUrl;
      }
    } catch (e) {
      alert(String(e?.message || e));
      setGeneratingArticle(false);
    }
  }, [docType, selectedModel, userDirection]);

  const onKeyDown = React.useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  // Auto-grow textarea
  useEffect(() => {
    const el = document.querySelector('textarea.input-field');
    if (!el) return;
    const handler = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    };
    handler();
    el.addEventListener('input', handler);
    return () => el.removeEventListener('input', handler);
  }, []);

  // --- Helpers de UI ---
  const createStatBar = React.useCallback((label, value) => {
    const maxStat = 255;
    const percentage = Math.min(100, Math.round((value / maxStat) * 100));
    return React.createElement(
      "div",
      { style: { display: "flex", alignItems: "center", gap: 10 } },
      React.createElement("span", { style: { minWidth: 80, fontSize: 14, color: "#666" } }, label),
      React.createElement(
        "div",
        { style: { flex: 1, height: 20, background: "#e0e0e0", borderRadius: 10, overflow: "hidden" } },
        React.createElement("div", {
          style: {
            width: `${percentage}%`,
            height: "100%",
            background: "linear-gradient(90deg, #667eea, #764ba2)",
            transition: "width 0.3s ease"
          }
        })
      ),
      React.createElement("span", null, value)
    );
  }, []);

  // Calculate section info outside of conditionals (hooks must always run)
  const isFirstSection = React.useMemo(() => {
    if (route.mode !== "detail") return false;
    return !route.section || (toc.length > 0 && toc[0].id === route.section);
  }, [route.mode, route.section, toc]);
  
  const currentSectionTitle = React.useMemo(() => {
    if (route.mode !== "detail") return null;
    const firstCheck = !route.section || (toc.length > 0 && toc[0].id === route.section);
    if (firstCheck || !route.section) return null;
    const section = toc.find(t => t.id === route.section);
    return section ? section.title : null;
  }, [route.mode, route.section, toc]);

  // Copy handler - copiar TODO el contenido completo
  const handleCopy = React.useCallback(async () => {
    try {
      // Copiar TODO el documento, no solo la sección actual
      await navigator.clipboard.writeText(detail.result || '');
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [detail.result]);

  // Share handler (Web Share API + clipboard fallback)
  const handleShare = React.useCallback(async () => {
    try {
      const url = window.location.href;
      const title = mainTitle || 'Idea';
      if (navigator.share) {
        await navigator.share({ title, url });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }
      setShareSuccess(true);
      setTimeout(() => setShareSuccess(false), 2000);
    } catch (_) {
      // Silencio si el usuario cancela
    }
  }, [mainTitle]);

  // Scroll al inicio cuando cambia la sección
  useEffect(() => {
    if (route.mode === 'detail' && route.section) {
      const el = document.querySelector('.content-section');
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [route.mode, route.section]);

  // Atajos de teclado para copiar/compartir en detalle
  useEffect(() => {
    if (route.mode !== 'detail') return;
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') return; // reservado para sidebar
      if ((e.key === 'c' || e.key === 'C') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleCopy();
      }
      if ((e.key === 's' || e.key === 'S') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        handleShare();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [route.mode, handleCopy, handleShare]);

  // Navegación con flechas entre títulos del contenido
  useEffect(() => {
    if (route.mode !== 'detail' || toc.length === 0) return;
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target;
      const tag = (target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const currentIndex = toc.findIndex(t => t.id === route.section);
      let nextIndex = currentIndex;
      if (e.key === 'ArrowRight') nextIndex = Math.min(toc.length - 1, (currentIndex < 0 ? 0 : currentIndex + 1));
      else nextIndex = Math.max(0, (currentIndex < 0 ? 0 : currentIndex - 1));
      if (nextIndex >= 0 && nextIndex < toc.length && nextIndex !== currentIndex) {
        const next = toc[nextIndex];
        window.history.pushState(null, '', `/zero/idea/${route.ideaId}/${encodeURIComponent(next.id)}`);
        setRoute({ mode: 'detail', ideaId: route.ideaId, section: next.id });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [route.mode, route.section, route.ideaId, toc]);

  // Views
  if (route.mode === "article") {
    // Article view
    return React.createElement(
      "div",
      { className: "reading-container fade-in", style: { maxWidth: '750px', margin: '40px auto' } },
      // Header con back link
      React.createElement(
        "div",
        { style: { marginBottom: '32px' } },
        React.createElement(
          "a",
          { 
            href: "/zero", 
            className: "back-link",
            onClick: (e) => {
              e.preventDefault();
              window.history.pushState(null, '', '/zero');
              setRoute({ mode: 'home', ideaId: null, articleId: null, section: null });
            }
          },
          "← Volver a Zero"
        )
      ),
      
      // Loading state
      article.loading && React.createElement(
        "div",
        { className: "loading-state", style: { textAlign: 'center', padding: '60px 0' } },
        React.createElement("p", { className: "loading-elegant" }, "Cargando artículo...")
      ),
      
      // Error state
      article.error && React.createElement(
        "div",
        { className: "error-elegant", style: { padding: '20px', marginTop: '20px' } },
        article.error
      ),
      
      // Article content
      !article.loading && !article.error && React.createElement(
        React.Fragment,
        null,
        // Title
        React.createElement(
          "h1", 
          { 
            className: "main-doc-title",
            style: { 
              fontSize: '48px',
              fontWeight: '700',
              lineHeight: '1.1',
              letterSpacing: '-0.03em',
              marginBottom: '16px',
              background: 'linear-gradient(180deg, rgba(255,255,255,1) 0%, rgba(255,255,255,0.85) 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text'
            }
          },
          article.title || "Artículo"
        ),
        
        // Byline
        article.model && React.createElement(
          "div",
          { 
            className: "article-byline",
            style: {
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px',
              color: 'rgba(255, 255, 255, 0.5)',
              marginBottom: '40px'
            }
          },
          React.createElement(
            "span",
            null,
            article.model === 'claude-opus' ? 'Por Claude Opus 4.1' : 'Por GPT-5'
          ),
          React.createElement("span", null, "•"),
          React.createElement(
            "span",
            null,
            new Date().toLocaleDateString('es-ES', { month: 'long', day: 'numeric', year: 'numeric' })
          )
        ),
        
        // Processing indicator
        article.status === 'processing' && React.createElement(
          "div",
          { 
            style: { 
              padding: '12px 20px',
              background: 'rgba(10, 132, 255, 0.1)',
              borderRadius: '12px',
              marginBottom: '24px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px'
            }
          },
          React.createElement(
            "div",
            { 
              className: "spinner-small",
              style: {
                width: '16px',
                height: '16px',
                border: '2px solid rgba(10, 132, 255, 0.3)',
                borderTopColor: '#0a84ff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }
            }
          ),
          React.createElement("span", { style: { fontSize: '14px', color: '#0a84ff' } }, "Generando contenido...")
        ),
        
        // Parse content to separate monologue and article
        (() => {
          const rawContent = article.content || '';
          const monologueMatch = rawContent.match(/<internal_monologue>([\s\S]*?)<\/internal_monologue>/);
          const monologue = monologueMatch ? monologueMatch[1].trim() : '';
          const articleContent = rawContent
            .replace(/<internal_monologue>[\s\S]*?<\/internal_monologue>\s*/g, '')
            .replace(/<\/?blog_article>\s*/g, '')
            .trim();
          
          return React.createElement(
            React.Fragment,
            null,
            // Internal monologue section (if exists)
            monologue && React.createElement(
              "div",
              { 
                style: { 
                  marginBottom: '32px',
                  padding: '16px 20px',
                  background: 'rgba(255, 255, 255, 0.03)',
                  borderRadius: '12px',
                  border: '1px solid rgba(255, 255, 255, 0.06)'
                }
              },
              React.createElement(
                "button",
                {
                  onClick: () => setShowMonologue(!showMonologue),
                  style: {
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: '13px',
                    fontWeight: '500',
                    cursor: 'pointer',
                    padding: '0',
                    marginBottom: showMonologue ? '16px' : '0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }
                },
                React.createElement(
                  "span",
                  { 
                    style: { 
                      display: 'inline-block',
                      transform: showMonologue ? 'rotate(90deg)' : 'rotate(0deg)',
                      transition: 'transform 0.2s'
                    }
                  },
                  "▶"
                ),
                "Monólogo interno (", 
                monologue.split('\n').filter(l => l.trim()).length, 
                " líneas)"
              ),
              showMonologue && React.createElement(
                "div",
                { 
                  style: { 
                    color: 'rgba(255, 255, 255, 0.35)',
                    fontSize: '13px',
                    lineHeight: '1.6',
                    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word'
                  }
                },
                monologue
              )
            ),
            // Article content
            React.createElement(
              "div",
              { 
                className: "content-section",
                style: { 
                  fontSize: '18px',
                  lineHeight: '1.75',
                  letterSpacing: '-0.008em'
                }
              },
              mdLib && purifyLib && articleContent
                ? React.createElement("div", { 
                    className: "md",
                    dangerouslySetInnerHTML: { 
                      __html: purifyLib.sanitize(mdLib.parse(articleContent))
                    } 
                  })
                : React.createElement(
                    "div",
                    { className: "md" },
                    articleContent
                      ? React.createElement("div", {
                          dangerouslySetInnerHTML: {
                            __html: articleContent
                              .replace(/^###\s+(.+)$/gm, '<h3>$1</h3>')
                              .replace(/^##\s+(.+)$/gm, '<h2>$1</h2>')
                              .replace(/^#\s+(.+)$/gm, '<h1>$1</h1>')
                              .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                              .replace(/\*(.*?)\*/g, '<em>$1</em>')
                              .replace(/`([^`]+)`/g, '<code>$1</code>')
                              .replace(/\n\n/g, '</p><p>')
                              .replace(/^/, '<p>')
                              .replace(/$/, '</p>')
                          }
                        })
                      : React.createElement("p", { style: { opacity: 0.6 } }, 
                          article.status === 'processing' ? "El contenido aparecerá aquí..." : "Sin contenido"
                        )
                  )
            )
          );
        })()
      )
    );
  }
  
  if (route.mode === "detail") {
    
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "div",
        { className: `reading-container fade-in ${toc.length > 0 ? 'with-sidebar' : ''}` },
      // Back link y botones en header
      React.createElement(
        "div",
        { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' } },
        React.createElement(
          "a",
          { 
            href: "/zero", 
            className: "back-link",
            style: { margin: 0 },
            onClick: (e) => {
              e.preventDefault();
              window.history.pushState(null, '', '/zero');
              setRoute({ mode: 'home', ideaId: null, section: null });
            }
          },
          "← Volver"
        ),
        React.createElement(
          "div",
          { style: { display: 'flex', gap: '8px' } },
          // Share button
          React.createElement(
            "button",
            {
              onClick: handleShare,
              className: `action-button ${shareSuccess ? 'shared' : ''}`,
              title: "Compartir enlace",
            },
            shareSuccess ? "✓ Listo" : "Compartir"
          ),
          // Copy button - copia TODO
          React.createElement(
            "button",
            {
              onClick: handleCopy,
              className: `action-button ${copySuccess ? 'copied' : ''}`,
              title: "Copiar TODO el contenido",
              'aria-live': 'polite',
            },
            copySuccess ? "✓ Copiado" : "Copiar todo"
          )
        )
      ),
      // Main title and metadata - only show on first section
      isFirstSection && React.createElement(
        "div",
        { className: "title-section" },
        React.createElement("h1", { className: "main-doc-title" }, mainTitle || "Idea"),
        // Elegant byline positioning - model info as subtle context AFTER title
        detail.model && React.createElement(
          "div",
          { className: "article-byline" },
          React.createElement(
            "span",
            { className: "article-model-badge" },
            detail.model === 'claude-opus' ? 'Por Claude Opus 4.1' : 'Por GPT-5'
          ),
          React.createElement(
            "span",
            { className: "byline-separator" },
            " • "
          ),
          React.createElement(
            "span",
            { className: "article-date" },
            new Date().toLocaleDateString('es-ES', { month: 'long', day: 'numeric', year: 'numeric' })
          )
        )
      ),
      // Inline controls to generate Article/Pragmatic from THIS idea
      React.createElement(
        "div",
        { 
          className: "composer", 
          style: { marginTop: 24, marginBottom: 32, opacity: 0.85, transition: 'opacity 0.3s ease' },
          onMouseEnter: (e) => e.currentTarget.style.opacity = '1',
          onMouseLeave: (e) => e.currentTarget.style.opacity = '0.85'
        },
        React.createElement(
          "div",
          { className: "composer-controls", style: { display: 'flex', gap: 12 } },
          React.createElement(
            "select",
            { value: selectedModel, onChange: (e) => setSelectedModel(e.target.value), className: "model-dropdown", "aria-label": "Modelo" },
            React.createElement("option", { value: "gpt-5" }, "GPT-5"),
            React.createElement("option", { value: "claude-opus" }, "Claude Opus 4.1")
          ),
          React.createElement(
            "select",
            { value: docType, onChange: (e) => setDocType(e.target.value), className: "model-dropdown", "aria-label": "Tipo" },
            React.createElement("option", { value: "article" }, "Artículo"),
            React.createElement("option", { value: "pragmatic" }, "Pragmático")
          )
        ),
        React.createElement(
          "div",
          { className: "composer-main", style: { marginTop: 8 } },
          React.createElement("textarea", { value: userDirection, onChange: (e) => setUserDirection(e.target.value), rows: 2, placeholder: "Dirección breve (opcional)", className: "input-field", "aria-label": "Dirección breve" }),
          React.createElement(
            "button",
            { 
              onClick: async () => { try { await generateFromIdea(route.ideaId); } catch (e) { alert(String(e?.message || e)); } }, 
              className: "submit-button", 
              title: "Crear",
              disabled: generatingArticle
            },
            generatingArticle 
              ? React.createElement("span", null, "Generando...") 
              : (docType === 'article' ? 'Crear Artículo' : 'Crear Pragmático')
          )
        )
      ),
      // Section title as primary header when not on first section
      !isFirstSection && currentSectionTitle && React.createElement("h1", { className: "section-as-title" }, currentSectionTitle),
      // Main content
      React.createElement(
        "div",
        { className: `content-section ${!isFirstSection ? 'no-main-title' : ''}`, style: { position: 'relative' } },
        detail.loading
          ? React.createElement("p", { className: "loading-elegant" }, "Cargando…")
          : htmlContent
                ? React.createElement("div", { className: "md", dangerouslySetInnerHTML: { __html: htmlContent } })
                : React.createElement(
                    "pre",
                    { style: { whiteSpace: "pre-wrap", margin: 0 } },
                    (currentContent || "Sin contenido aún.")
                  )
      )
    ),
    // Sidebar derecho con subtítulos
    toc.length > 0 && React.createElement(
      "div",
      { className: `sidebar-right ${sidebarCollapsed ? 'collapsed' : ''}` },
      React.createElement(
        "div",
        { 
          className: "sidebar-toggle",
          onClick: () => setSidebarCollapsed(!sidebarCollapsed),
          title: "Toggle sidebar (⌘B)"
        },
        sidebarCollapsed ? "‹" : "›"
      ),
      React.createElement(
        "nav",
        { className: "sidebar-nav" },
        React.createElement("div", { className: "sidebar-title" }, "Contenido"),
        React.createElement(
          "ul",
          { className: "sidebar-items" },
          toc.map((item) => (
            React.createElement(
              "li",
              { key: item.id, className: "sidebar-item" },
              React.createElement(
                "a",
                {
                  href: `#`,
                  className: `sidebar-link ${route.section === item.id ? 'active' : ''}`,
                  onClick: (e) => {
                    e.preventDefault();
                    window.history.pushState(null, '', `/zero/idea/${route.ideaId}/${encodeURIComponent(item.id)}`);
                    setRoute({ mode: "detail", ideaId: route.ideaId, section: item.id });
                  }
                },
                item.title
              )
            )
          ))
        )
      )
    )
  );
  }

  // Home
  return React.createElement(
    "div",
    { className: "home-container fade-in" },
    // Hero section
    React.createElement(
      "div",
      { className: "home-hero" },
      React.createElement("h1", { className: "home-title" }, "Research Lab"),
      React.createElement("p", { className: "home-subtitle" }, "Process and analyze ideas to turn them into knowledge")
    ),

    // Composer - Perfected layout with Jobs-inspired hierarchy
    React.createElement(
      "div",
      { className: "composer" },
      // Model selectors - now stacked for better visual flow
      React.createElement(
        "div",
        { className: "composer-controls" },
        React.createElement(
          "div",
          { className: "composer-controls-row" },
          React.createElement(
            "div",
            null,
            React.createElement(
              "label",
              { htmlFor: "model-select", className: "model-selector-label" },
              "AI Model"
            ),
            React.createElement(
              "select",
              {
                id: "model-select",
                value: selectedModel,
                onChange: (e) => setSelectedModel(e.target.value),
                className: "model-dropdown",
                "aria-label": "Select AI model"
              },
              React.createElement("option", { value: "gpt-5" }, "GPT-5"),
              React.createElement("option", { value: "claude-opus" }, "Claude Opus 4.1")
            )
          ),
          React.createElement(
            "div",
            null,
            React.createElement(
              "label",
              { htmlFor: "doctype-select", className: "model-selector-label" },
              "Document Type"
            ),
            React.createElement(
              "select",
              {
                id: "doctype-select",
                value: docType,
                onChange: (e) => setDocType(e.target.value),
                className: "model-dropdown",
                "aria-label": "Select document type"
              },
              React.createElement("option", { value: "article" }, "Article"),
              React.createElement("option", { value: "pragmatic" }, "Pragmatic")
            )
          )
        )
      ),
      // Main input area - now the protagonist
      React.createElement(
        "div",
        { className: "composer-main" },
        React.createElement("textarea", {
          value: input,
          onChange: (e) => setInput(e.target.value),
          onKeyDown,
          rows: 5,
          placeholder: "Paste text or describe your idea here...",
          className: "input-field",
          "aria-label": "Enter your idea"
        }),
        React.createElement(
          "button",
          { 
            onClick: onSubmit, 
            disabled: sending || !input.trim(), 
            className: "submit-button", 
            title: "Send (Enter)",
            "aria-label": "Send idea"
          },
          sending 
            ? React.createElement("span", { className: "spinner", "aria-hidden": true }) 
            : React.createElement("span", null, "Process Idea →")
        )
      )
    ),
    errorMsg && React.createElement("div", { className: "error-elegant", style: { marginTop: '8px' } }, errorMsg),

    // Search + Ideas list + Pagination
    React.createElement(
      "div",
      { className: `ideas-grid ${ideas.length > 0 ? 'has-ideas' : ''}` },
      // Search bar
      React.createElement(
        "div",
        { className: "searchbar", style: { marginBottom: '6px' } },
        React.createElement("input", {
          type: "text",
          placeholder: "Search…",
          value: query,
          onChange: (e) => setQuery(e.target.value)
        })
      ),
      ...ideas.map((item) =>
        React.createElement(
          "a",
          { 
            key: item.id,
            href: `/zero/idea/${item.id}`,
            className: "idea-card",
            onClick: (e) => {
              e.preventDefault();
              window.history.pushState(null, '', `/zero/idea/${item.id}`);
              setRoute({ mode: "detail", ideaId: item.id, section: null });
            }
          },
          React.createElement(
            "div",
            { className: "idea-preview" },
            item.text.length > 80 ? item.text.slice(0, 80) + "…" : item.text
          ),
          React.createElement(
            "div",
            { className: "idea-meta", 'data-status': item.status || '' },
            // Clean metadata - no model display, just status and date
            // Model info intentionally excluded for cleaner home page
            item.status === 'processing' ? 'Processing…' : item.status === 'done' ? 'Completed' : (item.status || ''),
            item.status ? " • " : "",
            new Date(item.createdAt).toLocaleDateString()
          )
        )
      ),
      // Pagination controls
      React.createElement(
        "div",
        { style: { display: 'grid', gridTemplateColumns: '120px 1fr 120px', alignItems: 'center', gap: '8px', marginTop: '12px' } },
        React.createElement(
          "button",
          {
            onClick: () => { const p = Math.max(1, page - 1); setPage(p); loadIdeas({ page: p }); },
            disabled: page <= 1,
            className: "action-button",
            title: "Previous page"
          },
          "← Prev"
        ),
        (() => {
          const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
          const start = Math.max(1, Math.min(totalPages - 9, page - 4));
          const end = Math.min(totalPages, start + 9);
          const pages = [];
          for (let i = start; i <= end; i++) pages.push(i);
          return React.createElement(
            "div",
            { style: { display: 'flex', justifyContent: 'center', gap: '6px' } },
            ...pages.map((p) => React.createElement(
              "button",
              {
                key: `p-${p}`,
                onClick: () => { setPage(p); loadIdeas({ page: p }); },
                className: "action-button",
                style: p === page ? { background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)' } : null,
                title: `Go to page ${p}`
              },
              String(p)
            ))
          );
        })(),
        React.createElement(
          "button",
          {
            onClick: () => { const maxP = Math.max(1, Math.ceil(totalCount / pageSize)); const p = Math.min(maxP, page + 1); setPage(p); loadIdeas({ page: p }); },
            disabled: page >= Math.ceil(totalCount / pageSize),
            className: "action-button",
            title: "Next page"
          },
          "Next →"
        )
      )
    )
  );
}
