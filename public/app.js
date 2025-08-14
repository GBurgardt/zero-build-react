// public/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  // --- Pokemon demo (se muestra siempre dentro de la UI) ---
  const [pokemon, setPokemon] = useState(null);
  const [pokemonName, setPokemonName] = useState("charizard");
  const [pokemonState, setPokemonState] = useState("loading"); // loading | ok | error
  const [pokemonError, setPokemonError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setPokemonState("loading");
    fetch(`https://pokeapi.co/api/v2/pokemon/${pokemonName}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (cancelled) return;
        setPokemon(data);
        setPokemonState("ok");
      })
      .catch((e) => {
        if (cancelled) return;
        setPokemonError(e.message);
        setPokemonState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [pokemonName]);

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
    { id: "app-root", style: { display: "grid", gap: 24 } },
    // HEADER
    React.createElement(
      "div",
      { className: "card" },
      React.createElement("h1", null, "🚀 Zero-build React - Chat + PokeAPI"),
      React.createElement("p", null, "UI simple: chateá con una IA y mirá stats de Pokémon. ")
    ),

    // CHAT
    React.createElement(
      "div",
      { className: "card" },
      React.createElement("h2", null, "💬 Chat con IA"),
      React.createElement(
        "div",
        {
          style: {
            display: "grid",
            gap: 12
          }
        },
        // Messages list
        React.createElement(
          "div",
          {
            style: {
              display: "grid",
              gap: 8,
              maxHeight: 280,
              overflowY: "auto",
              padding: 8,
              background: "rgba(0,0,0,0.03)",
              borderRadius: 8
            }
          },
          ...messages.map((m, idx) =>
            React.createElement(
              "div",
              {
                key: idx,
                style: {
                  justifySelf: m.role === "user" ? "end" : "start",
                  maxWidth: "80%",
                  padding: "10px 12px",
                  borderRadius: 12,
                  background: m.role === "user" ? "#667eea" : "white",
                  color: m.role === "user" ? "white" : "#333",
                  border: m.role === "assistant" ? "1px solid #e6e6e6" : "none",
                  whiteSpace: "pre-wrap"
                }
              },
              m.content
            )
          )
        ),
        // Input + Send
        React.createElement(
          "div",
          { style: { display: "flex", gap: 8 } },
          React.createElement("textarea", {
            value: input,
            onChange: (e) => setInput(e.target.value),
            onKeyDown,
            rows: 2,
            placeholder: "Escribí tu mensaje y presioná Enter...",
            style: {
              flex: 1,
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              fontFamily: "inherit"
            }
          }),
          React.createElement(
            "button",
            {
              onClick: sendMessage,
              disabled: sending || !input.trim(),
              style: {
                padding: "10px 16px",
                border: "2px solid #764ba2",
                borderRadius: 8,
                background: sending ? "#e0e0e0" : "white",
                color: "#764ba2",
                cursor: sending ? "not-allowed" : "pointer",
                fontWeight: "bold"
              }
            },
            sending ? "Enviando..." : "Enviar"
          )
        ),
        aiError ? React.createElement("div", { className: "error" }, `Error: ${aiError}`) : null
      )
    ),

    // POKEMON
    React.createElement(
      "div",
      { className: "card" },
      React.createElement("h2", null, "🧪 Demo PokeAPI"),
      React.createElement(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 20, marginTop: 12 } },
        pokemonState === "loading"
          ? React.createElement("p", { className: "loading" }, "Cargando datos...")
          : pokemonState === "error"
          ? React.createElement("div", { className: "error" }, `Error: ${pokemonError}`)
          : React.createElement(
              React.Fragment,
              null,
              pokemon?.sprites?.front_default
                ? React.createElement("img", {
                    src: pokemon.sprites.front_default,
                    alt: pokemon.name,
                    width: 96,
                    height: 96,
                    className: "pokemon-sprite"
                  })
                : null,
              React.createElement(
                "div",
                null,
                React.createElement("h3", null, pokemon?.name?.toUpperCase()),
                pokemon
                  ? React.createElement(
                      React.Fragment,
                      null,
                      React.createElement("p", null, `#${pokemon.id} - ${pokemon.types.map(t => t.type.name).join(", ")}`),
                      React.createElement("p", null, `Altura: ${pokemon.height / 10}m`),
                      React.createElement("p", null, `Peso: ${pokemon.weight / 10}kg`)
                    )
                  : null
              )
            )
      ),
      pokemon && pokemon.stats
        ? React.createElement(
            "div",
            { style: { display: "grid", gap: 8, marginTop: 12 } },
            React.createElement("h4", null, "Stats"),
            ...pokemon.stats.map((stat) =>
              createStatBar(stat.stat.name.replace("-", " ").toUpperCase(), stat.base_stat)
            )
          )
        : null,
      React.createElement(
        "div",
        { style: { marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" } },
        ["pikachu", "charizard", "mewtwo", "bulbasaur", "snorlax"].map((name) =>
          React.createElement(
            "button",
            {
              key: name,
              onClick: () => setPokemonName(name),
              style: {
                padding: "6px 12px",
                border: "1px solid #667eea",
                borderRadius: 8,
                background: pokemonName === name ? "#667eea" : "white",
                color: pokemonName === name ? "white" : "#667eea",
                cursor: "pointer",
                fontWeight: "bold"
              }
            },
            name
          )
        )
      )
    )
  );
}
