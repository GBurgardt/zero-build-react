// server/agents/blog-article-agent-v2/messageBuilder.mjs

class MessageBuilder {
  buildMessages(messages) {
    return messages.map((m) => ({ role: m.role, content: String(m.content || "") }));
  }
  formatMessage(role, content) {
    return { role, content: String(content || "") };
  }
  truncateMessages(messages, maxLength) {
    let total = 0;
    const out = [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const len = (messages[i].content || "").length;
      if (total + len <= maxLength) {
        out.unshift(messages[i]);
        total += len;
      } else {
        break;
      }
    }
    return out;
  }
}
const messageBuilder = new MessageBuilder();
export default messageBuilder;
