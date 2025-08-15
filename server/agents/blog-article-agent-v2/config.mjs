// server/agents/blog-article-agent-v2/config.mjs
import germanBurgartMode from "./modes/german-burgart.mjs";

export const availableModes = {
  "german-burgart": germanBurgartMode,
};

const config = {
  model: "claude-opus-4-1-20250805",
  defaultMode: "german-burgart",
  getSystemPrompt: (mode = "german-burgart") => {
    const selected = availableModes[mode];
    if (!selected) {
      console.warn(`[blog-agent] Mode "${mode}" not found, using default`);
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
