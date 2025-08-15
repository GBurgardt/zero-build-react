// server/agents/blog-article-agent-v2/config-openai.mjs
import germanBurgartMode from "./modes/german-burgart.mjs";
import peteKomonMode from "./modes/pete-komon.mjs";

export const availableModes = {
  "german-burgart": germanBurgartMode,
  "pete-komon": peteKomonMode,
};

const config = {
  model: "gpt-5",
  defaultMode: "german-burgart",
  getSystemPrompt: (mode = "german-burgart") => {
    const selected = availableModes[mode];
    if (!selected) {
      console.warn(`[blog-agent-openai] Mode "${mode}" not found, using default`);
      return availableModes["german-burgart"].systemPrompt;
    }
    return selected.systemPrompt;
  },
  getModeInfo: (mode) => {
    const selected = availableModes[mode];
    if (!selected) return null;
    return {
      name: selected.name,
      displayName: selected.displayName,
      description: selected.description,
    };
  },
  getAllModes: () => Object.entries(availableModes).map(([key, mode]) => ({
    value: key,
    label: mode.displayName,
    description: mode.description,
  })),
};

export default config;
