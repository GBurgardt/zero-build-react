// server/agents/blog-article-agent-v2/invoker.mjs
import Anthropic from "@anthropic-ai/sdk";
import config from "./config.mjs";
import memory from "./memory.mjs";
import messageBuilder from "./messageBuilder.mjs";
import { v4 as uuidv4 } from "uuid";

const DEBUG_MODE = process.env.BLOG_AGENT_DEBUG === "true" || false;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "", timeout: 20 * 60 * 1000, maxRetries: 1 });
const debug = (...args) => { if (DEBUG_MODE) console.log("[BlogArticleAgent]", ...args); };

const extractSection = (content, tagName) => {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, "i");
  const match = String(content || "").match(regex);
  return match ? match[1].trim() : null;
};

export async function invokeBlogAgent(inputs, streamCallback = null) {
  console.log("\n====================================================");
  console.log("📝 BLOG ARTICLE AGENT INVOCATION STARTED");
  console.log("📝 Streaming enabled:", !!streamCallback);
  console.log("====================================================\n");

  const conversationId = `blog-article-${inputs.ideaId || uuidv4()}`;
  const mode = inputs.mode || config.defaultMode;

  if (!inputs.ideaContent) {
    return {
      fullResponse:
        "<internal_monologue>Error: No idea content provided.</internal_monologue><blog_article>Error: No content to process.</blog_article>",
      article: "Error: No content to process.",
      monologue: "Error: No idea content provided.",
    };
  }

  try {
    memory.clearMemory(conversationId);

    let userMessageContent = `Here is the idea/thought to transform into a blog article:\n\n${inputs.ideaContent}`;
    if (inputs.selectedIdea) {
      userMessageContent += `\n\nIMPORTANT: Base your article on this specific angle that was selected:\n\nTitle: ${inputs.selectedIdea.title}\nAngle: ${inputs.selectedIdea.angle}\nOpening Hook: ${inputs.selectedIdea.hook}\nKey Takeaway: ${inputs.selectedIdea.keyTakeaway}`;
    }
    if (inputs.userDirection) {
      userMessageContent += `\n\nUSER'S CREATIVE DIRECTION:\n${inputs.userDirection}\n\nPlease ensure the article respects this direction while maintaining the distinctive style of the current mode.`;
    }
    userMessageContent += `\n\nPlease ${inputs.selectedIdea ? "create a blog article that follows this specific angle" : "analyze this content and create a blog article"} while maintaining the distinctive style defined for this mode.`;

    const targetLanguage = inputs.language || "en";
    userMessageContent += `\n\nMANDATORY LANGUAGE REQUIREMENT:\nYou MUST generate ALL output in ${targetLanguage === "es" ? "Spanish" : "English"}.\nThis is non-negotiable. Every word, sentence, title, and paragraph must be in ${targetLanguage === "es" ? "Spanish" : "English"}.\nDO NOT mix languages. DO NOT use any other language.\nThe entire response, including the internal monologue and blog article, must be in ${targetLanguage === "es" ? "Spanish" : "English"}.`;

    memory.addMessage(conversationId, { role: "user", content: userMessageContent });
    const messages = messageBuilder.buildMessages(memory.getMessages(conversationId));

    let responseText = "";
    
    // If streaming is requested
    if (streamCallback) {
      console.log("[Claude] Streaming mode enabled");
      const stream = await anthropic.messages.create({
        model: config.model,
        max_tokens: 32000,
        temperature: 1,
        system: config.getSystemPrompt(mode),
        messages,
        stream: true,
      });
      
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta?.text) {
          const chunkText = chunk.delta.text;
          responseText += chunkText;
          await streamCallback(chunkText);
        }
      }
    } else {
      // Non-streaming version
      console.log("[Claude] Non-streaming mode");
      const response = await anthropic.messages.create({
        model: config.model,
        max_tokens: 32000,
        temperature: 1,
        system: config.getSystemPrompt(mode),
        messages,
      });
      responseText = response.content?.[0]?.type === "text" ? response.content[0].text : "";
    }

    if (!responseText) {
      return {
        fullResponse: "<internal_monologue>Error: Empty response.</internal_monologue><blog_article>Error: Empty response.</blog_article>",
        article: "Error: Empty response.",
        monologue: "Error: Empty response.",
      };
    }

    const monologue = extractSection(responseText, "internal_monologue");
    const article = extractSection(responseText, "blog_article");
    if (!monologue && !article) {
      return { fullResponse: responseText, article: "Error: Malformed response - missing article section.", monologue: "Error: Malformed response - missing monologue section." };
    }
    return { fullResponse: responseText, article: article || "", monologue: monologue || "" };
  } catch (error) {
    return {
      fullResponse: `<internal_monologue>Error: ${error?.message || error}</internal_monologue><blog_article>Error generating article: ${error?.message || error}</blog_article>`,
      article: `Error generating article: ${error?.message || error}`,
      monologue: `Error: ${error?.message || error}`,
    };
  } finally {
    memory.clearMemory(conversationId);
  }
}
