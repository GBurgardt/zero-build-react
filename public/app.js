// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // Constants
  const IDEA_ID_REGEX = /^\/zero\/idea\/([0-9a-fA-F]{24})(?:\/([^\/]+))?$/;
  const POLL_INTERVAL = 3000;
  const MAX_INPUT_LENGTH = 999999; // Prácticamente infinito
  const SECTION_SLUG_MAX_LENGTH = 64;
  
  // State - Main input
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-5");

  // State - Ideas list
  const [ideas, setIdeas] = useState([]);

  // State - Routing
  const [route, setRoute] = useState({ mode: "home", ideaId: null, section: null });

  const evaluateRoute = React.useCallback(() => {
    const match = window.location.pathname.match(IDEA_ID_REGEX);
    if (match) {
      setRoute({ 
        mode: "detail", 
        ideaId: match[1], 
        section: match[2] ? decodeURIComponent(match[2]) : null 
      });
    } else {
      setRoute({ mode: "home", ideaId: null, section: null });
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

  useEffect(() => {
    if (route.mode === "detail" && route.ideaId) {
      loadDetail(route.ideaId);
    }
  }, [route.mode, route.ideaId]);

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
    } catch (_) {}
  }, []);
  useEffect(() => {
    try { localStorage.setItem('zero:selectedModel', selectedModel); } catch (_) {}
  }, [selectedModel]);

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

  const loadIdeas = async () => {
    try {
      const r = await fetch("/zero-api/ideas");
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.items)) setIdeas(data.items);
    } catch (error) {
      // Silent fail on ideas load
    }
  };

  useEffect(() => { loadIdeas(); }, []);

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

  const onKeyDown = React.useCallback((e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }, [onSubmit]);

  // Auto-grow textarea
  useEffect(() => {
    const el = document.querySelector('textarea.input');
    if (!el) return;
    const handler = () => {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
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
          // Model badge - indicador del modelo usado
          detail.model && React.createElement(
            "span",
            {
              className: "model-badge",
              title: `Generado con ${detail.model === 'claude-opus' ? 'Claude Opus 4.1' : 'GPT-5'}`,
            },
            detail.model === 'claude-opus' ? '🎭 Claude Opus 4.1' : '🤖 GPT-5'
          ),
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
      // Main title - only show on first section
      isFirstSection && React.createElement("h1", { className: "main-doc-title" }, mainTitle || "Idea"),
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
      React.createElement("p", { className: "home-subtitle" }, "Procesá y analizá ideas para convertirlas en conocimiento")
    ),

    // Model selector
    React.createElement(
      "div",
      { className: "model-selector" },
      React.createElement(
        React.Fragment,
        null,
        React.createElement(
          "label",
          { htmlFor: "model-select", className: "visually-hidden" },
          "Modelo"
        ),
        React.createElement(
          "select",
          {
            id: "model-select",
            value: selectedModel,
            onChange: (e) => setSelectedModel(e.target.value),
            className: "model-dropdown",
            "aria-label": "Seleccionar modelo"
          },
          React.createElement("option", { value: "gpt-5" }, "GPT-5"),
          React.createElement("option", { value: "claude-opus" }, "Claude Opus 4.1")
        )
      )
    ),

    // Input section
    React.createElement(
      "div",
      { className: "input-section" },
      React.createElement(
        "div",
        { className: "input-container" },
        React.createElement("textarea", {
          value: input,
          onChange: (e) => setInput(e.target.value),
          onKeyDown,
          rows: 4,
          placeholder: "Pegá un texto o escribí tu idea aquí...",
          className: "input-field"
        }),
        React.createElement(
          "button",
          { 
            onClick: onSubmit, 
            disabled: sending || !input.trim(), 
            className: "submit-button", 
            title: "Enviar (Enter)" 
          },
          sending 
            ? React.createElement("span", { className: "spinner", "aria-hidden": true }) 
            : "→"
        )
      ),
      errorMsg && React.createElement("div", { className: "error-elegant", style: { marginTop: '8px' } }, errorMsg)
    ),

    // Ideas list
    ideas.length > 0 && React.createElement(
      "div",
      { className: "ideas-grid has-ideas" },
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
            { className: "idea-meta" },
            item.status === 'processing' ? 'Procesando…' : item.status === 'done' ? 'Completado' : (item.status || ''),
            " • ",
            new Date(item.createdAt).toLocaleDateString()
          )
        )
      )
    )
  );
}
