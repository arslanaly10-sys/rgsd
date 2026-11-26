/* Canonical message format (Anthropic Messages API shape) used by every provider, including the mock. */

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };
export type ImageBlock = { type: "image"; source: { type: "base64"; media_type: string; data: string } };
export type DocumentBlock = { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ImageBlock | DocumentBlock;

export type Message = { role: "user" | "assistant"; content: string | ContentBlock[] };

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };

export type CompletionRequest = {
  model: "smart" | "fast";
  system: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** Force a specific tool (structured extraction). */
  toolChoice?: { type: "tool"; name: string };
  /** Extra hints for the mock provider (ignored by real models). */
  mockHints?: { agent: string; locale: "en" | "ar" };
};

export type CompletionResponse = {
  content: (TextBlock | ToolUseBlock)[];
  stopReason: "end_turn" | "tool_use" | "max_tokens" | "other";
  model: string;
  usage: { input: number; output: number };
  mode: "mock" | "live";
};

export interface Provider {
  complete(req: CompletionRequest): Promise<CompletionResponse>;
}
