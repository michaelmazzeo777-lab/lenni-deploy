// Provider-neutral visual generation. The credential-free workflow is primary:
// a brief is approved, a prompt packet is exported, the asset is generated
// OUTSIDE the app, then imported with provider/model/cost metadata.
// No provider is ever called automatically; no marketing model name, price,
// quota, or entitlement is assumed — the ACTUAL configured identifiers are
// recorded at import time.

export interface VisualPromptPacket {
  briefId: string;
  kind: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  styleNotes: string;
  costCeiling: number;
  constraints: string[];
  exportedAt: string;
}

export interface VisualProviderResult {
  provider: string;
  model: string;
  jobId: string | null;
  cost: number;
  location: string | null;
}

export interface VisualProvider {
  readonly name: string;
  readonly enabled: boolean;
  preparePacket(input: Omit<VisualPromptPacket, "constraints" | "exportedAt">): VisualPromptPacket;
  // Returns metadata for a generated asset, or throws when the provider cannot
  // run inside the app (manual and disabled providers).
  generate(packet: VisualPromptPacket): Promise<VisualProviderResult>;
}

// Constraints embedded in every exported prompt packet (rights policy).
export const VISUAL_CONSTRAINTS = [
  "Original supporting visual only: graphics, diagrams, charts, storyboards, or generic contextual imagery.",
  "Do NOT imitate GTA VI gameplay, screenshots, UI, menus, maps, or Rockstar/Take-Two branding or typography.",
  "No fake leaks, fake trailers, or fake announcements.",
  "No real-person, developer, or celebrity likeness.",
  "No copyrighted footage, music, or artwork.",
];

function basePacket(
  input: Omit<VisualPromptPacket, "constraints" | "exportedAt">,
): VisualPromptPacket {
  return { ...input, constraints: VISUAL_CONSTRAINTS, exportedAt: new Date().toISOString() };
}

// Deterministic local mock: same brief -> same result. No network, no cost.
export class MockVisualProvider implements VisualProvider {
  readonly name = "mock";
  readonly enabled = true;
  preparePacket(input: Omit<VisualPromptPacket, "constraints" | "exportedAt">) {
    return basePacket(input);
  }
  async generate(packet: VisualPromptPacket): Promise<VisualProviderResult> {
    return {
      provider: this.name,
      model: "mock-visual-deterministic-1",
      jobId: `mock-${packet.briefId}`,
      cost: 0,
      location: `local://mock-visuals/${packet.briefId}.png`,
    };
  }
}

// Manual workflow: the packet is exported; generation happens outside the app;
// the result is imported by a human with real provider/model/cost metadata.
export class ManualVisualProvider implements VisualProvider {
  readonly name = "manual";
  readonly enabled = true;
  preparePacket(input: Omit<VisualPromptPacket, "constraints" | "exportedAt">) {
    return basePacket(input);
  }
  async generate(): Promise<VisualProviderResult> {
    throw new Error(
      "Manual provider does not generate in-app. Export the prompt packet, generate externally, then import the result.",
    );
  }
}

// Disabled adapters for future approved use. They never call any API and throw
// on any attempt. Activation requires Mike's exact approval plus credentials.
class DisabledProvider implements VisualProvider {
  readonly enabled = false;
  constructor(readonly name: string) {}
  preparePacket(input: Omit<VisualPromptPacket, "constraints" | "exportedAt">) {
    return basePacket(input);
  }
  async generate(): Promise<VisualProviderResult> {
    throw new Error(
      `Provider "${this.name}" is DISABLED (APPROVAL_REQUIRED). No account, entitlement, model, price, or quota is assumed. Use the manual workflow.`,
    );
  }
}

export class HiggsfieldProvider extends DisabledProvider {
  constructor() {
    super("higgsfield");
  }
}
export class GeminiImageProvider extends DisabledProvider {
  constructor() {
    super("gemini-image");
  }
}
export class GeminiVideoProvider extends DisabledProvider {
  constructor() {
    super("gemini-video");
  }
}

const PROVIDERS: Record<string, VisualProvider> = {
  mock: new MockVisualProvider(),
  manual: new ManualVisualProvider(),
  higgsfield: new HiggsfieldProvider(),
  "gemini-image": new GeminiImageProvider(),
  "gemini-video": new GeminiVideoProvider(),
};

export function getVisualProvider(name: string): VisualProvider {
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`Unknown visual provider: ${name}`);
  return provider;
}
