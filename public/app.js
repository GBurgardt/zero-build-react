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
        const m = await import('https://esm.sh/marked@12');
        const d = await import('https://esm.sh/dompurify@3');
        const marked = m.marked || m.default || m;
        let DOMPurify = d.default || d;
        // Asegurar instancia con método sanitize
        if (typeof DOMPurify?.sanitize !== 'function' && typeof DOMPurify === 'function') {
          try { DOMPurify = DOMPurify(window); } catch (_) {}
        }
        // Config suave: saltos de línea y tipografía amigable
        if (marked?.setOptions) {
          marked.setOptions({ breaks: true, smartypants: true, mangle: false, headerIds: false });
        }
        setMdLib(marked);
        setPurifyLib(DOMPurify);
      } catch (_) {
        // fallback silencioso, se mostrará como texto plano
      }
    })();
  }, []);

  const htmlContent = React.useMemo(() => {
    if (!mdLib || !purifyLib) return null;
    try {
      const safeContent = typeof currentContent === 'string' ? currentContent : String(currentContent || '');
      if (!safeContent) return '';
      const html = (mdLib.parse ? mdLib.parse(safeContent) : mdLib(safeContent));
      const clean = typeof purifyLib?.sanitize === 'function' ? purifyLib.sanitize(html) : html;
      return clean;
    } catch (_) {
      // Si el parser falla, mostramos texto plano
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
      "div",
      { className: "container" },
      React.createElement(
        "div",
        { className: "headline" },
        React.createElement("h1", null, mainTitle || "Idea"),
        React.createElement("p", null, `ID: ${route.ideaId}`)
      ),
      React.createElement(
        "div",
        { className: "card" },
        React.createElement("div", { className: "section-title" }, detail.status === 'processing' ? 'Procesando…' : detail.status === 'done' ? 'Resultado' : (detail.status || 'Estado')),
        React.createElement("div", { className: "divider" }),
        detail.loading
          ? React.createElement("p", { className: "loading" }, "Cargando…")
          : React.createElement(
              "div",
              { style: { display: 'flex', gap: 20 } },
              // Sidebar izquierda: índice de secciones
              React.createElement(
                "div",
                { style: { flex: '0 0 280px' } },
                React.createElement("h3", null, "Explicación detallada"),
                ...toc.map((item) => (
                  React.createElement(
                    "div",
                    { key: item.id, style: { marginBottom: 10 } },
                    React.createElement(
                      "a",
                      {
                        href: `#/zero/idea/${route.ideaId}/${encodeURIComponent(item.id)}`,
                        onClick: (e) => {
                          e.preventDefault();
                          window.history.pushState(null, '', `/zero/idea/${route.ideaId}/${encodeURIComponent(item.id)}`);
                          setRoute({ mode: "detail", ideaId: route.ideaId, section: item.id });
                        },
                        style: {
                          textDecoration: 'none',
                          color: route.section === item.id ? '#0a84ff' : '#333',
                          fontWeight: route.section === item.id ? 'bold' : 'normal',
                          display: 'block',
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: route.section === item.id ? 'rgba(10,132,255,0.08)' : 'transparent'
                        }
                      },
                      item.title
                    )
                  )
                ))
              ),
              // Columna derecha: contenido en Markdown
              React.createElement(
                "div",
                { style: { flex: 1 } },
                htmlContent
                  ? React.createElement("div", { className: "md", dangerouslySetInnerHTML: { __html: htmlContent } })
                  : React.createElement(
                      "pre",
                      { style: { whiteSpace: "pre-wrap", margin: 0 } },
                      (currentContent || "Sin contenido aún.")
                    )
              )
            ),
        React.createElement("div", { style: { marginTop: 16, display: 'flex', gap: 12 } },
          React.createElement("a", { href: "/zero", className: "chip", title: "Volver" }, "← Volver a Recientes"),
          React.createElement("a", { href: `https://getreels.app/zero/idea/${route.ideaId}${route.section ? `/${route.section}` : ''}`, className: "chip", title: "Link permanente" }, "Copiar enlace")
        )
      )
    );
  }

  // Home
  return React.createElement(
    "div",
    { className: "container" },
    // Headline
    React.createElement(
      "div",
      { className: "headline" },
      React.createElement("h1", null, "Research Lab"),
      React.createElement("p", null, "Procesá y analizá ideas para convertirlas en conocimiento")
    ),

    // Two column layout
    React.createElement(
      "div",
      { className: "two-col" },
      // Left column: input principal
      React.createElement(
        "div",
        { className: "card" },
        React.createElement("div", { className: "section-title" }, "Tu texto"),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "input-bar", style: { marginTop: 16 } },
          React.createElement("textarea", {
            value: input,
            onChange: (e) => setInput(e.target.value),
            onKeyDown,
            rows: 3,
            placeholder: "Pegá un texto o escribí acá y presioná Enter...",
            className: "input"
          }),
          React.createElement(
            "button",
            { onClick: onSubmit, disabled: sending || !input.trim(), className: "send", title: "Enviar" },
            React.createElement(
              "svg",
              { viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg" },
              React.createElement("path", { d: "M3 11.5L20 3L11.5 20L10 14L3 11.5Z", fill: "currentColor" })
            )
          )
        ),
        errorMsg ? React.createElement("div", { className: "error", style: { marginTop: 10 } }, `Error: ${errorMsg}`) : null
      ),

      // Right column: recientes
      React.createElement(
        "div",
        { className: "card" },
        React.createElement("div", { className: "section-title" }, "Recientes"),
        React.createElement("div", { className: "divider" }),
        React.createElement(
          "div",
          { className: "list" },
          ...ideas.map((item, idx) =>
            React.createElement(
              "div",
              { key: idx, className: "list-item" },
              React.createElement(
                "div",
                null,
                React.createElement("h4", null, item.text.length > 80 ? item.text.slice(0, 80) + "…" : item.text),
                React.createElement("p", null, item.status === 'processing' ? 'Procesando…' : item.status === 'done' ? 'Completado' : (item.status || '')),
                React.createElement("p", null, new Date(item.createdAt).toLocaleString())
              ),
              React.createElement("a", { className: "chevron", href: `/zero/idea/${item.id}`, title: "Abrir" }, "›")
            )
          )
        )
      )
    )
  );
}
