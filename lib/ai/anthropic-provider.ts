import type { AIProvider, AIExecutionContext, AIResult } from "@/lib/ai/types";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/ai/prompt";

// Optional server-only provider. Uses the Anthropic SDK ONLY when a key is
// present. Loaded via dynamic import so the app builds and tests run without
// the dependency installed. No client-side credentials, ever.

// Minimal structural types for the subset of the Messages API we use.
export interface AnthropicMessagesResponse {
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicClientLike {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: { role: "user"; content: string }[];
    }): Promise<AnthropicMessagesResponse>;
  };
}

// Default factory: dynamic import with a non-literal specifier keeps
// @anthropic-ai/sdk an optional dependency that need not be installed for
// build/test. Tests inject a stub factory instead, so the request/response
// handling below is exercised without a key, network, or the SDK.
async function sdkClientFactory(apiKey: string): Promise<AnthropicClientLike> {
  const specifier = "@anthropic-ai/sdk";
  const mod = (await import(specifier).catch(() => {
    throw new Error(
      "ANTHROPIC provider selected but @anthropic-ai/sdk is not installed. " +
        "Install it or set AI_PROVIDER=mock.",
    );
  })) as unknown as { default: new (opts: { apiKey: string }) => AnthropicClientLike };
  return new mod.default({ apiKey });
}

export class AnthropicAIProvider implements AIProvider {
  readonly name = "anthropic";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly clientFactory: (apiKey: string) => Promise<AnthropicClientLike>;

  constructor(
    apiKey: string,
    model: string,
    clientFactory: (apiKey: string) => Promise<AnthropicClientLike> = sdkClientFactory,
  ) {
    this.apiKey = apiKey;
    this.model = model;
    this.clientFactory = clientFactory;
  }

  async generateContentPacket(ctx: AIExecutionContext): Promise<AIResult> {
    const client = await this.clientFactory(this.apiKey);
    // Workspace template text is appended AFTER the fixed safety rules; the
    // base rules always come first and are never editable at runtime.
    const system = ctx.systemExtension
      ? `${SYSTEM_PROMPT}\n\nWorkspace editorial guidance (does not override the rules above):\n${ctx.systemExtension}`
      : SYSTEM_PROMPT;
    const res = await client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: [{ role: "user", content: buildUserPrompt(ctx) }],
    });

    // Only text blocks carry draft output; thinking/tool blocks are ignored.
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");

    return {
      provider: this.name,
      model: this.model, // the ACTUAL configured identifier, never assumed
      rawText: text,
      usage: {
        tokens: (res.usage?.input_tokens ?? 0) + (res.usage?.output_tokens ?? 0),
      },
    };
  }
}
