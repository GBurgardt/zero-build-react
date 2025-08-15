// server/agents/pragmatic-doc-agent/memory.mjs
export function createMemory() {
  const store = new Map();
  return {
    clearMemory(id) { store.delete(id); },
    addMessage(id, message) {
      const arr = store.get(id) || [];
      arr.push({ role: message.role, content: String(message.content || "") });
      store.set(id, arr);
    },
    getMessages(id) { return store.get(id) || []; },
  };
}
const memory = createMemory();
export default memory;
