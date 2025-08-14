// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // Entrada principal
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Lista de ideas recientes (desde backend)
  const [ideas, setIdeas] = useState([]); // {id, text, status, createdAt}

  // Routing mínimo: home vs detail (/zero/idea/:id)
  const [route, setRoute] = useState({ mode: "home", ideaId: null });

  const evaluateRoute = () => {
    const m = window.location.pathname.match(/^\/zero\/idea\/([0-9a-fA-F]{24})$/);
    if (m) setRoute({ mode: "detail", ideaId: m[1] });
    else setRoute({ mode: "home", ideaId: null });
  };

  useEffect(() => {
    evaluateRoute();
    const onPop = () => evaluateRoute();
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Detail view state
  const [detail, setDetail] = useState({ loading: false, status: "", result: "" });
  const loadDetail = async (id) => {
    try {
      setDetail((d) => ({ ...d, loading: true }));
      const r = await fetch(`/zero-api/ideas/${id}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || data.error || "Error obteniendo idea");
      setDetail({ loading: false, status: data.status || "", result: data.result || "" });
      if (data.status === "processing") pollStatus(id);
    } catch (e) {
      setDetail({ loading: false, status: "error", result: String(e?.message || e) });
    }
  };

  useEffect(() => {
    if (route.mode === "detail" && route.ideaId) loadDetail(route.ideaId);
  }, [route.mode, route.ideaId]);

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
        React.createElement("h1", null, "Idea"),
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
              "pre",
              { style: { whiteSpace: "pre-wrap", margin: 0 } },
              (detail.result || "Sin contenido aún.")
            ),
        React.createElement("div", { style: { marginTop: 16, display: 'flex', gap: 12 } },
          React.createElement("a", { href: "/zero", className: "chip", title: "Volver" }, "← Volver a Recientes"),
          React.createElement("a", { href: `https://getreels.app/zero/idea/${route.ideaId}`, className: "chip", title: "Link permanente" }, "Copiar enlace")
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
