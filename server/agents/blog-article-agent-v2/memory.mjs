// server/agents/blog-article-agent-v2/memory.mjs

/** In-memory conversation store for blog article agent */
class Memory {
  constructor() {
    this.conversations = new Map();
  }
  addMessage(conversationId, message) {
    if (!this.conversations.has(conversationId)) {
      this.conversations.set(conversationId, { messages: [] });
    }
    const conversation = this.conversations.get(conversationId);
    conversation.messages.push({ role: message.role, content: String(message.content || "") });
  }
  getMessages(conversationId) {
    const conversation = this.conversations.get(conversationId);
    return conversation ? [...conversation.messages] : [];
  }
  clearMemory(conversationId) {
    this.conversations.delete(conversationId);
  }
  clearAll() {
    this.conversations.clear();
  }
  getConversationCount() {
    return this.conversations.size;
  }
}

const memory = new Memory();
export default memory;
