// AI provider abstraction (docs/05_AI_CONTENT_ENGINE.md).

export interface AISourceRecord {
  id: string;
  title: string;
  publisher: string;
  sourceClass: string;
  factualAsOfDate: string | null;
  // Sanitized excerpt. Treated strictly as untrusted DATA, never instructions.
  excerpt: string;
}

export interface AIClaimRecord {
  id: string;
  statement: string;
  classification: string; // never LEAKED — filtered upstream
  publicWording: string | null;
  sourceIds: string[];
}

export interface AIExecutionContext {
  taskType: string;
  contentId: string | null;
  currentAsOf: string; // ISO date
  allowedSources: AISourceRecord[];
  allowedClaims: AIClaimRecord[];
  prohibitedAssertions: string[];
  spoilerLevel: string;
  disclaimer: string;
  editorialTone: string;
  requestedByUserId: string;
  workingTitle: string;
  viewerPromise: string;
  // Optional workspace prompt-template text. APPENDED after the fixed safety
  // rules — it can add editorial guidance but never replaces the base rules.
  systemExtension?: string;
}

export interface AIUsage {
  tokens?: number;
  estimatedCost?: number;
}

export interface AIResult {
  provider: string;
  model: string;
  // Raw model text (JSON string). Validation happens downstream.
  rawText: string;
  usage: AIUsage;
}

export interface AIProvider {
  readonly name: string;
  generateContentPacket(context: AIExecutionContext): Promise<AIResult>;
}
