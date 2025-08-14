// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // Entrada principal
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Lista de ideas recientes (desde backend)
  const [ideas, setIdeas] = useState([]); // {id, text, status, createdAt}

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
      // Left column: main chat card
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

      // Right column: solo recientes desde backend
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
