// server/agents/pragmatic-doc-agent/invoker-openai.mjs
import OpenAI from "openai";
import config from "./config-openai.mjs";
import memory from "./memory.mjs";
import { v4 as uuidv4 } from "uuid";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || "" });

export async function invokePragmaticDocOpenAI(input) {
  const conversationId = `pragdoc-${uuidv4()}`;
  const systemPrompt = config.getSystemPrompt();

  const userText = `APRENDIZAJE POR EJEMPLO (NO copiar literal títulos/estructura):\n\n<ideal_input>ACA_VA_EL_INPUT_DEL_IDEAL</ideal_input>\n\nOUTPUT IDEAL (patrones a emular):\n\n${input.oneShot || ONE_SHOT}\n\nINPUT ACTUAL (usar SOLO este contenido):\n\n${input.ideaContent}\n\nDIRECCIÓN DEL USUARIO (opcional):\n${input.direction || "(sin dirección)"}`;

  const messages = [
    { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
    { role: "user", content: [{ type: "input_text", text: userText }] },
  ];

  // @ts-ignore Responses API
  const resp = await openai.responses.create({
    model: config.model,
    input: messages,
    text: { format: { type: "text" }, verbosity: "medium" },
    reasoning: { effort: "high", summary: "auto" },
    store: true,
    max_output_tokens: 20000,
  });

  const text = resp.output_text || (resp.output && resp.output[0]?.content?.[0]?.text) || "";
  const extract = (t, tag) => {
    const m = String(t || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\/${tag}>`, "i"));
    return m ? m[1].trim() : null;
  };
  const document = extract(text, "pragmatic_document") || undefined;
  const json = extract(text, "json_output") || undefined;
  return { fullResponse: text, document, json };
}

// Placeholder; the caller can inject oneShot extracted from the config
const ONE_SHOT = "";
