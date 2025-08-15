// server/agents/blog-article-agent-v2/invoker-openai.mjs
import OpenAI from "openai";
import config from "./config-openai.mjs";
import memory from "./memory.mjs";
import messageBuilder from "./messageBuilder.mjs";
import { v4 as uuidv4 } from "uuid";

const DEBUG_MODE = process.env.BLOG_AGENT_DEBUG === "true" || false;
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
  timeout: 20 * 60 * 1000,
  maxRetries: 1,
});
const debug = (...args) => { if (DEBUG_MODE) console.log("[BlogArticleAgent-OpenAI]", ...args); };

const extractSection = (content, tagName) => {
  const regex = new RegExp(`<${tagName}>([\\s\\S]*?)<\/${tagName}>`, "i");
  const match = String(content || "").match(regex);
  return match ? match[1].trim() : null;
};

const callGPT5 = async (messagesForApi, mode, streamCallback = null) => {
  const modelToUse = config.model;
  console.log("\n====================================================");
  console.log(`📡 CALLING GPT-5 API with model (${modelToUse})...`);
  console.log(`📝 Using mode: ${mode}`);
  console.log(`📝 Streaming: ${!!streamCallback}`);
  console.log("====================================================\n");
  try {
    debug("🔧 Preparing messages for GPT-5 API call...");
    const systemPromptToUse = config.getSystemPrompt(mode);
    const messages = messageBuilder.buildMessages(messagesForApi);

    const enhancedSystemPrompt = `${systemPromptToUse}

CRITICAL FORMATTING REQUIREMENT:
You MUST structure your response with EXACTLY these two XML tags:

<internal_monologue>
[Your internal exploration here - minimum 50 numbered lines]
</internal_monologue>

<blog_article>
[Your complete blog article here]
</blog_article>

DO NOT output any text outside of these tags. The response MUST start with <internal_monologue> and end with </blog_article>.`;

    const gpt5Input = [
      { role: "system", content: [{ type: "input_text", text: enhancedSystemPrompt }] },
      ...messages.map((msg) => ({ role: msg.role, content: [{ type: "input_text", text: msg.content }] })),
    ];

    // Convert messages for Chat Completions API
    const chatMessages = [
      { role: "system", content: enhancedSystemPrompt },
      ...messages.map((msg) => ({ role: msg.role, content: msg.content }))
    ];
    
    // If streaming is requested
    if (streamCallback) {
      const completionParams = {
        model: modelToUse,
        messages: chatMessages,
        temperature: 1,
        stream: true,
      };
      
      // Use max_completion_tokens for GPT-5, max_tokens for others
      if (modelToUse.includes('gpt-5')) {
        completionParams.max_completion_tokens = 16384;
      } else {
        completionParams.max_tokens = 16384;
      }
      
      const stream = await openai.chat.completions.create(completionParams);

      let fullContent = "";
      for await (const chunk of stream) {
        const chunkText = chunk.choices[0]?.delta?.content || "";
        fullContent += chunkText;
        if (streamCallback && chunkText) {
          await streamCallback(chunkText);
        }
      }

      return { choices: [{ message: { role: "assistant", content: fullContent } }] };
    } else {
      // Non-streaming version - try Responses API first, fallback to Chat Completions
      try {
        // @ts-ignore OpenAI Responses API
        const response = await openai.responses.create({
          model: modelToUse,
          input: gpt5Input,
          text: { format: { type: "text" }, verbosity: "medium" },
          reasoning: { effort: "high", summary: "auto" },
          tools: [],
          store: true,
          temperature: 1,
          max_output_tokens: 16384,
        });

        const responseText = response.output_text || (response.output && response.output[0]?.content?.[0]?.text) || "";
        return { choices: [{ message: { role: "assistant", content: responseText } }] };
      } catch (error) {
        // Fallback to Chat Completions API if Responses API fails
        console.log("Responses API failed, falling back to Chat Completions API");
        const completionParams = {
          model: modelToUse,
          messages: chatMessages,
          temperature: 1,
        };
        
        // Use max_completion_tokens for GPT-5, max_tokens for others
        if (modelToUse.includes('gpt-5')) {
          completionParams.max_completion_tokens = 16384;
        } else {
          completionParams.max_tokens = 16384;
        }
        
        const response = await openai.chat.completions.create(completionParams);
        
        return { choices: [{ message: response.choices[0].message }] };
      }
    }
  } catch (error) {
    console.error("\n❌ ERROR IN GPT-5 API CALL", error?.message || error);
    throw error;
  }
};

export async function invokeBlogAgent(inputs, streamCallback = null) {
  console.log("\n====================================================");
  console.log("📝 BLOG ARTICLE AGENT (GPT-5) INVOCATION STARTED");
  console.log(`📝 Streaming enabled: ${!!streamCallback}`);
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
    let userMessageContent = "";

    if (inputs.existingArticle && inputs.changeRequests) {
      userMessageContent = `You are in EDITING MODE. You have an existing article that needs to be modified based on user feedback.

EXISTING ARTICLE TO EDIT:

${inputs.existingArticle}

CHANGE REQUESTS FROM USER:

${inputs.changeRequests}

ORIGINAL IDEA/CONTEXT (for reference):

${inputs.ideaContent}

Please apply the requested changes to the article while:
1. Preserving all content not mentioned in the change requests
2. Maintaining the writing style of the current mode (${mode})
3. Ensuring smooth transitions where edits are made
4. Keeping the article coherent and well-structured

Generate the complete updated article with all requested changes applied.`;
    } else {
      userMessageContent = `Here is the idea/thought to transform into a blog article:

${inputs.ideaContent}`;
      if (inputs.selectedIdea) {
        userMessageContent += `

IMPORTANT: Base your article on this specific angle that was selected:

Title: ${inputs.selectedIdea.title}
Angle: ${inputs.selectedIdea.angle}
Opening Hook: ${inputs.selectedIdea.hook}
Key Takeaway: ${inputs.selectedIdea.keyTakeaway}`;
      }
      if (inputs.userDirection) {
        userMessageContent += `

USER'S CREATIVE DIRECTION:
${inputs.userDirection}

Please ensure the article respects this direction while maintaining the distinctive style of the current mode.`;
      }
      userMessageContent += `

Please ${inputs.selectedIdea ? "create a blog article that follows this specific angle" : "analyze this content and create a blog article"} while maintaining the distinctive style defined for this mode.`;
    }

    const targetLanguage = inputs.language || "en";
    userMessageContent += `

MANDATORY LANGUAGE REQUIREMENT:
You MUST generate ALL output in ${targetLanguage === "es" ? "Spanish" : "English"}.
This is non-negotiable. Every word, sentence, title, and paragraph must be in ${targetLanguage === "es" ? "Spanish" : "English"}.
DO NOT mix languages. DO NOT use any other language.
The entire response, including the internal monologue and blog article, must be in ${targetLanguage === "es" ? "Spanish" : "English"}.`;

    memory.addMessage(conversationId, { role: "user", content: userMessageContent });
    const messages = memory.getMessages(conversationId);

    const llmResponse = await callGPT5(messages, mode, streamCallback);
    const assistantMessage = llmResponse.choices?.[0]?.message;
    if (!assistantMessage?.content) {
      return {
        fullResponse:
          "<internal_monologue>Error: Empty response.</internal_monologue><blog_article>Error: Empty response.</blog_article>",
        article: "Error: Empty response.",
        monologue: "Error: Empty response.",
      };
    }

    const responseContent = assistantMessage.content;
    const monologue = extractSection(responseContent, "internal_monologue");
    const article = extractSection(responseContent, "blog_article");

    if (!monologue && !article) {
      if (responseContent.length > 500) {
        return {
          fullResponse: `<internal_monologue>GPT-5 did not provide internal monologue in expected format</internal_monologue><blog_article>${responseContent}</blog_article>`,
          article: responseContent,
          monologue: "GPT-5 did not provide internal monologue in expected format",
        };
      }
      return {
        fullResponse: responseContent,
        article: "Error: Malformed response - missing article section.",
        monologue: "Error: Malformed response - missing monologue section.",
      };
    }

    return { fullResponse: responseContent, article: article || "", monologue: monologue || "" };
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
