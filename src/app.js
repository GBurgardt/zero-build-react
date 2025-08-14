// /src/app.js
import React, { useEffect, useState } from "react";

export default function App() {
  const [pokemon, setPokemon] = useState(null);
  const [estado, setEstado] = useState("cargando");
  const [error, setError] = useState("");
  const [pokemonName, setPokemonName] = useState("charizard"); // CAMBIO: ahora empieza con Charizard!
  const [deployTime] = useState(new Date().toLocaleTimeString());

  useEffect(() => {
    setEstado("cargando");
    fetch(`https://pokeapi.co/api/v2/pokemon/${pokemonName}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        setPokemon(data);
        setEstado("ok");
      })
      .catch((e) => {
        setError(e.message);
        setEstado("error");
      });
  }, [pokemonName]);

  if (estado === "cargando") {
    return React.createElement(
      "div",
      { className: "card" },
      React.createElement("p", { className: "loading" }, "⚡ Cargando Pokémon...")
    );
  }

  if (estado === "error") {
    return React.createElement(
      "div",
      { className: "card" },
      React.createElement("div", { className: "error" }, `Error: ${error}`)
    );
  }

  // Helper para crear stat bars
  const createStatBar = (label, value) => {
    const maxStat = 255;
    const percentage = (value / maxStat) * 100;
    
    return React.createElement(
      "div",
      { className: "stat-bar" },
      React.createElement("span", { className: "stat-label" }, label),
      React.createElement(
        "div",
        { className: "stat-value" },
        React.createElement("div", {
          className: "stat-fill",
          style: { width: `${percentage}%` }
        })
      ),
      React.createElement("span", null, value)
    );
  };

  return React.createElement(
    "div",
    { className: "card" },
    React.createElement("h1", null, "🚀 Zero-build React - Deploy en 3 segundos!"),
    React.createElement(
      "div",
      { className: "pokemon-info" },
      pokemon?.sprites?.front_default
        ? React.createElement("img", {
            src: pokemon.sprites.front_default,
            alt: pokemon.name,
            width: 128,
            height: 128,
            className: "pokemon-sprite"
          })
        : null,
      React.createElement(
        "div",
        null,
        React.createElement("h2", null, pokemon.name.toUpperCase()),
        React.createElement("p", null, `#${pokemon.id} - ${pokemon.types.map(t => t.type.name).join(", ")}`),
        React.createElement("p", null, `Altura: ${pokemon.height / 10}m`),
        React.createElement("p", null, `Peso: ${pokemon.weight / 10}kg`)
      )
    ),
    React.createElement(
      "div",
      { className: "stats" },
      React.createElement("h3", null, "Stats"),
      ...pokemon.stats.map(stat => 
        createStatBar(
          stat.stat.name.replace("-", " ").toUpperCase(),
          stat.base_stat
        )
      )
    ),
    React.createElement(
      "div",
      null,
      React.createElement("h3", null, "Probar otros Pokémon:"),
      React.createElement(
        "div",
        { style: { display: "flex", gap: "8px", flexWrap: "wrap" } },
        ["pikachu", "charizard", "mewtwo", "bulbasaur", "snorlax"].map(name =>
          React.createElement(
            "button",
            {
              key: name,
              onClick: () => setPokemonName(name),
              style: {
                padding: "8px 16px",
                border: "2px solid #667eea",
                borderRadius: "8px",
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
    ),
    React.createElement(
      "div",
      { className: "deploy-info" },
      React.createElement("p", null, "⚡ No hay build. Solo Git push → producción."),
      React.createElement("p", null, `📍 Editá /src/app.js y desplegá instantáneamente.`),
      React.createElement("p", null, `🕐 Último deploy: ${deployTime}`)
    )
  );
}
