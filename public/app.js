// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // Entrada principal
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Lista de ideas recientes (desde backend)
  const [ideas, setIdeas] = useState([]); // {id, text, status, createdAt}

  // Routing mínimo: home vs detail (/zero/idea/:id) y sección opcional (/zero/idea/:id/:section)
  const [route, setRoute] = useState({ mode: "home", ideaId: null, section: null });

  const evaluateRoute = () => {
    // Soporta sección opcional como último segmento
    const m = window.location.pathname.match(/^\/zero\/idea\/([0-9a-fA-F]{24})(?:\/([^\/]+))?$/);
    if (m) setRoute({ mode: "detail", ideaId: m[1], section: m[2] ? decodeURIComponent(m[2]) : null });
    else setRoute({ mode: "home", ideaId: null, section: null });
  };

  useEffect(() => {
    evaluateRoute();
    const onPop = () => evaluateRoute();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Toggle del sidebar derecho
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  
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
  
  // Detail view state
  const [detail, setDetail] = useState({ loading: false, status: "", result: "" });
  // Índice de secciones [{id, title}]
  const [toc, setToc] = useState([]);
  // Mapa id->contenido cuando el endpoint full esté disponible
  const [sectionMap, setSectionMap] = useState({});
  // Título principal (H1)
  const [mainTitle, setMainTitle] = useState("Idea");
  // Markdown renderer libs
  const [mdLib, setMdLib] = useState(null);
  const [purifyLib, setPurifyLib] = useState(null);

  function slugify(str) {
    return (str || 'seccion')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 64);
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
          setDetail({ loading: false, status: data.status || "", result: data.resume_raw || data.result || "" });
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
      } catch (_) {}

      // Fallback al endpoint simple
      const r = await fetch(`/zero-api/ideas/${id}`);
      data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "Error obteniendo idea");
      setDetail({ loading: false, status: data.status || "", result: data.result || "" });
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
      setDetail({ loading: false, status: "error", result: String(e?.message || e) });
      setToc([]);
      setSectionMap({});
      setMainTitle('Idea');
    }
  };

  useEffect(() => {
    if (route.mode === "detail" && route.ideaId) loadDetail(route.ideaId);
    // Log al backend para confirmar navegación a detalle (debug operacional)
    try { fetch(`/zero-api/ping?event=detail_view&id=${encodeURIComponent(route.ideaId || '')}&section=${encodeURIComponent(route.section || '')}`).catch(() => {}); } catch (_) {}
  }, [route.mode, route.ideaId]);

  // Contenido actual según sección
  const currentContent = React.useMemo(() => {
    if (!detail.result) return "";
    if (!route.section) return detail.result;
    // Buscar por id de sección en el mapa
    if (sectionMap[route.section]) {
      const currentItem = toc.find(t => t.id === route.section);
      const header = currentItem ? `## ${currentItem.title}\n\n` : '';
      return header + sectionMap[route.section];
    }
    return "Sección no encontrada";
  }, [detail.result, route.section, sectionMap]);

  // Si no hay sección seleccionada pero tenemos índice, seleccionar la primera
  useEffect(() => {
    if (route.mode === 'detail' && route.ideaId && !route.section && toc.length > 0) {
      const first = toc[0];
      window.history.replaceState(null, '', `/zero/idea/${route.ideaId}/${encodeURIComponent(first.id)}`);
      setRoute({ mode: 'detail', ideaId: route.ideaId, section: first.id });
    }
  }, [route.mode, route.ideaId, route.section, toc]);

  // Cargar libs de Markdown en el navegador
  useEffect(() => {
    (async () => {
      try {
        const m = await import('https://esm.sh/marked@13');
        const d = await import('https://esm.sh/dompurify@3');
        
        // Extraer marked correctamente
        const marked = m.marked || m.default || m;
        
        // Extraer DOMPurify y crear instancia
        let DOMPurify = d.default || d;
        if (typeof DOMPurify === 'function') {
          DOMPurify = DOMPurify(window);
        }
        
        // Configurar marked solo si es un objeto con setOptions
        if (marked && typeof marked === 'object' && marked.setOptions) {
          marked.setOptions({ 
            breaks: true, 
            gfm: true,
            mangle: false, 
            headerIds: false 
          });
        }
        
        // Guardar las librerías solo si son válidas
        if (marked) {
          setMdLib(() => marked);
        }
        if (DOMPurify && typeof DOMPurify.sanitize === 'function') {
          setPurifyLib(() => DOMPurify);
        }
      } catch (err) {
        console.error('Error loading markdown libraries:', err);
      }
    })();
  }, []);

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
      console.error('Error rendering markdown:', err);
      const safeContent = typeof currentContent === 'string' ? currentContent : String(currentContent || '');
      return `<pre>${(safeContent || '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</pre>`;
    }
  }, [mdLib, purifyLib, currentContent]);

  const loadIdeas = async () => {
    try {
      const r = await fetch("/zero-api/ideas");
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.items)) setIdeas(data.items);
    } catch (_) {}
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
    for (let i = 0; i < attempts; i++) {
      await new Promise((res) => setTimeout(res, 1500));
      try {
        const r = await fetch(`/zero-api/ideas/${id}`);
        if (!r.ok) continue;
        const data = await r.json();
        if (data.status && data.status !== "processing") {
          upsertIdea({ id, status: data.status, result: data.result });
          return;
        }
      } catch (_) {}
    }
  };

  const onSubmit = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setErrorMsg("");
    try {
      const r = await fetch("/zero-api/ideas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text })
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
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

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
  const createStatBar = (label, value) => {
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
  };

  // Views
  if (route.mode === "detail") {
    return React.createElement(
      React.Fragment,
      null,
      React.createElement(
        "div",
        { className: `reading-container fade-in ${toc.length > 0 ? 'with-sidebar' : ''}` },
      // Back link
      React.createElement(
        "a",
        { 
          href: "/zero", 
          className: "back-link",
          onClick: (e) => {
            e.preventDefault();
            window.history.pushState(null, '', '/zero');
            setRoute({ mode: 'home', ideaId: null, section: null });
          }
        },
        "← Volver"
      ),
      // Main title
      React.createElement("h1", null, mainTitle || "Idea"),
      React.createElement("p", { className: "meta" }, `ID: ${route.ideaId}`),
      // Main content
      React.createElement(
        "div",
        { className: "content-section" },
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
          ...toc.map((item) => (
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
          sending ? "Enviando…" : "Enviar"
        )
      ),
      errorMsg ? React.createElement("div", { className: "error-elegant" }, errorMsg) : null
    ),

    // Ideas list
    ideas.length > 0 && React.createElement(
      "div",
      { className: "ideas-grid" },
      React.createElement("h2", { style: { marginBottom: 24 } }, "Ideas recientes"),
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
