import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { mockProvider } from "./mock";
import type { CompletionRequest, CompletionResponse, Provider } from "./types";

export const aiMode = (): "mock" | "live" => (process.env.AI_MODE === "live" ? "live" : "mock");

const modelId = (tier: "smart" | "fast") =>
  tier === "smart" ? process.env.AI_MODEL_SMART || "claude-opus-5-5" : process.env.AI_MODEL_FAST || "claude-haiku-5-5";

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  if (client) return client;
  if ((process.env.AI_PROVIDER ?? "anthropic") === "gateway") {
    // Vercel AI Gateway exposes an Anthropic-compatible endpoint.
    client = new Anthropic({ apiKey: process.env.AI_GATEWAY_API_KEY, baseURL: process.env.AI_GATEWAY_BASE_URL || "https://ai-gateway.vercel.sh" });
  } else {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const liveProvider: Provider = {
  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const primary = modelId(req.model);
    const fallback = req.model === "smart" ? modelId("fast") : null;
    const call = async (model: string) => {
      const res = await anthropic().messages.create({
        model,
        max_tokens: req.maxTokens ?? 2048,
        system: req.system,
        // Our block types mirror the Messages API exactly.
        messages: req.messages as unknown as Anthropic.MessageParam[],
        tools: req.tools as unknown as Anthropic.Tool[] | undefined,
        ...(req.toolChoice ? { tool_choice: req.toolChoice } : {}),
      });
      return {
        content: res.content.filter((b) => b.type === "text" || b.type === "tool_use") as CompletionResponse["content"],
        stopReason: (["end_turn", "tool_use", "max_tokens"].includes(String(res.stop_reason)) ? res.stop_reason : "other") as CompletionResponse["stopReason"],
        model: res.model,
        usage: { input: res.usage.input_tokens, output: res.usage.output_tokens },
        mode: "live" as const,
      };
    };
    try {
      return await call(primary);
    } catch (e) {
      // Overload / unavailable: fall back once to the fast model.
      const status = (e as { status?: number }).status;
      if (fallback && (status === 429 || status === 529 || (status ?? 0) >= 500)) return call(fallback);
      throw e;
    }
  },
};

export function provider(): Provider {
  return aiMode() === "live" ? liveProvider : mockProvider;
}

/** Approximate cost; set AI_PRICE_*_PER_MTOK to your contract prices (USD per million tokens). */
export function estimateCost(model: string, input: number, output: number) {
  const fast = /haiku/i.test(model);
  const pin = Number(process.env[fast ? "AI_PRICE_FAST_IN_PER_MTOK" : "AI_PRICE_SMART_IN_PER_MTOK"] ?? 0);
  const pout = Number(process.env[fast ? "AI_PRICE_FAST_OUT_PER_MTOK" : "AI_PRICE_SMART_OUT_PER_MTOK"] ?? 0);
  return (input * pin + output * pout) / 1_000_000;
}
