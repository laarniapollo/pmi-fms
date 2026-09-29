import "server-only";

import { GEMINI_RESPONSE_SCHEMA } from "./gemini-schema";
import type { VendorOption } from "./match-vendor";
import { buildTaskText, SYSTEM_INSTRUCTION } from "./prompt";

/**
 * Every Gemini-specific byte in the application lives in this file.
 *
 * Nothing above it knows the wire format, the header name, the envelope shape
 * or the failure vocabulary — they see `callGemini` and a discriminated result.
 * That is the containment for the risk this design accepted when it chose plain
 * `fetch` over the SDK: if Google changes the protocol, or we later adopt
 * `@google/genai`, the change stops here.
 *
 * `import "server-only"` on line 1 is the boundary marker used throughout this
 * repo (`lib/storage.ts:1`, `lib/auth/session.ts:1`). It is what turns an
 * accidental import from a client component into a build error rather than a
 * leaked API key. There is no `NEXT_PUBLIC_` variable anywhere in this codebase
 * and this must not become the first one.
 */

const DEFAULT_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * The upstream deadline. `maxDuration` would not help here — it is a Vercel
 * platform hint, and a self-hosted Node server would sit on a hung socket
 * indefinitely without this.
 */
const UPSTREAM_TIMEOUT_MS = 45_000;

export type GeminiFailureReason =
  | "not-configured"
  | "network"
  | "timeout"
  | "rate-limited"
  | "upstream"
  | "rejected"
  | "blocked"
  | "truncated";

export interface GeminiRequest {
  /** The uploaded document, base64 without a data: prefix. */
  data: string;
  mimeType: string;
  vendors: readonly VendorOption[];
  /**
   * A previous reply that would not parse. Set only for the single repair
   * attempt — it asks for the same content back as bare JSON, nothing more.
   */
  repairFrom?: string;
  signal?: AbortSignal;
}

export type GeminiResult =
  | { ok: true; text: string; model: string }
  | {
      ok: false;
      reason: GeminiFailureReason;
      /** For the server log only. May contain upstream detail. */
      detail: string;
      retryAfterSeconds?: number;
    };

/**
 * Whether the server can scan at all. Read at request time rather than at
 * module load so the page and the route always agree with the environment they
 * are actually running in.
 */
export function isScanConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_MODEL?.trim());
}

export function scanModelId(): string {
  return process.env.GEMINI_MODEL?.trim() ?? "";
}

export async function callGemini(request: GeminiRequest): Promise<GeminiResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = scanModelId();
  if (!apiKey || !model) {
    return { ok: false, reason: "not-configured", detail: "GEMINI_API_KEY or GEMINI_MODEL is unset" };
  }

  const base = process.env.GEMINI_API_BASE?.trim() || DEFAULT_API_BASE;
  const url = `${base}/models/${encodeURIComponent(model)}:generateContent`;
  const body = JSON.stringify(buildBody(request));

  // One retry, and only for faults that a second attempt can plausibly fix: a
  // dropped connection or an upstream 5xx. A 4xx is a statement about the
  // request and will fail identically, and repeating a 429 is what turns a
  // rate limit into a longer one.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await attemptCall(url, apiKey, body, model, request.signal);

    const retryable = !outcome.ok && (outcome.reason === "network" || outcome.reason === "upstream");
    if (!retryable || attempt === 1) return outcome;

    // Jitter so a burst of clerks retrying does not arrive in lockstep.
    await sleep(700 + Math.random() * 600);
  }

  return { ok: false, reason: "network", detail: "exhausted attempts" };
}

async function attemptCall(
  url: string,
  apiKey: string,
  body: string,
  model: string,
  callerSignal: AbortSignal | undefined,
): Promise<GeminiResult> {
  const timeout = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        // Header rather than `?key=`, so the key never reaches an access log,
        // a proxy trace or an error report that echoes the URL.
        "x-goog-api-key": apiKey,
        "content-type": "application/json",
      },
      body,
      signal,
      cache: "no-store",
    });
  } catch (error) {
    if (timeout.aborted) return { ok: false, reason: "timeout", detail: "upstream timed out" };
    // A caller-side abort is the browser going away, not a fault.
    if (callerSignal?.aborted) return { ok: false, reason: "network", detail: "cancelled" };
    return { ok: false, reason: "network", detail: describe(error) };
  }

  if (!response.ok) {
    const detail = (await safeText(response)).slice(0, 800);

    if (response.status === 429) {
      return {
        ok: false,
        reason: "rate-limited",
        detail,
        retryAfterSeconds: retryAfter(response.headers.get("retry-after")),
      };
    }
    if (response.status >= 500) return { ok: false, reason: "upstream", detail };
    return { ok: false, reason: "rejected", detail };
  }

  let envelope: unknown;
  try {
    envelope = await response.json();
  } catch (error) {
    return { ok: false, reason: "upstream", detail: describe(error) };
  }

  return readEnvelope(envelope, model);
}

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

function buildBody(request: GeminiRequest) {
  const parts: Array<Record<string, unknown>> = [
    // Document first, instruction second. The file is the bulk of the prompt
    // and putting it first keeps the instruction as the most recent thing read.
    { inlineData: { mimeType: request.mimeType, data: request.data } },
    { text: buildTaskText(request.vendors) },
  ];

  if (request.repairFrom) {
    parts.push({
      text: `Your previous reply could not be parsed as JSON. Return the same content again as a single JSON object matching the schema, with no explanation, no commentary and no code fences.\n\nPrevious reply:\n${request.repairFrom.slice(0, 4000)}`,
    });
  }

  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: "user", parts }],
    generationConfig: {
      // Transcription has one right answer; sampling can only move away from it.
      temperature: 0,
      /*
       * Thinking tokens are charged against this budget, and this model thinks
       * by default — a two-line test document spent 734 tokens reasoning to
       * produce 174 tokens of answer. Truncation does not arrive as a clean
       * error either; it comes back as `MAX_TOKENS` with half a JSON object.
       * Hence both the raised ceiling and the lowered thinking level below.
       */
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
      responseSchema: GEMINI_RESPONSE_SCHEMA,
      /*
       * Reading characters off a page is not a reasoning task, and the live
       * comparison showed identical extractions with thinking at "low" and
       * zero thought tokens spent. Note this is `thinkingLevel`: the older
       * `thinkingBudget: 0` spelling is rejected outright by this model.
       */
      thinkingConfig: { thinkingLevel: "low" },
    },
  };
}

/**
 * Pulls the reply text out of the envelope.
 *
 * A blocked or truncated response is still a well-formed 200 with no usable
 * text, so every step here is checked rather than indexed into. Reaching
 * straight for `candidates[0].content.parts[0].text` throws on exactly the
 * responses we most need to report properly.
 */
function readEnvelope(envelope: unknown, model: string): GeminiResult {
  if (!isRecord(envelope)) return { ok: false, reason: "upstream", detail: "reply was not an object" };

  const blockReason = isRecord(envelope.promptFeedback)
    ? envelope.promptFeedback.blockReason
    : undefined;
  if (typeof blockReason === "string") {
    return { ok: false, reason: "blocked", detail: `prompt blocked: ${blockReason}` };
  }

  const candidates = envelope.candidates;
  const candidate = Array.isArray(candidates) ? candidates[0] : undefined;
  if (!isRecord(candidate)) return { ok: false, reason: "blocked", detail: "no candidate returned" };

  const finishReason = typeof candidate.finishReason === "string" ? candidate.finishReason : "";
  if (finishReason === "MAX_TOKENS") {
    return { ok: false, reason: "truncated", detail: "reply hit the output limit" };
  }

  const content = isRecord(candidate.content) ? candidate.content : undefined;
  const parts = content && Array.isArray(content.parts) ? content.parts : [];

  const text = parts
    .filter(isRecord)
    // A thinking model can return its reasoning as a part alongside the answer.
    .filter((part) => part.thought !== true)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (text === "") {
    return {
      ok: false,
      reason: finishReason && finishReason !== "STOP" ? "blocked" : "upstream",
      detail: `no text in reply (finishReason: ${finishReason || "none"})`,
    };
  }

  return { ok: true, text, model };
}

// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
