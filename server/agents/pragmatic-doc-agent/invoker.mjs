// server/agents/pragmatic-doc-agent/invoker.mjs
import Anthropic from "@anthropic-ai/sdk";
import config from "./config-openai.mjs";
import { v4 as uuidv4 } from "uuid";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || "", timeout: 20 * 60 * 1000, maxRetries: 1 });

export async function invokePragmaticDocClaude(input) {
  const systemPrompt = config.getSystemPrompt();
  const userText = `APRENDIZAJE POR EJEMPLO (NO copiar literal títulos/estructura):\n\n<ideal_input>ACA_VA_EL_INPUT_DEL_IDEAL</ideal_input>\n\nOUTPUT IDEAL (patrones a emular):\n\n${input.oneShot || ""}\n\nINPUT ACTUAL (usar SOLO este contenido):\n\n${input.ideaContent}\n\nDIRECCIÓN DEL USUARIO (opcional):\n${input.direction || "(sin dirección)"}`;

  const response = await anthropic.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 32000,
    system: systemPrompt,
    messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
    temperature: 0.7,
  });

  const text = response.content?.[0]?.type === "text" ? response.content[0].text : "";
  const extract = (t, tag) => {
    const m = String(t || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, "i"));
    return m ? m[1].trim() : null;
  };
  const document = extract(text, "pragmatic_document") || undefined;
  const json = extract(text, "json_output") || undefined;
  return { fullResponse: text, document, json };
}
