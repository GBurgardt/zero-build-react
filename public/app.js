// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {

  // --- Chat super simple ---
  const [messages, setMessages] = useState([
    { role: "assistant", content: "Hola! Soy la IA de Zero. Preguntame algo." },
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [aiError, setAiError] = useState("");

  const sendMessage = async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    const next = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    setAiError("");

    try {
      const r = await fetch("/zero-api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, model: "gpt-5" })
      });
      const data = await r.json();
      if (!r.ok || data.error) throw new Error(data.detail || data.error || "Error en OpenAI");
      const answer = (data.text || "").trim();
      setMessages((prev) => [...prev, { role: "assistant", content: answer }]);
    } catch (err) {
      setAiError(err.message || String(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

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
          { className: "messages" },
          ...messages.map((m, idx) =>
            React.createElement(
              "div",
              { key: idx, className: `${m.role === "user" ? "row-right" : "row-left"}` },
              React.createElement("div", { className: `bubble ${m.role}` }, m.content)
            )
          )
        ),
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
            { onClick: sendMessage, disabled: sending || !input.trim(), className: "send" },
            sending ? "…" : "➤"
          )
        ),
        aiError ? React.createElement("div", { className: "error", style: { marginTop: 10 } }, `Error: ${aiError}`) : null
      ),

      // Right column: search box + examples + list (estático)
      React.createElement(
        "div",
        { className: "card" },
        React.createElement(
          "div",
          { className: "searchbar" },
          React.createElement("input", { placeholder: "Escribe y presioná Enter: 'top 5 del último mes sobre conciencia'" }),
          React.createElement("button", { className: "btn-primary" }, "Buscar")
        ),
        React.createElement(
          "div",
          { className: "chip-row", style: { marginTop: 12 } },
          ...[
            "top 5 del último mes sobre conciencia",
            "top 10 de siempre sobre IA",
            "mejor de esta semana sobre metacognición"
          ].map((t, i) => React.createElement("div", { key: i, className: "chip" }, t))
        ),
        React.createElement(
          "div",
          { className: "tabs" },
          React.createElement("div", { className: "tab active" }, "Recientes"),
          React.createElement("div", { className: "tab" }, "Favoritos"),
          React.createElement("div", { className: "tab" }, "Studio")
        ),
        React.createElement(
          "div",
          { className: "list" },
          ...[
            { t: "Conciencia artificial como marcador tribal en el debate sobre la IA", s: "mira:<<<TEXTO ORIGINAL:", d: "miércoles 13, 22:30" },
            { t: "La conciencia como marcador tribal en la inteligencia artificial", s: "mira:<<<TEXTO ORIGINAL:", d: "miércoles 13, 23:30" },
            { t: "Guardrails y conciencia en la IA", s: "HILO DE TWITTER COMPLETO:", d: "miércoles 13, 22:09" },
          ].map((item, idx) =>
            React.createElement(
              "div",
              { key: idx, className: "list-item" },
              React.createElement(
                "div",
                null,
                React.createElement("h4", null, item.t),
                React.createElement("p", null, item.s),
                React.createElement("p", null, item.d)
              ),
              React.createElement("div", { className: "chevron" }, "›")
            )
          )
        )
      )
    )
  );
}
