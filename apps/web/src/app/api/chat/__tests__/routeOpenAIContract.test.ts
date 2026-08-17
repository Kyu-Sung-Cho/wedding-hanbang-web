import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { createChatImageObjectPathV2 } from "@/lib/chat/attachmentStorage";
import { AMORA_MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/ai/amoraAttachments";
import { buildCanonicalQuoteAnalysisMessage } from "@/lib/ai/quoteAnalysisSelection";
import { getQuoteCheckItems } from "@/lib/amora/quoteCheck";

type PrivacySnapshotFixture = {
  version: 2;
  privacyEpoch: number;
  actorRole: "bride" | "groom";
  rosterFingerprint: string;
  memory: Record<
    "shared" | "bride_private" | "groom_private",
    { enabled: boolean; resetAt: string | null }
  >;
  personalization: {
    exists: boolean;
    revision: number | null;
  };
};

const mocks = vi.hoisted(() => {
  class PersistenceError extends Error {
    readonly code = "AI_MESSAGE_PERSISTENCE_FAILED";
  }
  class ClaimError extends Error {
    readonly code = "CHAT_REQUEST_CLAIM_FAILED";
  }
  class PrivacyContextError extends Error {
    constructor(readonly code:
      | "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
      | "AMORA_PRIVACY_CONTEXT_CHANGED") {
      super(code);
      this.name = "AmoraPrivacyContextError";
    }
  }
  class CostGuardError extends Error {
    readonly code: string;

    constructor(readonly result: {
      allowed: boolean;
      reason?: string;
      message?: string;
    }) {
      super(result.message ?? "AMORA_COST_GUARD_BLOCKED");
      this.name = "AmoraCostGuardError";
      this.code = result.reason === "couple_quota"
        ? "COST_GUARD_COUPLE_QUOTA"
        : result.reason === "global_daily"
          ? "COST_GUARD_GLOBAL_DAILY"
          : result.reason === "global_budget"
            ? "COST_GUARD_GLOBAL_BUDGET"
            : "COST_GUARD_UNAVAILABLE";
    }
  }
  const reserve = vi.fn();
  const providerEgressAuthorizer = vi.fn(async () => undefined);
  const atomicResponses: Array<{
    content: string;
    metadata: Record<string, unknown>;
    expectedPrivacyEpoch: number;
  }> = [];
  const atomicFinalizations: Array<Record<string, unknown>> = [];
  let atomicOutcome: "persisted" | "privacy_context_changed" = "persisted";
  const journal: Array<Record<string, unknown>> = [];
  const loadJournal = vi.fn(async () => journal);
  const buildJournalCheckpoint = vi.fn((callIndex: number, result: {
    toolCalls: unknown[];
    outputItems: unknown[];
  }) => ({
    version: 1,
    callIndex,
    phase: "tool_round",
    toolCalls: result.toolCalls,
    outputItems: result.outputItems,
  }));
  const providerLedger = vi.fn(async (context: {
    userId: string | null;
    coupleId: string | null;
    callIndex: number;
    phase: "tool_round" | "final_no_tool";
    modelRole: string;
    costGuard: Record<string, unknown>;
    onCostReserved?: (result: unknown) => void;
  }, call: (
    beforeGeneration: () => Promise<void>,
    reserveBeforeSideEffect: () => Promise<void>,
    authorizeProviderEgress: typeof providerEgressAuthorizer,
  ) => Promise<unknown>, options?: {
    buildAtomicChatResponse?: (result: unknown) => null | {
      content: string;
      metadata: Record<string, unknown>;
      stageTag: string | null;
      specialistType: string | null;
      visibility: "shared" | "bride_private" | "groom_private";
      expectedPrivacyEpoch: number;
    };
    onAtomicChatResponseFinalized?: (result: unknown) => void;
    buildToolRoundCheckpoint?: (result: unknown) => unknown;
  }) => {
    let reservationPromise: Promise<void> | null = null;
    const beforeGeneration = async () => {
      reservationPromise ??= (async () => {
        const reservation = await reserve({}, context.costGuard);
        if (!reservation.allowed) throw new CostGuardError(reservation);
        context.onCostReserved?.(reservation);
      })();
      await reservationPromise;
    };
    const result = await call(
      beforeGeneration,
      beforeGeneration,
      providerEgressAuthorizer,
    );
    const atomic = options?.buildAtomicChatResponse?.(result) ?? null;
    options?.buildToolRoundCheckpoint?.(result);
    if (atomic) {
      atomicResponses.push({
        content: atomic.content,
        metadata: atomic.metadata,
        expectedPrivacyEpoch: atomic.expectedPrivacyEpoch,
      });
      const finalized = atomicOutcome === "privacy_context_changed"
        ? { outcome: "privacy_context_changed", message: null }
        : {
            outcome: "persisted",
            message: {
              id: "20000000-0000-4000-8000-000000000001",
              createdAt: "2026-07-15T00:00:00.000Z",
              content: atomic.content,
              metadata: atomic.metadata,
              stageTag: atomic.stageTag,
              specialistType: atomic.specialistType,
              visibility: atomic.visibility,
              reused: false,
            },
          };
      atomicFinalizations.push(finalized);
      options?.onAtomicChatResponseFinalized?.(finalized);
    }
    return result;
  });

  return {
    provider: vi.fn(),
    buildMultimodal: vi.fn((text: string) => text),
    mammothExtract: vi.fn(),
    providerLedger,
    providerEgressAuthorizer,
    executeTool: vi.fn(),
    extractSuggestions: vi.fn((text: string) => ({
      cleanText: text,
      suggestions: [] as string[],
    })),
    persist: vi.fn(),
    findPersisted: vi.fn(),
    reconcile: vi.fn(),
    chooseModelRole: vi.fn(() => "fast"),
    buildToolResult: vi.fn((callId: string, output: string) => ({
      type: "function_call_output",
      call_id: callId,
      output,
    })),
    log: vi.fn(),
    completeClaim: vi.fn(),
    claim: vi.fn(),
    failClaim: vi.fn(),
    safeTools: [
      {
        name: "update_budget",
        description: "Update budget",
        input_schema: {
          type: "object",
          properties: { total_budget: { type: "number" } },
          required: ["total_budget"],
        },
      },
      {
        name: "add_schedule_event",
        description: "Add schedule",
        input_schema: {
          type: "object",
          properties: {
            date: { type: "string" },
            title: { type: "string" },
          },
          required: ["date", "title"],
        },
      },
      {
        name: "cancel_schedule_event",
        description: "Cancel schedule",
        input_schema: {
          type: "object",
          properties: {
            event_id: { type: "string" },
            expected_title: { type: "string" },
            expected_date: { type: "string" },
            reason: { type: "string" },
          },
          required: ["event_id", "expected_title", "expected_date"],
        },
      },
      {
        name: "add_amora_action",
        description: "Add one reviewed Amora action",
        input_schema: {
          type: "object",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            due_date: { type: "string" },
            category_key: { type: "string" },
            priority: { type: "string" },
            source: { type: "string" },
            href: { type: "string" },
          },
          required: ["title"],
        },
      },
      { name: "get_wedding_info", description: "Read wedding info", input_schema: {} },
      { name: "analyze_quote", description: "Analyze quote", input_schema: {} },
    ],
    canonicalRows: [] as Array<Record<string, unknown>>,
    canonicalRequestBindingId:
      "00000000-0000-4000-8000-000000000099" as string | null,
    summaryRows: [] as Array<Record<string, unknown>>,
    decisionRows: [] as Array<Record<string, unknown>>,
    journeyRow: {
      progress: {},
      total_budget: 0,
      wedding_date: null,
      venue: null,
    } as Record<string, unknown>,
    activeSegment: null as Record<string, unknown> | null,
    activeSegmentError: null as { code: string; message: string } | null,
    chatHistoryEq: vi.fn(),
    chatHistorySelect: vi.fn(),
    chatHistoryLimit: vi.fn(),
    summaryEq: vi.fn(),
    summarySelect: vi.fn(),
    segmentEq: vi.fn(),
    profileProjectionRows: [] as Array<Record<string, unknown>>,
    profileProjectionError: null as { code: string } | null,
    personalizationRow: null as Record<string, unknown> | null,
    personalizationError: null as { code: string } | null,
    personalizationEq: vi.fn(),
    privacySnapshotSequence: [] as Array<PrivacySnapshotFixture | Error>,
    getPrivacySnapshot: vi.fn(),
    getPrivacyEpoch: vi.fn(),
    assertPrivacySnapshotCurrent: vi.fn(),
    journeyError: null as { code: string; message: string } | null,
    journeyStateRevision: 0 as number | null,
    directoryError: null as { code: string; message: string } | null,
    bookingsError: null as { code: string; message: string } | null,
    summariesError: null as { code: string; message: string } | null,
    decisionsError: null as { code: string; message: string } | null,
    directoryRows: [] as Array<Record<string, unknown>>,
    coupleMemberModelVersion: 1 as 1 | 2,
    coupleMemberModelError: null as { code: string; message: string } | null,
    memoryEnablement: {
      shared: false,
      bride_private: false,
      groom_private: false,
    },
    auxiliaryMemoryRuntimeEnabled: false,
    chatHistoryOr: vi.fn(),
    requestFrom: vi.fn(),
    profileSourceSelect: vi.fn(),
    authenticatedUser: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
    userProfile: {
      couple_id: "10000000-0000-4000-8000-000000000001",
      role: "bride" as "bride" | "groom",
      is_admin: false,
      name: "Test customer",
    },
    signedDemo: false,
    demoSessionToken: "signed-demo-test-token",
    reserve,
    atomicResponses,
    atomicFinalizations,
    get atomicOutcome() {
      return atomicOutcome;
    },
    set atomicOutcome(value: "persisted" | "privacy_context_changed") {
      atomicOutcome = value;
    },
    journal,
    loadJournal,
    buildJournalCheckpoint,
    rateLimit: vi.fn(),
    adminFrom: vi.fn(),
    adminRpc: vi.fn(),
    storageFrom: vi.fn(),
    storageInfo: vi.fn(),
    storageDownload: vi.fn(),
    storageDownloadStream: vi.fn(),
    enqueueMemory: vi.fn(),
    verifyMemoryRepair: vi.fn(),
    resolveScheduleCareFollowUp: vi.fn(),
    PersistenceError,
    ClaimError,
    PrivacyContextError,
    CostGuardError,
  };
});

function queryResult(data: unknown, hooks: {
  onOr?: (value: string) => void;
  onEq?: (column: string, value: unknown) => void;
  onSelect?: (value: string) => unknown;
  onSelectError?: (value: string) => unknown;
  onLimit?: (value: number) => void;
  filterEqColumns?: readonly string[];
} = {}) {
  const result: { data: unknown; error: unknown } = { data, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["neq", "order", "in", "is", "not", "insert"]) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn((value: number) => {
    hooks.onLimit?.(value);
    return query;
  });
  query.eq = vi.fn((column: string, value: unknown) => {
    hooks.onEq?.(column, value);
    if (Array.isArray(result.data) && hooks.filterEqColumns?.includes(column)) {
      result.data = result.data.filter((candidate) => (
        typeof candidate === "object"
        && candidate !== null
        && !Array.isArray(candidate)
        && (candidate as Record<string, unknown>)[column] === value
      ));
    }
    return query;
  });
  query.select = vi.fn((value: string) => {
    const selected = hooks.onSelect?.(value);
    if (selected !== undefined) result.data = selected;
    const error = hooks.onSelectError?.(value);
    if (error !== undefined) result.error = error;
    return query;
  });
  query.or = vi.fn((value: string) => {
    hooks.onOr?.(value);
    return query;
  });
  query.single = vi.fn(async () => result);
  query.maybeSingle = vi.fn(async () => ({
    data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data,
    error: result.error,
  }));
  query.then = (
    resolve: (value: typeof result) => unknown,
    reject?: (reason: unknown) => unknown
  ) => Promise.resolve(result).then(resolve, reject);
  return query;
}

vi.mock("@/lib/supabase/server", () => ({
  createClientFromRequest: vi.fn(async () => ({
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: mocks.authenticatedUser },
      })),
    },
    from: mocks.requestFrom.mockImplementation((table: string) => {
      if (table === "wedding_journeys") {
        return queryResult(
          {
            ...mocks.journeyRow,
            state_revision: mocks.journeyStateRevision,
          },
          { onSelectError: () => mocks.journeyError },
        );
      }
      if (table === "chat_messages") {
        const canonicalRows = mocks.canonicalRows.map((row) => {
          const existingMetadata = typeof row.metadata === "object"
            && row.metadata !== null
            && !Array.isArray(row.metadata)
            ? row.metadata as Record<string, unknown>
            : {};
          if (
            mocks.canonicalRequestBindingId
            && row.role === "user"
            && row.sender_type !== "ai"
            && existingMetadata.target !== "partner"
            && typeof existingMetadata.client_request_id !== "string"
          ) {
            return {
              ...row,
              metadata: {
                ...existingMetadata,
                client_request_id: mocks.canonicalRequestBindingId,
              },
            };
          }
          return row;
        });
        return queryResult(canonicalRows, {
          onOr: mocks.chatHistoryOr,
          onEq: mocks.chatHistoryEq,
          onSelect: mocks.chatHistorySelect,
          onLimit: mocks.chatHistoryLimit,
          filterEqColumns: ["id"],
        });
      }
      if (table === "couple_profile_directory") {
        return queryResult(mocks.directoryRows, {
          onSelectError: () => mocks.directoryError,
        });
      }
      if (table === "couples") {
        return queryResult({
          id: "10000000-0000-4000-8000-000000000001",
          member_model_version: mocks.coupleMemberModelVersion,
        }, {
          onSelectError: () => mocks.coupleMemberModelError,
        });
      }
      if (table === "vendor_bookings") {
        return queryResult([], {
          onSelectError: () => mocks.bookingsError,
        });
      }
      if (table === "chat_summaries") {
        return queryResult(mocks.summaryRows, {
          onEq: mocks.summaryEq,
          onSelect: mocks.summarySelect,
          onSelectError: () => mocks.summariesError,
        });
      }
      if (table === "conversation_segments") {
        return queryResult(mocks.activeSegment, {
          onEq: mocks.segmentEq,
          onSelectError: () => mocks.activeSegmentError,
        });
      }
      if (table === "decision_nodes") {
        return queryResult([], {
          onSelect: (selection) => selection.includes("source_message:chat_messages")
            ? (mocks.profileSourceSelect(), mocks.profileProjectionRows)
            : mocks.decisionRows,
          onSelectError: (selection) => selection.includes("source_message:chat_messages")
            ? mocks.profileProjectionError
            : mocks.decisionsError,
        });
      }
      if (table === "amora_personalization_preferences") {
        return queryResult(mocks.personalizationRow, {
          onEq: mocks.personalizationEq,
          onSelectError: () => mocks.personalizationError,
        });
      }
      return queryResult([]);
    }),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    rpc: mocks.adminRpc,
    storage: {
      from: mocks.storageFrom.mockImplementation(() => ({
        info: mocks.storageInfo,
        download: mocks.storageDownload,
      })),
    },
    from: mocks.adminFrom.mockImplementation((table: string) => {
      if (table === "profiles") {
        return queryResult({
          couple_id: mocks.userProfile.couple_id,
          role: mocks.userProfile.role,
          is_admin: mocks.userProfile.is_admin,
          name: "테스트 고객",
        });
      }
      return queryResult([]);
    }),
  })),
}));

vi.mock("@/utils/rateLimit", () => ({
  rateLimitKey: vi.fn(() => "chat:test"),
  checkRateLimitPersistent: mocks.rateLimit,
}));

vi.mock("@/lib/demoSession", () => ({
  hasSignedDemoSessionFromCookieHeader: vi.fn(() => mocks.signedDemo),
  getCookieValue: vi.fn(() => mocks.demoSessionToken),
}));

vi.mock("@/lib/ai/costGuard", () => ({
  AmoraCostGuardError: mocks.CostGuardError,
  reserveAmoraProviderCall: mocks.reserve,
  reserveAmoraTurn: mocks.reserve,
}));

vi.mock("@/lib/ai/chatMessagePersistence", () => ({
  AiMessagePersistenceError: mocks.PersistenceError,
  findPersistedAiMessage: mocks.findPersisted,
  persistAiMessage: mocks.persist,
}));

vi.mock("@/lib/ai/chatRequestClaim", () => ({
  ChatRequestClaimError: mocks.ClaimError,
  claimChatRequest: mocks.claim,
  reconcileChatRequest: mocks.reconcile,
  completeChatRequest: mocks.completeClaim,
  failChatRequest: mocks.failClaim,
}));

vi.mock("@/lib/ai/openai", () => ({
  chatWithToolsStream: mocks.provider,
  buildToolResultInput: mocks.buildToolResult,
  buildMultimodalContent: mocks.buildMultimodal,
}));

vi.mock("@/lib/ai/modelConfig", () => ({
  chooseAmoraChatModelRole: mocks.chooseModelRole,
}));

vi.mock("@/lib/ai/prompts", () => ({
  getWeddingPlannerSystemPrompt: vi.fn((context: {
    amoraProfiles?: unknown;
    helpPreference?: unknown;
  }) =>
    `system\ncontext=${JSON.stringify(context)}\nprofiles=${JSON.stringify(context.amoraProfiles ?? null)}\nhelpPreference=${JSON.stringify(context.helpPreference ?? null)}`
  ),
}));

vi.mock("@/lib/ai/automaticFeedback", () => ({
  saveAutomaticDissatisfaction: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai/tools", () => ({
  BETA_SAFE_TOOLS: mocks.safeTools,
  WEDDING_TOOLS: mocks.safeTools,
}));

vi.mock("@/lib/ai/amoraProviderCallLedger", () => ({
  runAmoraProviderCallWithLedger: mocks.providerLedger,
}));

vi.mock("@/lib/ai/amoraTurnJournal", () => ({
  loadAmoraToolRoundJournal: mocks.loadJournal,
  buildAmoraToolRoundCheckpoint: mocks.buildJournalCheckpoint,
}));

vi.mock("@/lib/ai/toolExecutor", () => ({ executeTool: mocks.executeTool }));
vi.mock("mammoth", () => ({ extractRawText: mocks.mammothExtract }));
vi.mock("@/lib/ai/chatSuggestions", () => ({
  extractSuggestions: mocks.extractSuggestions,
}));
vi.mock("@/lib/ai/dissatisfaction", () => ({ detectDissatisfaction: vi.fn(() => null) }));
vi.mock("@/lib/ai/stage-router", () => ({
  determineStage: vi.fn(() => "planning_0"),
  routeSpecialist: vi.fn(() => "general"),
  getSpecialistPromptAddon: vi.fn(() => ""),
}));
vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.log,
  startLatencyClock: vi.fn(() => 0),
  elapsedMs: vi.fn(() => 1),
}));
vi.mock("@/lib/ai/summarize", () => ({ maybeSummarize: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/extract-decision", () => ({ maybeExtractDecision: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/classify-excavation", () => ({
  maybeClassifyExcavation: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/amoraMemoryQueue", () => ({
  AmoraPrivacyContextError: mocks.PrivacyContextError,
  getAmoraPrivacyContextSnapshot: mocks.getPrivacySnapshot,
  getAmoraPrivacyEpoch: mocks.getPrivacyEpoch,
  assertAmoraPrivacyContextSnapshotCurrent:
    mocks.assertPrivacySnapshotCurrent,
  enqueueAmoraMemoryJob: mocks.enqueueMemory.mockResolvedValue("disabled"),
  isAuxiliaryMemoryRuntimeEnabled: vi.fn(
    () => mocks.auxiliaryMemoryRuntimeEnabled,
  ),
}));

vi.mock("@/lib/ai/amoraMemoryRepair", () => ({
  verifyAmoraMemoryEnqueueRepairCandidate: mocks.verifyMemoryRepair,
}));

vi.mock("@/lib/care/scheduleCareFollowUp", () => ({
  resolveAmoraScheduleCareFollowUp: mocks.resolveScheduleCareFollowUp,
}));

import { POST } from "@/app/api/chat/route";
import { createClientFromRequest } from "@/lib/supabase/server";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import {
  docxRequiredEntries,
  makeDocxZipFixture,
} from "@/lib/ai/__tests__/docxArchiveFixture";
import { createAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";
import { deriveAmoraQuotaSubjectId } from "@/lib/ai/amoraQuotaSubject";
import { requiresStrictAmoraFirstUseApplicationReplay } from "@/lib/ai/amoraFirstUseDeterministicApplication";
import {
  parseAmoraProviderBackedAddActionApplication,
  parseAmoraProviderBackedAddActionApplicationSource,
  requiresStrictAmoraProviderBackedAddActionApplicationReplay,
  shouldSealAmoraOrdinaryProviderAddActionProposal,
} from "@/lib/ai/amoraProviderBackedAddActionApplication";

const COUPLE_ID = "10000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";
const BUDGET_PENDING_IDENTITY = (() => {
  const { inputDigest, operationKey } = getAmoraToolOperationIdentity(
    "update_budget",
    { total_budget: 30_000_000 },
  );
  return { inputDigest, operationKey };
})();

function request(
  overrides: Record<string, unknown> = {},
  headers: Record<string, string> = {},
  url = "http://localhost/api/chat",
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Sec-Fetch-Site": "same-origin",
      ...headers,
    },
    body: JSON.stringify({
      messages: [{ role: "user", content: "예산을 바꿔줘" }],
      coupleId: COUPLE_ID,
      clientRequestId: REQUEST_ID,
      userMessageId: "30000000-0000-4000-8000-000000000001",
      visibility: "shared",
      ...overrides,
    }),
  });
}

const SCHEDULE_CARE_CARD_ID = "70000000-0000-4000-8000-000000000001";
const SCHEDULE_CARE_QUESTION =
  "실제로 합의된 내용과 아직 의견만 나온 내용을 나눠서 정리해볼까?";
const SCHEDULE_CARE_CANONICAL_PROMPT = [
  "어제 상견례는 잘 마쳤나요? 지금 기억나는 만큼만 편하게 적어주세요.",
  SCHEDULE_CARE_QUESTION,
  "",
  "내 답:",
].join("\n");
const SCHEDULE_CARE_BINDING_METADATA = {
  version: 1,
  card_id: SCHEDULE_CARE_CARD_ID,
  card_revision: 3,
  source_revision: 0,
} as const;

function setBoundSanggyeonryeDAfterPrivateRow(
  userText = "합의한 것과 더 이야기할 것을 나눠보고 싶어.",
): void {
  mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
    id: "30000000-0000-4000-8000-000000000001",
    sender_id: "00000000-0000-4000-8000-000000000001",
    sender_type: "bride",
    role: "user",
    content: `${SCHEDULE_CARE_CANONICAL_PROMPT} ${userText.trim()}`,
    metadata: {
      client_request_id: REQUEST_ID,
      amora_ingest_contract_version: 1,
      ai_response_requested: true,
      provider_attachment_state: "none",
      provider_attachment_count: 0,
      amora_schedule_care_follow_up_v1: SCHEDULE_CARE_BINDING_METADATA,
    },
    visibility: "bride_private",
    created_at: "2026-08-15T00:00:00.000Z",
  });
}

function resolvedSanggyeonryeDAfter() {
  return {
    ok: true as const,
    value: {
      recipientUserId: "00000000-0000-4000-8000-000000000001",
      coupleId: COUPLE_ID,
      actorRole: "bride" as const,
      privacyEpoch: 7,
      binding: {
        cardId: SCHEDULE_CARE_CARD_ID,
        cardRevision: 3,
        sourceRevision: 0,
      },
      expiresAt: "2026-08-15T15:00:00.000Z",
      sourceKey: "schedule:opaque:d_after",
      sourceStateDigest: "a".repeat(64),
      sourceEventId: "event_private_source",
      momentType: "sanggyeonrye" as const,
      attentionWindow: "dAfter" as const,
      eventTitle: "양가 부모님 첫 만남",
      eventDate: "2026-08-14 18:00",
      question: SCHEDULE_CARE_QUESTION,
      prompt: SCHEDULE_CARE_CANONICAL_PROMPT,
    },
  };
}

async function bindCanonicalProviderAttachments(
  attachments: readonly { mediaType: string; base64: string }[],
): Promise<void> {
  const current = mocks.canonicalRows[0];
  if (!current) throw new Error("canonical user row fixture is missing");
  const manifest = attachments.map((attachment) => {
    const bytes = Buffer.from(attachment.base64, "base64");
    return {
      media_type: attachment.mediaType,
      byte_length: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  });
  const imagePaths = (
    await Promise.all(manifest.map((entry, attachmentIndex) => (
      createChatImageObjectPathV2({
        coupleId: COUPLE_ID,
        senderId: mocks.authenticatedUser?.id ?? "",
        clientRequestId: REQUEST_ID,
        attachmentIndex,
        mediaType: entry.media_type,
        sha256: entry.sha256,
      })
    )))
  ).filter((path): path is string => path !== null);
  mocks.canonicalRows[0] = {
    ...current,
    metadata: {
      client_request_id: REQUEST_ID,
      amora_ingest_contract_version: 2,
      ai_response_requested: true,
      provider_attachment_state: "present",
      provider_attachment_count: attachments.length,
      provider_attachment_manifest: manifest,
      ...(imagePaths.length > 0 ? { imagePaths } : {}),
    },
  };
}

function providerResult(overrides: Record<string, unknown> = {}) {
  return {
    fullText: "",
    toolCalls: [],
    outputItems: [],
    stopReason: "completed",
    usageStatus: "complete",
    model: "gpt-5.6-luna",
    ...overrides,
  };
}

function configureDeterministicFirstUseProposal(overrides: {
  promotionId?: string;
  actionId?: string;
  assistantMessageId?: string;
  canonicalActionInput?: {
    action: string;
    reason: string;
    completionCriterion: string;
  };
  outcome?: "persisted" | "replayed";
  messageReused?: boolean;
  finalError?: { code: string; message: string };
  finalMetadata?: Record<string, unknown>;
} = {}) {
  const promotionId = overrides.promotionId
    ?? "a1000000-0000-4000-8000-000000000001";
  const actionId = overrides.actionId
    ?? "a2000000-0000-4000-8000-000000000001";
  const assistantMessageId = overrides.assistantMessageId
    ?? "a3000000-0000-4000-8000-000000000001";
  const issuedAt = Date.now();
  const canonicalActionInput = overrides.canonicalActionInput ?? {
    action: "가능한 예식 시기 두 개 적기",
    reason: "다음 준비의 기준이 필요해요.",
    completionCriterion: "두 사람이 시기 두 개를 확인하면 끝나요.",
  };
  const canonicalAddActionInput = {
    title: canonicalActionInput.action,
    description: `이유: ${canonicalActionInput.reason} 완료 기준: ${canonicalActionInput.completionCriterion}`,
    category_key: "general",
    priority: "medium",
    source: "chat",
  };
  const userText = [
    "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
    `지금 할 한 가지: ${canonicalActionInput.action}`,
    `이유: ${canonicalActionInput.reason}`,
    `완료 기준: ${canonicalActionInput.completionCriterion}`,
    "저장 전에는 확인 카드만 보여줘.",
  ].join("\n");
  const baseTool = mocks.safeTools.find(
    (tool) => tool.name === "add_amora_action",
  )!;
  const pendingAction = extractAmoraPendingAction({
    text: `[pending_action]{"tool":"add_amora_action","input":{}}[/pending_action]`,
    allowedTools: [{
      ...baseTool,
      input_schema: {
        ...baseTool.input_schema,
        "x-amora-bound-input": canonicalAddActionInput,
      },
    }],
    now: issuedAt,
    createActionId: () => actionId,
  }).pendingAction!;
  mocks.canonicalRows[0] = {
    ...mocks.canonicalRows[0],
    content: userText,
    metadata: {
      client_request_id: REQUEST_ID,
      amora_first_use_promotion_id: promotionId,
    },
  };
  mocks.adminRpc.mockImplementation(async (
    name: string,
    args?: Record<string, unknown>,
  ) => {
    if (name === "validate_amora_first_use_action_promotion_v1") {
      return {
        data: {
          version: 1,
          promotionId,
          canonicalActionInput,
          canonicalAddActionInput,
        },
        error: null,
      };
    }
    if (name === "finalize_amora_first_use_action_proposal_v1") {
      if (overrides.finalError) {
        return { data: null, error: overrides.finalError };
      }
      const metadata = {
        client_request_id: args?.p_chat_request_key,
        client_visible_request_id:
          "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000099",
        in_reply_to_user_message_id:
          "30000000-0000-4000-8000-000000000001",
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 0,
        pending_amora_action: pendingAction,
        pending_amora_action_journey_revision: 0,
        amora_first_use_promotion_id: promotionId,
        response_origin: "server_authoritative_first_use_promotion",
        provider_call_count: 0,
        ...overrides.finalMetadata,
      };
      return {
        data: [{
          outcome: overrides.outcome ?? "persisted",
          message_id: assistantMessageId,
          message_created_at: new Date(issuedAt).toISOString(),
          message_content: pendingAction.confirmation,
          message_metadata: metadata,
          message_stage_tag: null,
          message_specialist_type: "general",
          message_visibility: "shared",
          message_reused: overrides.messageReused ?? false,
        }],
        error: null,
      };
    }
    return { data: { authorized: true }, error: null };
  });
  const buildPersistedMessage = () => ({
    id: assistantMessageId,
    createdAt: new Date(issuedAt).toISOString(),
    content: pendingAction.confirmation,
    metadata: {
      client_request_id:
        "chat:00000000-0000-4000-8000-000000000001:09b9af76-f3d4-5f3c-8af6-2f2bddbf16e9",
      client_visible_request_id:
        "chat:00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000099",
      in_reply_to_user_message_id:
        "30000000-0000-4000-8000-000000000001",
      question_scope: "W0_wedding_core",
      memory_eligible: false,
      memory_enqueue_requested: false,
      amora_wedding_context_revision: 0,
      pending_amora_action: pendingAction,
      pending_amora_action_journey_revision: 0,
      amora_first_use_promotion_id: promotionId,
      response_origin: "server_authoritative_first_use_promotion",
      provider_call_count: 0,
    },
    stageTag: null,
    specialistType: "general",
    visibility: "shared" as const,
    reused: true,
  });
  return {
    userText,
    pendingAction,
    promotionId,
    actionId,
    assistantMessageId,
    canonicalAddActionInput,
    buildPersistedMessage,
  };
}

const FIRST_USE_APPLICATION_CONFIRMATION =
  "좋아요. 제안한 변경을 적용해 주세요.";

function configureDeterministicFirstUseApplication(overrides: {
  outcome?: "persisted" | "replayed";
  messageReused?: boolean;
  toolActionId?: string;
  toolHref?: string;
  responseOrigin?: string;
  providerCallCount?: number;
  finalError?: { code: string; message: string };
} = {}) {
  const proposal = configureDeterministicFirstUseProposal({
    promotionId: "90000000-0000-4000-8000-000000000001",
    actionId: "91000000-0000-4000-8000-000000000001",
    assistantMessageId: "92000000-0000-4000-8000-000000000001",
  });
  const receiptMessageId = "93000000-0000-4000-8000-000000000001";
  const confirmationRequestDigest = createHash("sha256")
    .update(
      `amora-confirmed-action-request\0${"30000000-0000-4000-8000-000000000001"}\0${proposal.actionId}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");
  confirmationRequestDigest[12] = "5";
  confirmationRequestDigest[16] = "8";
  const confirmationRequestHex = confirmationRequestDigest.join("");
  const confirmationRequestUuid = [
    confirmationRequestHex.slice(0, 8),
    confirmationRequestHex.slice(8, 12),
    confirmationRequestHex.slice(12, 16),
    confirmationRequestHex.slice(16, 20),
    confirmationRequestHex.slice(20),
  ].join("-");
  const savedActionId = overrides.toolActionId
    ?? `act_${confirmationRequestHex}_${proposal.pendingAction.operationKey.slice(0, 24)}`;
  const sourceMessageCreatedAt = new Date(proposal.pendingAction.issuedAt).toISOString();
  const confirmationMessageCreatedAt = new Date(
    proposal.pendingAction.issuedAt + 1_000,
  ).toISOString();
  const receiptMessageCreatedAt = new Date(
    proposal.pendingAction.issuedAt + 2_000,
  ).toISOString();
  const displayMessage =
    `"${String(proposal.canonicalAddActionInput.title)}"을 아모라 행동 카드로 저장했어요.`;
  const toolResult = {
    toolName: "add_amora_action",
    toolInput: proposal.canonicalAddActionInput,
    toolOutput: {
      action: {
        id: savedActionId,
        title: proposal.canonicalAddActionInput.title,
        description: proposal.canonicalAddActionInput.description,
        dueDate: null,
        categoryKey: null,
        priority: "medium",
        status: "open",
        source: "chat",
        href: overrides.toolHref ?? "/wedding/lounge",
      },
    },
    success: true,
    displayMessage,
  };

  mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
    {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: FIRST_USE_APPLICATION_CONFIRMATION,
      metadata: {
        client_request_id: REQUEST_ID,
        confirmed_amora_action_id: proposal.actionId,
      },
      visibility: "shared",
      created_at: confirmationMessageCreatedAt,
    },
    {
      id: proposal.assistantMessageId,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: proposal.pendingAction.confirmation,
      metadata: {
        client_request_id: "first-use-proposal-request",
        client_visible_request_id: "first-use-proposal-visible-request",
        in_reply_to_user_message_id:
          "95000000-0000-4000-8000-000000000001",
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 0,
        pending_amora_action: proposal.pendingAction,
        pending_amora_action_journey_revision: 0,
        amora_first_use_promotion_id: proposal.promotionId,
        response_origin: "server_authoritative_first_use_promotion",
        provider_call_count: 0,
      },
      visibility: "shared",
      created_at: sourceMessageCreatedAt,
    },
  );
  mocks.adminRpc.mockImplementation(async (
    name: string,
    args?: Record<string, unknown>,
  ) => {
    if (name === "finalize_amora_first_use_action_application_v1") {
      if (overrides.finalError) {
        return { data: null, error: overrides.finalError };
      }
      return {
        data: [{
          outcome: overrides.outcome ?? "persisted",
          tool_result: toolResult,
          message_id: receiptMessageId,
          message_created_at: receiptMessageCreatedAt,
          message_content: displayMessage,
          message_metadata: {
            client_request_id: args?.p_chat_request_key,
            client_visible_request_id:
              `chat:00000000-0000-4000-8000-000000000001:${REQUEST_ID}`,
            in_reply_to_user_message_id:
              "30000000-0000-4000-8000-000000000001",
            confirmed_amora_action_id: proposal.actionId,
            question_scope: "W0_wedding_core",
            memory_eligible: false,
            memory_enqueue_requested: false,
            amora_wedding_context_revision: 0,
            amora_first_use_promotion_id: proposal.promotionId,
            toolResults: [toolResult],
            toolsUsed: ["add_amora_action"],
            persistence_terminal_source: "server_mutation_receipts",
            response_origin:
              overrides.responseOrigin
                ?? "server_authoritative_first_use_action_application",
            provider_call_count: overrides.providerCallCount ?? 0,
          },
          message_stage_tag: null,
          message_specialist_type: "general",
          message_visibility: "shared",
          message_reused: overrides.messageReused ?? false,
        }],
        error: null,
      };
    }
    return { data: { authorized: true }, error: null };
  });

  return {
    ...proposal,
    displayMessage,
    receiptMessageId,
    savedActionId,
    toolResult,
    buildPersistedMessage: () => ({
      id: receiptMessageId,
      createdAt: receiptMessageCreatedAt,
      content: displayMessage,
      metadata: {
        client_request_id:
          `chat:00000000-0000-4000-8000-000000000001:${confirmationRequestUuid}`,
        client_visible_request_id:
          `chat:00000000-0000-4000-8000-000000000001:${REQUEST_ID}`,
        in_reply_to_user_message_id:
          "30000000-0000-4000-8000-000000000001",
        confirmed_amora_action_id: proposal.actionId,
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 0,
        amora_first_use_promotion_id: proposal.promotionId,
        toolResults: [toolResult],
        toolsUsed: ["add_amora_action"],
        persistence_terminal_source: "server_mutation_receipts",
        response_origin:
          overrides.responseOrigin
            ?? "server_authoritative_first_use_action_application",
        provider_call_count: overrides.providerCallCount ?? 0,
      },
      stageTag: null,
      specialistType: "general",
      visibility: "shared" as const,
      reused: true,
    }),
  };
}

function configureProviderBackedAddActionApplication(overrides: {
  outcome?: "persisted" | "replayed";
  messageReused?: boolean;
  responseOrigin?: string;
  providerCallCount?: number;
  sourceSeal?: unknown;
  sourceMetadata?: Record<string, unknown>;
  actionCategoryKey?: "general" | "mc" | "gift";
  actionHref?: string;
  actionTitle?: string;
  actionDescription?: string;
  actionDueDate?: string;
} = {}) {
  const actionId = "a2000000-0000-4000-8000-000000000099";
  const sourceMessageId = "a3000000-0000-4000-8000-000000000099";
  const receiptMessageId = "a4000000-0000-4000-8000-000000000099";
  const issuedAt = Date.now();
  const actionCategoryKey = overrides.actionCategoryKey ?? "general";
  const actionInput = {
    title: overrides.actionTitle ?? "후속 할 일 정리",
    description:
      overrides.actionDescription ?? "두 사람이 확인할 준비 행동",
    category_key: actionCategoryKey,
    priority: "medium",
    source: "chat",
    ...(overrides.actionDueDate === undefined
      ? {}
      : { due_date: overrides.actionDueDate }),
    ...(overrides.actionHref === undefined
      ? {}
      : { href: overrides.actionHref }),
  };
  const pendingAction = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({
      tool: "add_amora_action",
      input: actionInput,
    })}[/pending_action]`,
    allowedTools: mocks.safeTools,
    now: issuedAt,
    createActionId: () => actionId,
  }).pendingAction!;
  const confirmationRequestDigest = createHash("sha256")
    .update(
      `amora-confirmed-action-request\0${"30000000-0000-4000-8000-000000000001"}\0${actionId}`,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)
    .split("");
  confirmationRequestDigest[12] = "5";
  confirmationRequestDigest[16] = "8";
  const confirmationRequestHex = confirmationRequestDigest.join("");
  const confirmationRequestUuid = [
    confirmationRequestHex.slice(0, 8),
    confirmationRequestHex.slice(8, 12),
    confirmationRequestHex.slice(12, 16),
    confirmationRequestHex.slice(16, 20),
    confirmationRequestHex.slice(20),
  ].join("-");
  const savedActionId =
    `act_${confirmationRequestHex}_${pendingAction.operationKey.slice(0, 24)}`;
  const sourceCreatedAt = new Date(issuedAt).toISOString();
  const sourceRequestKey =
    "chat:00000000-0000-4000-8000-000000000001:a6000000-0000-4000-8000-000000000099";
  const confirmationCreatedAt = new Date(issuedAt + 1_000).toISOString();
  const receiptCreatedAt = new Date(issuedAt + 2_000).toISOString();
  const displayMessage = `"${actionInput.title}"을 아모라 행동 카드로 저장했어요.`;
  const toolResult = {
    toolName: "add_amora_action",
    toolInput: actionInput,
    toolOutput: {
      action: {
        id: savedActionId,
        title: actionInput.title,
        description: actionInput.description,
        dueDate: null,
        categoryKey: actionCategoryKey === "general" ? null : actionCategoryKey,
        priority: "medium",
        status: "open",
        source: "chat",
        href: overrides.actionHref
          ?? (actionCategoryKey === "mc" || actionCategoryKey === "gift"
            ? "/wedding/chat"
            : "/wedding/lounge"),
      },
    },
    success: true,
    displayMessage,
  };
  const receiptMetadata = {
    client_request_id:
      `chat:00000000-0000-4000-8000-000000000001:${confirmationRequestUuid}`,
    client_visible_request_id:
      `chat:00000000-0000-4000-8000-000000000001:${REQUEST_ID}`,
    in_reply_to_user_message_id:
      "30000000-0000-4000-8000-000000000001",
    confirmed_amora_action_id: actionId,
    question_scope: "W0_wedding_core",
    memory_eligible: false,
    memory_enqueue_requested: false,
    amora_wedding_context_revision: 0,
    source_amora_action_message_id: sourceMessageId,
    toolResults: [toolResult],
    toolsUsed: ["add_amora_action"],
    persistence_terminal_source: "server_mutation_receipts",
    response_origin:
      overrides.responseOrigin
        ?? "server_authoritative_provider_backed_add_action_application",
    provider_call_count: overrides.providerCallCount ?? 0,
  };

  mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
    {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: FIRST_USE_APPLICATION_CONFIRMATION,
      metadata: {
        client_request_id: REQUEST_ID,
        confirmed_amora_action_id: actionId,
      },
      visibility: "shared",
      created_at: confirmationCreatedAt,
    },
    {
      id: sourceMessageId,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: pendingAction.confirmation,
      metadata: {
        client_request_id: sourceRequestKey,
        in_reply_to_user_message_id:
          "a7000000-0000-4000-8000-000000000099",
        question_scope: "W0_wedding_core",
        memory_eligible: false,
        memory_enqueue_requested: false,
        amora_wedding_context_revision: 0,
        pending_amora_action: pendingAction,
        pending_amora_action_journey_revision: 0,
        amora_add_action_proposal_origin_v1:
          overrides.sourceSeal ?? "ordinary_provider",
        ...overrides.sourceMetadata,
      },
      visibility: "shared",
      created_at: sourceCreatedAt,
    },
  );
  mocks.adminRpc.mockImplementation(async (
    name: string,
    args?: Record<string, unknown>,
  ) => {
    if (name === "finalize_amora_provider_backed_add_action_application_v1") {
      return {
        data: [{
          outcome: overrides.outcome ?? "persisted",
          tool_result: toolResult,
          message_id: receiptMessageId,
          message_created_at: receiptCreatedAt,
          message_content: displayMessage,
          message_metadata: {
            ...receiptMetadata,
            client_request_id: args?.p_chat_request_key,
          },
          message_stage_tag: null,
          message_specialist_type: "general",
          message_visibility: "shared",
          message_reused: overrides.messageReused ?? false,
        }],
        error: null,
      };
    }
    return { data: { authorized: true }, error: null };
  });

  return {
    actionId,
    actionInput,
    displayMessage,
    pendingAction,
    receiptMessageId,
    receiptMetadata,
    savedActionId,
    sourceMessageId,
    sourceRequestKey,
    sourceMessage: {
      id: sourceMessageId,
      content: pendingAction.confirmation,
      metadata: mocks.canonicalRows[1]?.metadata,
      createdAt: sourceCreatedAt,
    },
    toolResult,
    buildPersistedMessage: () => ({
      id: receiptMessageId,
      createdAt: receiptCreatedAt,
      content: displayMessage,
      metadata: receiptMetadata,
      stageTag: null,
      specialistType: "general",
      visibility: "shared" as const,
      reused: true,
    }),
  };
}

function setCanonicalConfirmedBudgetAction(
  actionId: string,
  currentUserText = "응",
) {
  const now = Date.now();
  mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
    {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: currentUserText,
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:01:00.000Z",
    },
    {
      id: "20000000-0000-4000-8000-000000000009",
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "총예산을 3,000만 원으로 바꿀까요?",
      metadata: {
        pending_amora_action: {
          version: 2,
          actionId,
          tool: "update_budget",
          input: { total_budget: 30_000_000 },
          ...BUDGET_PENDING_IDENTITY,
          confirmation:
            "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
          issuedAt: now - 1_000,
          expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
        },
      },
      visibility: "shared",
      created_at: "2026-07-15T00:00:00.000Z",
    },
  );
}

function privacySnapshot(
  overrides: Partial<PrivacySnapshotFixture> = {},
): PrivacySnapshotFixture {
  const personalizationExists = mocks.personalizationRow !== null;
  const personalizationRevision =
    personalizationExists
    && Number.isSafeInteger(mocks.personalizationRow?.revision)
    && (mocks.personalizationRow?.revision as number) >= 1
      ? (mocks.personalizationRow?.revision as number)
      : personalizationExists
        ? 1
        : null;
  return {
    version: 2,
    privacyEpoch: 7,
    actorRole: mocks.userProfile.role,
    rosterFingerprint: "a".repeat(32),
    memory: {
      shared: {
        enabled: mocks.memoryEnablement.shared,
        resetAt: null,
      },
      bride_private: {
        enabled: mocks.memoryEnablement.bride_private,
        resetAt: null,
      },
      groom_private: {
        enabled: mocks.memoryEnablement.groom_private,
        resetAt: null,
      },
    },
    personalization: {
      exists: personalizationExists,
      revision: personalizationRevision,
    },
    ...overrides,
  };
}

function privacyContextError(
  code:
    | "AMORA_PRIVACY_CONTEXT_UNAVAILABLE"
    | "AMORA_PRIVACY_CONTEXT_CHANGED",
) {
  return Object.assign(new Error(code), { code });
}

function persisted(content: string) {
  return {
    id: "20000000-0000-4000-8000-000000000001",
    createdAt: "2026-07-15T00:00:00.000Z",
    content,
    metadata: {},
    stageTag: "planning_0",
    specialistType: null,
    visibility: "shared",
    reused: false,
  };
}

function projectionRow({
  visibility = "shared",
  actor = "bride",
  memoryKey = "venue:preferred_area",
  value = "강남",
  sourceMessage = undefined,
}: {
  visibility?: "shared" | "bride_private" | "groom_private";
  actor?: "bride" | "groom";
  memoryKey?: string;
  value?: string;
  sourceMessage?: Record<string, unknown> | null;
} = {}) {
  const sourceMessageId = actor === "bride"
    ? "30000000-0000-4000-8000-000000000001"
    : "30000000-0000-4000-8000-000000000002";
  return {
    id: `${actor}-${visibility}-${memoryKey}`,
    couple_id: COUPLE_ID,
    visibility,
    memory_key: memoryKey,
    title: "명시한 맞춤 정보",
    chosen_value: { value },
    reasoning: null,
    confidence: 0.9,
    source_message_id: sourceMessageId,
    source_actor_role: actor,
    superseded_at: null,
    metadata: { memory_kind: "preference", explicit: true },
    created_at: "2026-07-15T00:00:00.000Z",
    updated_at: "2026-07-15T00:00:00.000Z",
    source_message: sourceMessage === undefined
      ? {
          id: sourceMessageId,
          couple_id: COUPLE_ID,
          visibility,
          sender_id: actor === "bride"
            ? "00000000-0000-4000-8000-000000000001"
            : "00000000-0000-4000-8000-000000000002",
          sender_type: actor,
          role: "user",
          metadata: null,
        }
      : sourceMessage,
  };
}

function setSensitiveStoredProviderContext(currentUserText: string) {
  mocks.memoryEnablement.shared = true;
  mocks.journeyRow = {
    wedding_date: "2027-05-01",
    total_budget: 44_444_444,
    venue: "PRIVATE_VENUE_SENTINEL",
    progress: {
      __events: [{
        date: "2027-01-01",
        title: "PRIVATE_SCHEDULE_SENTINEL",
      }],
      __preferences: {
        weddingStyle: "PRIVATE_PREFERENCE_SENTINEL",
      },
      venue: { memo: "PRIVATE_PROGRESS_SENTINEL" },
    },
  };
  mocks.directoryRows.splice(0, mocks.directoryRows.length,
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "PRIVATE_BRIDE_SENTINEL",
      role: "bride",
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      name: "PRIVATE_GROOM_SENTINEL",
      role: "groom",
    },
  );
  mocks.summaryRows.push({
    summary: "PRIVATE_SUMMARY_SENTINEL",
    summary_type: "factual",
    visibility: "shared",
    created_at: "2026-07-14T00:00:00.000Z",
    message_count: 2,
    to_message_id: "30000000-0000-4000-8000-000000000099",
  });
  mocks.decisionRows.push(
    {
      category: "venue",
      decision_type: "selection",
      title: "PRIVATE_DECISION_SENTINEL",
      chosen_value: { value: "PRIVATE_DECISION_VALUE_SENTINEL" },
      reasoning: null,
      confidence: 0.9,
      stage_tag: "planning_0",
      source: "test",
      visibility: "shared",
      created_at: "2026-07-13T00:00:00.000Z",
      memory_key: null,
      superseded_at: null,
      metadata: null,
    },
    {
      category: "conflict_resolution",
      decision_type: "agreement",
      title: "PRIVATE_CONFLICT_SENTINEL",
      chosen_value: { value: "PRIVATE_CONFLICT_VALUE_SENTINEL" },
      reasoning: null,
      confidence: 0.9,
      stage_tag: "planning_0",
      source: "test",
      visibility: "shared",
      created_at: "2026-07-12T00:00:00.000Z",
      memory_key: null,
      superseded_at: null,
      metadata: null,
    },
  );
  mocks.profileProjectionRows.push(projectionRow({
    value: "PRIVATE_PROFILE_SENTINEL",
  }));
  mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
    {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: currentUserText,
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:02:00.000Z",
    },
    {
      id: "20000000-0000-4000-8000-000000000099",
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "PRIVATE_ASSISTANT_HISTORY_SENTINEL",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:01:00.000Z",
    },
    {
      id: "30000000-0000-4000-8000-000000000099",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "PRIVATE_USER_HISTORY_SENTINEL",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-15T00:00:00.000Z",
    },
  );
}

// 이 fake들은 chatWithToolsStream의 실제 계약을 모사한다. 실제 구현은
// `beforeProviderEgress` → `inputTokens.count` → `beforeGeneration` →
// `responses.create` 순서이므로(P0-5), fake도 egress gate를 가장 먼저 실행해야
// 라우트의 개인정보 fence가 테스트에서도 진짜와 같은 지점에 걸린다.
function providerAfterPreGeneration(result: ReturnType<typeof providerResult>) {
  mocks.provider.mockImplementationOnce(async (options: {
    beforeProviderEgress?: () => Promise<void>;
    beforeGeneration?: () => Promise<void>;
  }) => {
    await options.beforeProviderEgress?.();
    await options.beforeGeneration?.();
    return result;
  });
}

function providerNetworkAfterPreGeneration(
  result: ReturnType<typeof providerResult>,
) {
  const networkBoundary = vi.fn();
  mocks.provider.mockImplementationOnce(async (options: {
    beforeProviderEgress?: () => Promise<void>;
    beforeGeneration?: () => Promise<void>;
  }) => {
    await options.beforeProviderEgress?.();
    await options.beforeGeneration?.();
    networkBoundary();
    return result;
  });
  return networkBoundary;
}

function providerAcrossBothEgressBoundaries(
  result: ReturnType<typeof providerResult>,
) {
  mocks.provider.mockImplementationOnce(async (options: {
    beforeProviderEgress?: (request: {
      operation: "responses.input_tokens.count" | "responses.create";
      contentBinding: string;
    }) => Promise<void>;
    beforeGeneration?: () => Promise<void>;
  }) => {
    await options.beforeProviderEgress?.({
      operation: "responses.input_tokens.count",
      contentBinding: "c".repeat(64),
    });
    await options.beforeGeneration?.();
    await options.beforeProviderEgress?.({
      operation: "responses.create",
      contentBinding: "d".repeat(64),
    });
    return result;
  });
}

describe("POST /api/chat OpenAI Responses tool-loop contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "false");
    vi.stubEnv("AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED", "false");
    // A privacy fence can reject before chatWithToolsStream consumes a queued
    // one-shot implementation. Do not let that test-only queue leak forward.
    mocks.provider.mockReset();
    mocks.extractSuggestions.mockReset();
    mocks.extractSuggestions.mockImplementation((text: string) => ({
      cleanText: text,
      suggestions: [],
    }));
    mocks.authenticatedUser = { id: "00000000-0000-4000-8000-000000000001" };
    mocks.userProfile = {
      couple_id: COUPLE_ID,
      role: "bride",
      is_admin: false,
      name: "Test customer",
    };
    mocks.activeSegment = {
      id: "60000000-0000-4000-8000-000000000001",
      status: "active",
    };
    mocks.activeSegmentError = null;
    mocks.summaryRows.splice(0);
    mocks.decisionRows.splice(0);
    mocks.journeyRow = {
      progress: {},
      total_budget: 0,
      wedding_date: null,
      venue: null,
    };
    mocks.signedDemo = false;
    mocks.demoSessionToken = "signed-demo-test-token";
    mocks.memoryEnablement = {
      shared: false,
      bride_private: false,
      groom_private: false,
    };
    mocks.auxiliaryMemoryRuntimeEnabled = false;
    mocks.canonicalRequestBindingId = REQUEST_ID;
    mocks.privacySnapshotSequence.splice(0);
    mocks.getPrivacySnapshot.mockReset();
    mocks.getPrivacySnapshot.mockImplementation(async () => {
      const next = mocks.privacySnapshotSequence.shift();
      if (next instanceof Error) throw next;
      return next ?? privacySnapshot();
    });
    mocks.getPrivacyEpoch.mockResolvedValue(7);
    mocks.assertPrivacySnapshotCurrent.mockReset();
    mocks.assertPrivacySnapshotCurrent.mockImplementation((
      initial: PrivacySnapshotFixture,
      current: PrivacySnapshotFixture,
      visibilities: Array<keyof PrivacySnapshotFixture["memory"]>,
    ) => {
      if (
        initial.version !== current.version
        || initial.privacyEpoch !== current.privacyEpoch
        || initial.actorRole !== current.actorRole
        || initial.rosterFingerprint !== current.rosterFingerprint
        || initial.personalization.exists !== current.personalization.exists
        || initial.personalization.revision
          !== current.personalization.revision
      ) {
        throw privacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
      }
      for (const candidate of visibilities) {
        if (
          initial.memory[candidate].enabled
          && (
            !current.memory[candidate].enabled
            || initial.memory[candidate].resetAt
              !== current.memory[candidate].resetAt
          )
        ) {
          throw privacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED");
        }
      }
    });
    mocks.profileProjectionRows.splice(0);
    mocks.atomicResponses.splice(0);
    mocks.atomicFinalizations.splice(0);
    mocks.atomicOutcome = "persisted";
    mocks.journal.splice(0);
    mocks.profileProjectionError = null;
    mocks.personalizationRow = null;
    mocks.personalizationError = null;
    mocks.journeyError = null;
    mocks.journeyStateRevision = 0;
    mocks.directoryError = null;
    mocks.coupleMemberModelVersion = 1;
    mocks.coupleMemberModelError = null;
    mocks.bookingsError = null;
    mocks.summariesError = null;
    mocks.decisionsError = null;
    mocks.directoryRows.splice(0, mocks.directoryRows.length,
      { id: "00000000-0000-4000-8000-000000000001", name: "테스트 신부", role: "bride" },
      { id: "00000000-0000-4000-8000-000000000002", name: "테스트 신랑", role: "groom" },
    );
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.mammothExtract.mockResolvedValue({ value: "정상 문서" });
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 1,
      reclaimed: false,
    });
    mocks.findPersisted.mockResolvedValue(null);
    mocks.reconcile.mockResolvedValue(true);
    mocks.chooseModelRole.mockReturnValue("fast");
    mocks.failClaim.mockResolvedValue(undefined);
    mocks.rateLimit.mockResolvedValue(null);
    mocks.adminRpc.mockImplementation(async (name: string, args?: Record<string, unknown>) => (
      name === "seal_amora_mediation_private_safety_hold"
        ? {
            data: {
              version: 1,
              recipientUserId: args?.p_recipient_user_id,
              coupleId: args?.p_couple_id,
              privacyEpoch: 7,
              active: true,
              expiresAt: "2026-09-13T00:00:00.000Z",
            },
            error: null,
          }
        : { data: { authorized: true }, error: null }
    ));
    mocks.storageInfo.mockReset();
    mocks.storageInfo.mockResolvedValue({
      data: { size: 5, contentType: "image/png" },
      error: null,
    });
    mocks.storageDownloadStream.mockReset();
    mocks.storageDownloadStream.mockResolvedValue({
      data: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hello"));
          controller.close();
        },
      }),
      error: null,
    });
    mocks.storageDownload.mockReset();
    mocks.storageDownload.mockImplementation(() => ({
      asStream: mocks.storageDownloadStream,
    }));
    mocks.verifyMemoryRepair.mockReset();
    mocks.verifyMemoryRepair.mockResolvedValue({ status: "unavailable" });
    mocks.resolveScheduleCareFollowUp.mockReset();
    mocks.resolveScheduleCareFollowUp.mockResolvedValue({
      ok: false,
      reason: "invalid_binding",
    });
    mocks.persist.mockImplementation(async ({ cleanText }: { cleanText: string }) => persisted(cleanText));
    mocks.completeClaim.mockResolvedValue(undefined);
    mocks.executeTool.mockResolvedValue({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { success: true },
      success: true,
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "CANONICAL_DB_USER 우리 결혼 총 예산을 4천만원으로 변경해줘",
      metadata: { client_request_id: REQUEST_ID },
      visibility: "shared",
      created_at: "2026-07-15T00:00:00.000Z",
    });
  });

  it("rejects a cross-site cookie mutation before durable or paid work", async () => {
    const response = await POST(request({}, {
      "Sec-Fetch-Site": "cross-site",
      Origin: "https://evil.example",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "UNTRUSTED_MUTATION_REQUEST",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("bounds a chunked oversized body before reading its tail or starting auth and paid work", async () => {
    const chunk = new Uint8Array(8 * 1024 * 1024);
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 2) {
          controller.enqueue(chunk);
          return;
        }
        if (pulls === 3) {
          controller.enqueue(new Uint8Array([0]));
          return;
        }
        throw new Error("oversized request tail must not be consumed");
      },
      cancel() {
        cancelled = true;
      },
    });
    const oversized = new Request("http://localhost/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "same-origin",
      },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await POST(oversized);

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulls).toBe(3);
    expect(createClientFromRequest).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("allows an authenticated native Bearer mutation without browser fetch metadata", async () => {
    mocks.provider.mockResolvedValue(providerResult({
      fullText: "확인했어요.",
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    const response = await POST(request({}, {
      Authorization: "Bearer native-session-token",
      "Sec-Fetch-Site": "",
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
  });

  it("binds both chat provider egresses to the durable receipt authorizer", async () => {
    providerAcrossBothEgressBoundaries(providerResult({
      fullText: "현재 권한으로 안전하게 답했어요.",
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.providerEgressAuthorizer.mock.calls).toEqual([
      [{
        operation: "responses.input_tokens.count",
        contentBinding: "c".repeat(64),
      }],
      [{
        operation: "responses.create",
        contentBinding: "d".repeat(64),
      }],
    ]);
  });

  it("allows only the cryptographically signed demo to omit browser fetch metadata", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValue(providerResult({
      fullText: "체험 답변",
      usage: { input_tokens: 5, output_tokens: 2 },
    }));

    const response = await POST(request({
      isDemo: true,
      coupleId: "demo-couple",
      userMessageId: undefined,
    }, {
      "Sec-Fetch-Site": "",
      Cookie: "demo_session=signed-demo-test-token",
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("returns canonical crisis guidance before limiter, attachments, persistence, model, cost, tools, or memory", async () => {
    const disclosure = "지금 죽\u200B고 싶어요";
    const actionId = "11111111-1111-4111-8111-111111111111";
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: disclosure,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-16T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-16T00:00:00.000Z",
      },
    );
    const response = await POST(request({
      // A forged benign client copy must not override the canonical DB row.
      messages: [{ role: "user", content: "예산 변경을 계속해줘" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("자살예방상담전화 109");
    expect(body).toContain("경찰 112");
    expect(body).toContain('"question_scope":"W5_safety_override"');
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(body).not.toContain(disclosure);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.chooseModelRole).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("keeps crisis guidance as a complete SSE response before every paid or durable side effect when the service seal fails", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "지금 남편이 칼로 위협하고 있어요",
    };
    mocks.adminRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "SERVICE_UNAVAILABLE", message: "unavailable" },
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 남편이 칼로 위협하고 있어요" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("1366");
    expect(body).toContain('"durable_safety_fence_confirmed":false');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("still emits fixed crisis guidance when the ordinary limiter and attachment path would reject", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "자해할 생각이 들어",
    };
    mocks.rateLimit.mockResolvedValue(new Response("limited", { status: 429 }));

    const response = await POST(request({
      messages: [{ role: "user", content: "자해할 생각이 들어" }],
      attachments: [{ kind: "image", fileName: "remote.png", url: "https://example.test/private.png" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("자살예방상담전화 109");
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("returns fixed violence guidance without entering durable claim reconciliation", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "지금 배우자에게 맞았어",
    };
    mocks.reconcile.mockResolvedValue(false);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 배우자에게 맞았어" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("여성긴급전화 1366");
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("routes reporter aggression to de-escalation guidance without victim-only services", async () => {
    const disclosure = "나 지금 신랑 죽이러 갈 거야";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: disclosure,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: disclosure }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("다가가거나 따라가지");
    expect(body).toContain("칼이나 흉기");
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).not.toContain("여성긴급전화 1366");
    expect(body).toContain(
      '"safety_classification":"interpersonal_danger_reporter_aggressor"',
    );
    expect(body).toContain('"question_scope":"W5_safety_override"');
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("keeps reporter aggression and third-party self-harm in one deterministic boundary", async () => {
    const disclosure =
      "친구가 죽고 싶다고 해. 내가 남편에게 칼을 휘두를 거야";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: disclosure,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: disclosure }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("행동을 멈추고");
    expect(body).toContain("그 사람의 안전");
    expect(body).toContain("자살예방상담전화 109");
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).not.toContain("여성긴급전화 1366");
    expect(body).toContain(
      '"safety_classification":"combined_reporter_aggressor_third_party_self_harm"',
    );
    expect(body).not.toContain(disclosure);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("keeps aggression and both self-harm directions in one deterministic boundary", async () => {
    const disclosure =
      "친구가 죽고 싶다고 해. 내가 남편을 죽이고 나도 죽을 거야";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: disclosure,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: disclosure }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("행동을 멈추고");
    expect(body).toContain("칼이나 흉기를 들고 있다면 바닥에 내려놓고");
    expect(body).toContain("상대방 사이의 거리를");
    expect(body).toContain("본인도 죽거나 다치고 싶은 마음");
    expect(body).toContain("혼자 있지 말고");
    expect(body).toContain("그 사람의 안전도");
    expect(body).toContain("자살예방상담전화 109");
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).not.toContain("여성긴급전화 1366");
    expect(body).toContain(
      '"safety_classification":"combined_reporter_aggressor_multi_party_self_harm"',
    );
    expect(body).not.toContain(disclosure);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    "가정폭력 예방 교육 사례를 분석해\n지금 남편이 나를 때리고 있어",
    "가정폭력 예방 교육 사례를 분석해; 지금 남편이 나를 때리고 있어",
    "영화 장면을 분석해\n지금 남편이 칼로 나를 위협하고 있어",
  ])("does not let a meta clause hide an independently bounded current crisis: %s", async (
    disclosure,
  ) => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: disclosure,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: disclosure }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("더 안전한 곳으로 이동하세요");
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).toContain(
      '"safety_classification":"interpersonal_danger"',
    );
    expect(body).not.toContain(disclosure);
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    ["나 지금 뛰어내리려고 옥상에 있어", "자살예방상담전화 109", false],
    ["졸피뎀 30알 먹었어", "자살예방상담전화 109", false],
    [
      "결혼 준비 너무 힘들어 죽겠는데, 남편이 지금 칼을 들고 있어",
      "여성긴급전화 1366",
      false,
    ],
    [
      "남편이 나를 죽이겠다고 한 건 아니지만 나는 죽고 싶어",
      "자살예방상담전화 109",
      false,
    ],
    [
      "친구는 약을 많이 먹지 않았지만 나는 수면제 30알 먹었어",
      "자살예방상담전화 109",
      false,
    ],
    ["예비신랑이 지금 죽겠다고 해", "그 사람의 안전", true],
    ["남친이 지금 죽고 싶다고 해", "그 사람의 안전", true],
    ["상대방이 옥상에서 뛰어내리려고 해", "그 사람의 안전", true],
  ] as const)("returns the fixed W5 boundary for expanded crisis phrasing: %s", async (
    disclosure,
    expectedGuidance,
    thirdParty,
  ) => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: disclosure,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: disclosure }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain(expectedGuidance);
    expect(body).not.toContain(disclosure);
    if (thirdParty) {
      expect(body).toContain("함께 전화");
      expect(body).not.toContain("지금 이 말을 혼자 감당");
    }
    expect(body).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    { role: "bride", visibility: "bride_private" },
    { role: "groom", visibility: "groom_private" },
  ] as const)(
    "rejects $visibility mediation before replay, durable work, or provider use",
    async ({ role, visibility }) => {
      mocks.userProfile = {
        ...mocks.userProfile,
        role,
      };

      const response = await POST(request({
        requestKind: "mediation",
        userMessageId: undefined,
        conflictContext: "예산 상한선을 두고 의견이 달라요.",
        visibility,
      }));

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toEqual({
        error: "커플 중재는 공유 대화에서만 시작할 수 있어요.",
        code: "MEDIATION_SHARED_VISIBILITY_REQUIRED",
      });
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(mocks.findPersisted).not.toHaveBeenCalled();
      expect(mocks.reconcile).not.toHaveBeenCalled();
      expect(mocks.rateLimit).not.toHaveBeenCalled();
      expect(mocks.claim).not.toHaveBeenCalled();
      expect(mocks.providerLedger).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toHaveLength(0);
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.enqueueMemory).not.toHaveBeenCalled();
      expect(mocks.log).not.toHaveBeenCalled();
    },
  );

  it("keeps an immediate crisis mediation summary out of the shared response lane", async () => {
    const sentinel = "MEDIATION_W5_SENTINEL";
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: `남편이 지금 제 목을 조르고 있어요 ${sentinel}`,
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(0);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("fails a non-immediate W2 mediation safety summary closed before provider or durable insert", async () => {
    const sentinel = "MEDIATION_W2_SENTINEL";
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext:
        `작년에 신랑이 칼 들고 죽인다고 했는데 지금은 안전해 ${sentinel}`,
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(0);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it.each([
    "내가 남편을 밀쳤어. 조율해줘.",
    "제가 아내 목을 졸랐어요. 중재해 주세요.",
    "내가 신랑한테 화가 나서 물건을 던졌어.",
    "내가 물건을 아내에게 던졌어. 조율해줘.",
    "내가 여자친구에게 성관계를 강요했어. 합의안을 만들어줘.",
  ])("closes a requester harm disclosure before shared mediation or provider use: %s", async (conflictContext) => {
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext,
    }));

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(0);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  // 중재 요청의 답은 `visibility: "shared"`로 저장된다. 아래 문장들은 질문 범위
  // 분류가 안전 사유 고위험으로 판정하지만, 위 두 테스트가 쓰는 탐지기
  // (classifyAmoraCrisis / assessAmoraSafetyText)는 하나도 잡지 못한다. 그래서
  // 전부 모델까지 갔고, 답은 공유 레인에 남았다 — 측정상 12개 중 11개.
  //
  // 답의 문구를 안전하게 바꾸는 것으로는 못 막는다. 상대에게 도착하는 것은 문구가
  // 아니라 "파트너가 아모라에게 안전 관련해서 뭔가 물었다"는 사실이기 때문이다.
  it.each([
    "예식장 정하는 걸로 싸웠는데 제 폰을 매일 확인하고 카톡도 다 봐요",
    "헤어지자고 하면 가만 안 둔다고 해요",
    "제 월급을 다 가져가요",
    "가족을 못 만나게 해요",
    "화나면 물건을 던지고 저를 때린 적도 있어요",
    "손찌검을 한 적이 있어요",
    "저를 밀쳐서 넘어진 적 있어요",
    "한 번 때린 뒤로는 안 그런다고 하는데요",
    "목을 조른 적도 있어요",
    "화나면 물건을 집어 던져요",
    "계약금 환불 얘기하다가 저를 때린 적도 있어요",
  ])(
    "closes a scope-classified safety mediation before provider or durable insert: %s",
    async (conflictContext) => {
      const response = await POST(request({
        requestKind: "mediation",
        userMessageId: undefined,
        conflictContext,
      }));

      expect(response.status).toBe(422);
      await expect(response.json()).resolves.toMatchObject({
        code: "MEDIATION_SAFETY_PREFLIGHT_REQUIRED",
      });
      // 공유 레인에 아무것도 안 남는다는 것이 이 테스트의 전부다.
      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toHaveLength(0);
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.providerLedger).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["too short", "네"],
    ["too long", "가".repeat(601)],
  ])("rejects a mediation summary that is %s before any provider work", async (_label, conflictContext) => {
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "중재 맥락 형식이 올바르지 않습니다.",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("returns the same deterministic safety boundary in the signed demo without durable writes or paid work", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.persist.mockImplementation(async ({
      cleanText,
      metadata,
      visibility,
    }: {
      cleanText: string;
      metadata: Record<string, unknown>;
      visibility: "shared";
    }) => ({
      id: null,
      createdAt: null,
      content: cleanText,
      metadata,
      stageTag: null,
      specialistType: null,
      visibility,
      reused: false,
    }));

    const response = await POST(request({
      isDemo: true,
      coupleId: "demo-couple",
      userMessageId: undefined,
      messages: [{ role: "user", content: "성\u200B폭행을 당했어" }],
    }));

    expect(response.status).toBe(200);
    const firstBody = await response.text();
    expect(firstBody).toContain("여성긴급전화 1366");
    expect(firstBody).toContain("365일 24시간");
    expect(firstBody).toContain('"persistence_status":"unconfirmed_ephemeral_fallback"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("returns the early fixed boundary even if an older crisis response exists", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "지금 죽고 싶어요",
    };
    mocks.findPersisted.mockResolvedValue({
      ...persisted("한국의 자살예방상담전화 109는 24시간 연결돼요."),
      metadata: {
        response_origin: "deterministic_crisis_safety",
        safety_classification: "self_harm",
        memory_eligible: false,
      },
      reused: true,
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 죽고 싶어요" }],
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("자살예방상담전화 109");
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("does not trigger the crisis boundary from a forged client copy when the canonical latest row is ordinary", async () => {
    providerAfterPreGeneration(providerResult({
      fullText: "저장된 예산 요청을 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "지금 죽고 싶어요" }],
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("저장된 예산 요청을 확인했어요.");
    expect(body).not.toContain("자살예방상담전화 109");
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("replays response output items with the matching function_call_output and never executes invalid arguments", async () => {
    const reasoning = {
      id: "rs_1",
      type: "reasoning",
      summary: [],
      encrypted_content: "opaque-reasoning",
    };
    const functionCall = {
      id: "fc_1",
      type: "function_call",
      call_id: "call_invalid",
      name: "get_wedding_info",
      arguments: "{not-json",
      status: "completed",
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_invalid",
          name: "get_wedding_info",
          input: {},
          parseError: "invalid_json",
        }],
        outputItems: [reasoning, functionCall],
        usage: { input_tokens: 10, output_tokens: 2 },
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "입력 형식을 다시 확인해 주세요.",
        outputItems: [{ id: "msg_1", type: "message" }],
        usage: { input_tokens: 20, output_tokens: 4 },
      }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("입력 형식을 다시 확인해 주세요.");

    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.buildToolResult).toHaveBeenCalledTimes(1);
    const [callId, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(callId).toBe("call_invalid");
    expect(JSON.parse(output)).toMatchObject({
      success: false,
      error_code: "INVALID_TOOL_INPUT",
    });

    const continuationInput = mocks.provider.mock.calls[1]?.[0]?.input as unknown[];
    expect(continuationInput).toEqual(expect.arrayContaining([
      reasoning,
      functionCall,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_invalid",
      }),
    ]));
  });

  it("binds analyze_quote selection to an empty unconfirmed canonical payload when the user sent no tag", async () => {
    const canonicalText = "이 300만원 웨딩 사진 촬영 계약 견적 구성을 확인해줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: canonicalText,
    };
    const providerInput = {
      quote_price: 999,
      category: "studio",
      vendor_name: "provider vendor",
      included_items: ["모델이 지어낸 포함 항목"],
      not_needed_items: ["모델이 지어낸 불필요 항목"],
      checklist_confirmed: true,
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{ callId: "call_quote_absent", name: "analyze_quote", input: providerInput }],
        outputItems: [{
          id: "fc_quote_absent",
          type: "function_call",
          call_id: "call_quote_absent",
          name: "analyze_quote",
          arguments: JSON.stringify(providerInput),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "체크리스트를 확인해 주세요." }));

    const response = await POST(request({ messages: [{ role: "user", content: canonicalText }] }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "analyze_quote" }),
    ]));
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "analyze_quote",
      expect.objectContaining({
        included_items: [],
        not_needed_items: [],
        checklist_confirmed: false,
      }),
      expect.any(Object),
    );
  });

  it("overwrites provider category, region, quote, vendor, and arrays with the exact canonical v2 selection", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    const studioIds = getQuoteCheckItems("studio", "seoul").map((item) => item.id);
    const canonicalText = buildCanonicalQuoteAnalysisMessage({
      category: "studio",
      region: "seoul",
      quotePriceManwon: 300,
      vendorName: "테스트 계약 웨딩 스튜디오",
      includedItemIds: studioIds.slice(0, 2),
      notNeededItemIds: studioIds.slice(2, 3),
      unknownItemIds: studioIds.slice(3),
    });
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: canonicalText,
    };
    const providerInput = {
      quote_price: 999,
      category: "dress",
      region: "busan",
      vendor_name: "provider vendor",
      included_items: ["provider included"],
      not_needed_items: ["provider excluded"],
      checklist_confirmed: false,
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{ callId: "call_quote_valid", name: "analyze_quote", input: providerInput }],
        outputItems: [{
          id: "fc_quote_valid",
          type: "function_call",
          call_id: "call_quote_valid",
          name: "analyze_quote",
          arguments: JSON.stringify(providerInput),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "선택한 항목만 확인했어요." }));

    const response = await POST(request({ messages: [{ role: "user", content: canonicalText }] }));

    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "analyze_quote",
      expect.objectContaining({
        category: "studio",
        region: "seoul",
        included_items: studioIds.slice(0, 2),
        not_needed_items: studioIds.slice(2, 3),
        checklist_confirmed: true,
        quote_price: 300,
        vendor_name: "테스트 계약 웨딩 스튜디오",
      }),
      expect.any(Object),
    );
    const currentProviderInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(currentProviderInput).toContain("[quote_analysis_v2]");
    expect(currentProviderInput).toContain("테스트 계약 웨딩 스튜디오");
    expect(mocks.atomicResponses.at(-1)?.metadata).toMatchObject({
      memory_eligible: false,
      memory_enqueue_requested: false,
    });
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("rejects a legacy quote tag without executing provider-invented selections", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    const tagged = `[quote_analysis] 견적 300만원 (테스트 계약 웨딩) 항목 상태:
포함: 야외 촬영
이용 안 함: 없음
확인 필요: 없음`;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: tagged,
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_quote_invalid",
          name: "analyze_quote",
          input: {
            quote_price: 300,
            category: "studio",
            included_items: ["provider invented"],
            checklist_confirmed: true,
          },
        }],
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "다시 선택해 주세요." }));

    const canonicalText = tagged;
    const response = await POST(request({ messages: [{ role: "user", content: canonicalText }] }));

    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.executeTool).not.toHaveBeenCalled();
    const rejectedOutput = mocks.buildToolResult.mock.calls
      .map((call) => JSON.parse(String(call[1])) as { error_code?: string })
      .find((output) => output.error_code === "INVALID_QUOTE_ANALYSIS_SELECTION");
    expect(rejectedOutput).toBeDefined();
    expect(mocks.atomicResponses.at(-1)?.metadata).toMatchObject({
      memory_eligible: false,
      memory_enqueue_requested: false,
    });
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it.each(["forged", "partial", "duplicate"] as const)(
    "rejects %s analyze_quote v2 item IDs before tool execution",
    async (variant) => {
      mocks.memoryEnablement.shared = true;
      mocks.auxiliaryMemoryRuntimeEnabled = true;
      const ids = getQuoteCheckItems("studio", "seoul").map((item) => item.id);
      const valid = buildCanonicalQuoteAnalysisMessage({
        category: "studio",
        region: "seoul",
        quotePriceManwon: 300,
        vendorName: "테스트 스튜디오",
        includedItemIds: ids.slice(0, 1),
        notNeededItemIds: ids.slice(1, 2),
        unknownItemIds: ids.slice(2),
      });
      const lines = valid.split("\n");
      const payload = JSON.parse(lines[2]) as {
        states: { included: string[]; notNeeded: string[]; unknown: string[] };
      };
      if (variant === "forged") payload.states.included.push("forged_item");
      if (variant === "partial") payload.states.unknown.pop();
      if (variant === "duplicate") payload.states.notNeeded.push(payload.states.included[0]);
      const canonicalText = `${lines[0]}\n${lines[1]}\n${JSON.stringify(payload)}\n${lines[3]}`;
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: canonicalText };
      mocks.provider
        .mockResolvedValueOnce(providerResult({
          toolCalls: [{
            callId: `call_quote_${variant}`,
            name: "analyze_quote",
            input: {
              category: "dress",
              region: "busan",
              quote_price: 999,
              included_items: ["provider invented"],
              checklist_confirmed: true,
            },
          }],
        }))
        .mockResolvedValueOnce(providerResult({ fullText: "체크리스트를 다시 열어주세요." }));

      const response = await POST(request({ messages: [{ role: "user", content: canonicalText }] }));
      await response.text();

      expect(response.status).toBe(200);
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.buildToolResult.mock.calls.some((call) => (
        (JSON.parse(String(call[1])) as { error_code?: string }).error_code
          === "INVALID_QUOTE_ANALYSIS_SELECTION"
      ))).toBe(true);
      expect(mocks.atomicResponses.at(-1)?.metadata).toMatchObject({
        memory_eligible: false,
        memory_enqueue_requested: false,
      });
      expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    },
  );

  it("disables tools after two rounds, orders all ledger calls, and keeps the turn event cost-neutral", async () => {
    mocks.executeTool.mockImplementation(async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ) => ({
      toolName,
      toolInput,
      toolOutput: { wedding_date: null, total_budget: 0 },
      success: true,
      displayMessage: "현재 결혼 준비 정보를 확인했어요.",
    }));
    for (let round = 0; round < 2; round++) {
      mocks.provider.mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: `call_${round}`,
          name: "get_wedding_info",
          input: {},
        }],
        outputItems: [{
          id: `fc_${round}`,
          type: "function_call",
          call_id: `call_${round}`,
          name: "get_wedding_info",
          arguments: JSON.stringify({}),
          status: "completed",
        }],
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_write_input_tokens: 3,
          cache_read_input_tokens: 4,
        },
      }));
    }
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "도구 실행 결과를 정리했어요.",
      usage: {
        input_tokens: 20,
        output_tokens: 5,
        cache_write_input_tokens: 6,
        cache_read_input_tokens: 7,
      },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("도구 실행 결과를 정리했어요.");

    expect(mocks.provider).toHaveBeenCalledTimes(3);
    for (const [providerArgs] of mocks.provider.mock.calls) {
      expect(providerArgs).toEqual(expect.objectContaining({
        maxInputTokens: 64_000,
        maxOutputTokens: 1_400,
      }));
    }
    for (let call = 0; call < 2; call++) {
      expect(mocks.provider.mock.calls[call]?.[0]?.tools).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "get_wedding_info" }),
      ]));
      expect(mocks.provider.mock.calls[call]?.[0]?.systemPrompt).toContain("`get_wedding_info`");
    }
    expect(mocks.provider.mock.calls[2]?.[0]?.tools).toEqual([]);
    expect(mocks.provider.mock.calls[2]?.[0]?.systemPrompt).not.toContain("`get_wedding_info`");
    expect(mocks.executeTool).toHaveBeenCalledTimes(2);
    for (const call of mocks.executeTool.mock.calls) {
      expect(call[2].pendingActionId).toBeUndefined();
    }

    expect(mocks.providerLedger).toHaveBeenCalledTimes(3);
    expect(mocks.providerLedger.mock.calls.map(([context]) => ({
      callIndex: context.callIndex,
      phase: context.phase,
    }))).toEqual([
      { callIndex: 1, phase: "tool_round" },
      { callIndex: 2, phase: "tool_round" },
      { callIndex: 3, phase: "final_no_tool" },
    ]);

    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: true,
      model: null,
      tokensInput: null,
      tokensOutput: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      costUsd: null,
      metadata: {
        visibility: "shared",
        stage_tag: "planning_0",
        question_scope: "W0_wedding_core",
        tools_used: ["get_wedding_info", "get_wedding_info"],
        tool_rounds: 2,
        exceeded_max_rounds: true,
        correction_count: 0,
      },
    }));
  });

  it("renders NAVER results over SSE but never stores or forwards provider content", async () => {
    const placeTool = {
      name: "search_nearby_places",
      description: "Search NAVER places",
      input_schema: {},
    };
    mocks.safeTools.push(placeTool);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "강남 상견례 식당 찾아줘",
    };
    const externalResult = {
      toolName: "search_nearby_places",
      toolInput: { query: "강남 상견례 식당" },
      toolOutput: {
        places: [{
          name: "외부 식당명",
          address: "서울 강남구",
          imageUrl: "https://search.pstatic.net/external.jpg",
        }],
        query: "강남 상견례 식당",
      },
      success: true,
      displayMessage: "검색 결과 1곳을 찾았습니다.",
    };
    mocks.executeTool.mockResolvedValueOnce(externalResult);
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_place",
          name: "search_nearby_places",
          input: { query: "강남 상견례 식당" },
        }],
        outputItems: [{
          id: "fc_place",
          type: "function_call",
          call_id: "call_place",
          name: "search_nearby_places",
          arguments: JSON.stringify({ query: "강남 상견례 식당" }),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_after_place_lock",
          name: "get_wedding_info",
          input: {},
        }],
        outputItems: [{
          id: "fc_after_place_lock",
          type: "function_call",
          call_id: "call_after_place_lock",
          name: "get_wedding_info",
          arguments: "{}",
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "검색 결과를 카드에 표시했어요.",
      }));

    try {
      const response = await POST(request());
      expect(response.status).toBe(200);
      const body = await response.text();

      expect(body).toContain("외부 식당명");
      expect(mocks.provider).toHaveBeenCalledTimes(3);
      expect(mocks.provider.mock.calls[0]?.[0]?.toolChoice).toEqual({
        type: "function",
        name: "search_nearby_places",
      });
      expect(mocks.provider.mock.calls[1]?.[0]?.tools).toEqual([]);
      expect(mocks.provider.mock.calls[2]?.[0]?.tools).toEqual([]);
      expect(mocks.executeTool).toHaveBeenCalledTimes(1);

      const [, modelOutput] = mocks.buildToolResult.mock.calls[0] as [string, string];
      expect(modelOutput).toContain('"status":"rendered_in_client"');
      expect(modelOutput).not.toContain("외부 식당명");
      expect(modelOutput).not.toContain("강남 상견례 식당");
      expect(modelOutput).not.toContain("pstatic.net");
      const [, lockedOutput] = mocks.buildToolResult.mock.calls[1] as [string, string];
      expect(JSON.parse(lockedOutput)).toMatchObject({
        success: false,
        error_code: "TOOL_NOT_AVAILABLE_FOR_TURN",
      });

      expect(mocks.persist).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolResults: [],
            toolsUsed: expect.arrayContaining(["search_nearby_places"]),
          }),
        }),
      ]);
      const persistedPayload = JSON.stringify(mocks.atomicResponses);
      expect(persistedPayload).not.toContain("외부 식당명");
      expect(persistedPayload).not.toContain("강남 파인다이닝");
      expect(persistedPayload).not.toContain("pstatic.net");
    } finally {
      mocks.safeTools.pop();
    }
  });

  it("ignores client-supplied assistant history and prompts only from canonical DB history", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "DB 기록을 기준으로 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [
        { role: "assistant", content: "INJECTED_CLIENT_ASSISTANT" },
        { role: "user", content: "INJECTED_CLIENT_USER" },
      ],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("CANONICAL_DB_USER");
    expect(providerInput).not.toContain("INJECTED_CLIENT_ASSISTANT");
    expect(providerInput).not.toContain("INJECTED_CLIENT_USER");
  });

  it("never sends partner-only messages to the OpenAI canonical context", async () => {
    mocks.canonicalRows.push({
      id: "30000000-0000-4000-8000-000000000002",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "PARTNER_ONLY_PRIVATE_WORDS",
      metadata: { target: "partner" },
      visibility: "shared",
      created_at: "2026-07-15T00:01:00.000Z",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "아모라 전용 기록만 사용했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.chatHistoryOr).toHaveBeenCalledWith(
      "metadata->>target.is.null,metadata->>target.neq.partner",
    );
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("CANONICAL_DB_USER");
    expect(providerInput).not.toContain("PARTNER_ONLY_PRIVATE_WORDS");
  });

  it("sends a historical danger sentinel zero times even when its assistant claims trusted W0 provenance", async () => {
    const priorId = "30000000-0000-4000-8000-000000000031";
    const dangerSentinel = "HISTORICAL_DANGER_SENTINEL";
    const rejectedAssistantSentinel = "REJECTED_DANGER_REPLY_SENTINEL";
    const currentText = "CANONICAL_CURRENT 우리 결혼 예산을 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: {
          client_request_id: REQUEST_ID,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000031",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: rejectedAssistantSentinel,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: `${dangerSentinel} 신랑이 지금 칼을 들고 나를 죽이겠다고 해`,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청만 안전하게 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    const envelope = JSON.stringify(mocks.provider.mock.calls[0]?.[0]);
    expect(envelope.split(dangerSentinel)).toHaveLength(1);
    expect(envelope).not.toContain(rejectedAssistantSentinel);
    expect(envelope).toContain(currentText);
  });

  it("keeps a complete server-proven W0 pair with the current bound user row", async () => {
    const priorId = "30000000-0000-4000-8000-000000000032";
    const priorUserSentinel = "TRUSTED_W0_USER_SENTINEL";
    const priorAssistantSentinel = "TRUSTED_W0_ASSISTANT_SENTINEL";
    const currentText = "CANONICAL_CURRENT 우리 결혼 예산을 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000032",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: `${priorAssistantSentinel} 두 스튜디오의 차이를 정리했어요.`,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: `${priorUserSentinel} 웨딩 스튜디오 두 곳을 비교해줘`,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "연결된 준비 맥락을 이어서 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain(priorUserSentinel);
    expect(providerInput).toContain(priorAssistantSentinel);
    expect(providerInput).toContain(currentText);
  });

  it("sends only the strict header from a prior valid quote machine row on the next W0 turn", async () => {
    const priorId = "30000000-0000-4000-8000-000000000033";
    const assistantId = "20000000-0000-4000-8000-000000000033";
    const currentText = "CANONICAL_CURRENT 우리 결혼 예산을 정리해줘";
    const itemIds = getQuoteCheckItems("dress", "seoul").map((item) => item.id);
    const quoteMachineContext = buildCanonicalQuoteAnalysisMessage({
      category: "dress",
      region: "seoul",
      quotePriceManwon: 300,
      vendorName: "테스트",
      includedItemIds: [],
      notNeededItemIds: [],
      unknownItemIds: itemIds,
    });
    const expectedHeader = quoteMachineContext.split("\n")[0];
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: assistantId,
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "선택한 견적 항목을 확인했어요.",
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: quoteMachineContext,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청을 이어서 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain(`[신부] ${expectedHeader}`);
    expect(providerInput).toContain("선택한 견적 항목을 확인했어요.");
    expect(providerInput).toContain(currentText);
    expect(providerInput).not.toContain("[quote_analysis_v2]");
    expect(providerInput).not.toContain('"version":2');
  });

  it("uses neutral participant labels for a version-two preparation space", async () => {
    vi.stubEnv("AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED", "true");
    mocks.coupleMemberModelVersion = 2;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 할 한 가지를 함께 정리했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    const providerCall = mocks.provider.mock.calls[0]?.[0];
    const providerInput = JSON.stringify(providerCall?.input);
    const systemPrompt = String(providerCall?.systemPrompt);
    expect(providerInput).toContain("[사용자] CANONICAL_DB_USER");
    expect(providerInput).not.toContain("[신부] CANONICAL_DB_USER");
    expect(systemPrompt).not.toContain("테스트 신부");
    expect(systemPrompt).not.toContain("테스트 신랑");
    expect(mocks.requestFrom).toHaveBeenCalledWith("couples");
  });

  it("fails closed before provider egress when a neutral member model cannot be verified", async () => {
    vi.stubEnv("AMORA_NEUTRAL_PREPARATION_SPACE_ENABLED", "true");
    mocks.coupleMemberModelError = {
      code: "PGRST500",
      message: "member model unavailable",
    };
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_MEMBER_MODEL_UNAVAILABLE",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "AMORA_MEMBER_MODEL_UNAVAILABLE",
    }));
  });

  it.each([
    [
      "legacy",
      "[quote_analysis] QUOTE_MACHINE_SENTINEL 견적 300만원 항목 상태:\n포함: 원본 파일",
    ],
    [
      "malformed v2",
      "견적 체크: QUOTE_MACHINE_SENTINEL · 웨딩드레스 · 서울 · 300만원\n[quote_analysis_v2]\n{\"version\":2}",
    ],
  ])("drops a prior %s quote machine exchange from the next W0 provider input", async (_label, content) => {
    const priorId = "30000000-0000-4000-8000-000000000034";
    const rejectedAssistant = "REJECTED_QUOTE_MACHINE_ASSISTANT";
    const currentText = "CANONICAL_CURRENT 우리 결혼 예산을 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000034",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: rejectedAssistant,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청만 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain(currentText);
    expect(providerInput).not.toContain("QUOTE_MACHINE_SENTINEL");
    expect(providerInput).not.toContain(rejectedAssistant);
    expect(providerInput).not.toContain("[quote_analysis");
    expect(providerInput).not.toContain('"version":2');
  });

  it("keeps the legacy provider-context read path while segment cutover is disabled", async () => {
    mocks.activeSegment = null;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "Legacy context remains available while the flag is off.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.requestFrom).not.toHaveBeenCalledWith("conversation_segments");
    expect(mocks.chatHistoryEq).not.toHaveBeenCalledWith(
      "segment_id",
      expect.anything(),
    );
    // The focused canonical user-row read always carries segment_id so a W3
    // follow-up can bind itself even before general segment cutover. Ordinary
    // W0/W1 provider history remains on the legacy unsegmented read here.
    expect(String(mocks.chatHistorySelect.mock.calls[0]?.[0]))
      .toContain("segment_id");
    expect(String(mocks.chatHistorySelect.mock.calls.at(-1)?.[0]))
      .not.toContain("segment_id");
  });

  it.each([
    {
      visibility: "shared" as const,
      role: "bride" as const,
      actorId: "00000000-0000-4000-8000-000000000001",
      segmentId: "60000000-0000-4000-8000-000000000001",
    },
    {
      visibility: "bride_private" as const,
      role: "bride" as const,
      actorId: "00000000-0000-4000-8000-000000000001",
      segmentId: "60000000-0000-4000-8000-000000000002",
    },
    {
      visibility: "groom_private" as const,
      role: "groom" as const,
      actorId: "00000000-0000-4000-8000-000000000002",
      segmentId: "60000000-0000-4000-8000-000000000003",
    },
  ])(
    "scopes provider messages and summaries to the exact active $visibility segment",
    async ({ visibility, role, actorId, segmentId }) => {
      vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
      mocks.authenticatedUser = { id: actorId };
      mocks.userProfile = {
        couple_id: COUPLE_ID,
        role,
        is_admin: false,
        name: "Segment test customer",
      };
      mocks.activeSegment = { id: segmentId };
      mocks.memoryEnablement[visibility] = true;
      mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: actorId,
        sender_type: role,
        role: "user",
        content: `ACTIVE_${visibility}_CONTEXT 결혼 예산을 함께 정리해줘`,
        metadata: null,
        visibility,
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      });
      mocks.summaryRows.push({
        summary: `ACTIVE_${visibility}_SUMMARY`,
        summary_type: "factual",
        visibility,
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
        message_count: 1,
        to_message_id: "30000000-0000-4000-8000-000000000001",
      });
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: "Segment-scoped response",
        usage: { input_tokens: 10, output_tokens: 3 },
      }));

      const response = await POST(request({ visibility }));
      expect(response.status).toBe(200);
      await response.text();

      expect(mocks.segmentEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
      expect(mocks.segmentEq).toHaveBeenCalledWith("visibility", visibility);
      expect(mocks.segmentEq).toHaveBeenCalledWith("status", "active");
      expect(mocks.chatHistoryEq).toHaveBeenCalledWith("segment_id", segmentId);
      expect(mocks.summaryEq).toHaveBeenCalledWith("segment_id", segmentId);
      expect(mocks.chatHistorySelect).toHaveBeenCalledWith(
        expect.stringContaining("segment_id"),
      );
      expect(mocks.summarySelect).toHaveBeenCalledWith(
        expect.stringContaining("segment_id"),
      );
      expect(mocks.chatHistoryOr).toHaveBeenCalledWith(
        "metadata->>target.is.null,metadata->>target.neq.partner",
      );
      expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
        .toContain(`ACTIVE_${visibility}_CONTEXT`);
      expect(mocks.log).toHaveBeenCalled();
    },
  );

  it.each([
    ["missing", null, null],
    ["lookup error", null, { code: "PGRST500", message: "database unavailable" }],
    ["invalid id", { id: "not-a-uuid" }, null],
  ] as const)(
    "fails closed before provider work when the active segment is %s",
    async (_label, activeSegment, activeSegmentError) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
      mocks.activeSegment = activeSegment;
      mocks.activeSegmentError = activeSegmentError;

      const response = await POST(request());

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toMatchObject({
        code: "CONVERSATION_SEGMENT_UNAVAILABLE",
      });
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.failClaim).toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it("fails closed when a provider-bound message cannot prove the active segment id", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
    mocks.activeSegment = { id: "60000000-0000-4000-8000-000000000001" };
    // The legacy-shaped fixture intentionally has no segment_id.

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails closed when a memory summary is not bound to the same active segment", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const activeSegmentId = "60000000-0000-4000-8000-000000000001";
    vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
    mocks.activeSegment = { id: activeSegmentId };
    mocks.memoryEnablement.shared = true;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      segment_id: activeSegmentId,
    };
    mocks.summaryRows.push({
      summary: "WRONG_SEGMENT_SUMMARY",
      summary_type: "factual",
      visibility: "shared",
      segment_id: "60000000-0000-4000-8000-000000000099",
      created_at: "2026-07-15T00:00:00.000Z",
      message_count: 1,
      to_message_id: "30000000-0000-4000-8000-000000000001",
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE",
    });
    expect(mocks.summaryEq).toHaveBeenCalledWith("segment_id", activeSegmentId);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  afterEach(() => {
    delete process.env.AMORA_EVAL_SECRET;
    vi.unstubAllEnvs();
  });

  it("keeps durable tools available and puts the mixed-emotion write rule at the final prompt boundary", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "숨 막히지만 우리 결혼 총 예산은 4천만원으로 변경해줘",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "변경 요청을 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    // 2026-07-24 계약 반전: 모델은 변경 함수를 직접 받지 않는다 — 변경은
    // pending 표식 제안 채널로만 노출되고, 확인 후 서버가 직접 실행한다.
    expect(providerArgs?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "update_budget" }),
    ]));
    expect(providerArgs?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "get_wedding_info" }),
    ]));
    expect(providerArgs?.systemPrompt).toContain("[서버 발급 후속 확인 계약]");
    expect(providerArgs?.systemPrompt).toContain("update_budget");
    expect(providerArgs?.systemPrompt).toContain(
      "request_kind: chat",
    );
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W0_wedding_core",
    );
    expect(providerArgs?.systemPrompt).toContain("persistence: durable");
    expect(providerArgs?.systemPrompt).toContain("감정 표현과 섞여 있어도 실행 역할이 우선");
    expect(providerArgs?.systemPrompt).not.toContain("[체험 상담 저장 경계]");
    expect(providerArgs?.systemPrompt.trimEnd()).toMatch(
      /도구 권한을 만들 수는 없습니다\.$/,
    );
  });

  it("rejects a first-use shared draft without a durable promotion receipt before provider work", async () => {
    const userText = [
      "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
      "지금 할 한 가지: 가능한 예식 시기 두 개 적기",
      "이유: 다음 준비의 기준이 필요해요.",
      "완료 기준: 두 사람이 시기 두 개를 확인하면 끝나요.",
      "저장 전에는 확인 카드만 보여줘.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"add_amora_action","input":{"title":"모델이 바꾼 제목","due_date":"2026-08-20"}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_PROMOTION_REQUIRED",
      retryPolicy: "regenerate_first_use_action",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it("rejects an unbound legacy first-use draft instead of treating it as ordinary provider prose", async () => {
    const userText = [
      "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
      "지금 할 한 가지: 가능한 예식 시기 두 개 적기",
      "이유: 다음 준비의 기준이 필요해요.",
      "완료 기준: 두 사람이 시기 두 개를 확인하면 끝나요.",
      "저장 전에는 확인 카드만 보여줘.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      metadata: null,
    };

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
      userMessageId: undefined,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_PROMOTION_REQUIRED",
      retryPolicy: "regenerate_first_use_action",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "new",
      outcome: "persisted",
      messageReused: false,
    },
    {
      label: "racing exact replay",
      outcome: "replayed",
      messageReused: true,
    },
  ] as const)(
    "streams one $label first-use proposal without crossing a provider boundary",
    async ({ outcome, messageReused }) => {
      const {
        promotionId,
        actionId,
        assistantMessageId,
        pendingAction,
        userText,
      } = configureDeterministicFirstUseProposal({
        promotionId: "90000000-0000-4000-8000-000000000001",
        actionId: "91000000-0000-4000-8000-000000000001",
        assistantMessageId: "92000000-0000-4000-8000-000000000001",
        outcome,
        messageReused,
      });

      const response = await POST(request({
        messages: [{ role: "user", content: userText }],
      }));
      expect(response.status).toBe(200);
      const responseText = await response.text();

      expect(mocks.adminRpc).toHaveBeenCalledWith(
        "validate_amora_first_use_action_promotion_v1",
        {
          p_couple_id: COUPLE_ID,
          p_owner_user_id: "00000000-0000-4000-8000-000000000001",
          p_shared_user_message_id: "30000000-0000-4000-8000-000000000001",
          p_expected_privacy_epoch: 7,
        },
      );
      const claimedRequestKey = mocks.claim.mock.calls[0]?.[0]?.requestKey;
      expect(mocks.adminRpc).toHaveBeenCalledWith(
        "finalize_amora_first_use_action_proposal_v1",
        {
          p_couple_id: COUPLE_ID,
          p_owner_user_id: "00000000-0000-4000-8000-000000000001",
          p_shared_user_message_id: "30000000-0000-4000-8000-000000000001",
          p_chat_request_key: claimedRequestKey,
          p_chat_claim_attempt_count: 1,
          p_expected_privacy_epoch: 7,
        },
      );
      expect(
        mocks.adminRpc.mock.calls.filter(
          ([name]) => name === "finalize_amora_first_use_action_proposal_v1",
        ),
      ).toHaveLength(1);
      expect(responseText).toContain(
        `"fullContent":${JSON.stringify(pendingAction.confirmation)}`,
      );
      expect(responseText).toContain(
        `"serverMessageId":"${assistantMessageId}"`,
      );
      expect(responseText).toContain(
        '"response_origin":"server_authoritative_first_use_promotion"',
      );
      expect(responseText).toContain('"provider_call_count":0');
      expect(responseText).toContain(
        `"amora_first_use_promotion_id":"${promotionId}"`,
      );
      expect(responseText).toContain(`"actionId":"${actionId}"`);
      expect(responseText).toContain(`"replayed":${messageReused}`);
      expect(responseText).not.toContain("sourceMessageId");
      expect(mocks.providerLedger).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.log).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toEqual([]);
      },
  );

  it("applies the exact first-use action with one server receipt and no provider work", async () => {
    const application = configureDeterministicFirstUseApplication();
    mocks.provider.mockRejectedValueOnce(new Error("provider must stay sealed"));

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);
    const claimedRequestKey = mocks.claim.mock.calls[0]?.[0]?.requestKey;

    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "finalize_amora_first_use_action_application_v1",
      {
        p_couple_id: COUPLE_ID,
        p_actor_user_id: "00000000-0000-4000-8000-000000000001",
        p_source_proposal_message_id: application.assistantMessageId,
        p_confirmation_message_id:
          "30000000-0000-4000-8000-000000000001",
        p_chat_request_key: claimedRequestKey,
        p_chat_claim_attempt_count: 1,
        p_expected_privacy_epoch: 7,
      },
    );
    expect(responseText).toContain(
      `"fullContent":${JSON.stringify(application.displayMessage)}`,
    );
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(responseText).toContain(
      '"response_origin":"server_authoritative_first_use_action_application"',
    );
    expect(responseText).toContain('"provider_call_count":0');
    expect(responseText).toContain('"toolName":"add_amora_action"');
    expect(responseText).toContain(
      `"id":"${application.savedActionId}"`,
    );
    expect(responseText).toContain('"status":"open"');
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it("releases a racing exact first-use application replay without provider work", async () => {
    const application = configureDeterministicFirstUseApplication({
      outcome: "replayed",
      messageReused: true,
    });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain('"replayed":true');
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("replays a committed first-use application before its finalizer or provider", async () => {
    const application = configureDeterministicFirstUseApplication();
    mocks.findPersisted.mockResolvedValue(application.buildPersistedMessage());

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain('"replayed":true');
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("withholds an exact deterministic application retry whose receipt markers were stripped", async () => {
    const application = configureDeterministicFirstUseApplication();
    const persistedApplication = application.buildPersistedMessage();
    const persistedMetadata = persistedApplication.metadata as Record<string, unknown>;
    mocks.findPersisted.mockResolvedValue({
      ...persistedApplication,
      metadata: {
        client_request_id: persistedMetadata.client_request_id,
      },
    });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("keeps an ordinary provider-backed exact confirmation replay on the generic path", async () => {
    const application = configureDeterministicFirstUseApplication();
    mocks.canonicalRows[1] = {
      ...mocks.canonicalRows[1],
      metadata: {
        pending_amora_action: application.pendingAction,
      },
    };
    mocks.findPersisted.mockResolvedValue({
      ...persisted("ordinary provider-backed action confirmation"),
      metadata: {
        client_request_id: "ordinary-provider-request",
        response_origin: "provider",
        provider_call_count: 1,
        model: "provider-model",
      },
      reused: true,
    });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain("ordinary provider-backed action confirmation");
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("replays an exact first-use application beyond the ordinary context window", async () => {
    const application = configureDeterministicFirstUseApplication();
    const currentCreatedAt = Date.parse(String(mocks.canonicalRows[0]?.created_at));
    const newerRows = Array.from({ length: 60 }, (_, index) => ({
      id: `b${String(index).padStart(7, "0")}-0000-4000-8000-000000000001`,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: `더 최근의 일반 답변 ${index}`,
      metadata: null,
      visibility: "shared",
      created_at: new Date(currentCreatedAt + (index + 1) * 1_000).toISOString(),
    }));
    mocks.canonicalRows.splice(1, 0, ...newerRows);
    mocks.findPersisted.mockResolvedValue(application.buildPersistedMessage());

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(mocks.chatHistoryLimit).toHaveBeenCalledWith(2);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("rejects a strict application replay whose proposal row is user-owned", async () => {
    const application = configureDeterministicFirstUseApplication();
    mocks.canonicalRows[1] = {
      ...mocks.canonicalRows[1],
      sender_id: "00000000-0000-4000-8000-000000000001",
    };
    mocks.findPersisted.mockResolvedValue(application.buildPersistedMessage());

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("classifies exact-key and partial-tamper application receipts without capturing legacy provider receipts", () => {
    const application = configureDeterministicFirstUseApplication({
      responseOrigin: "provider",
      providerCallCount: 1,
    });
    const applicationMetadata = application.buildPersistedMessage().metadata;
    expect(requiresStrictAmoraFirstUseApplicationReplay(applicationMetadata))
      .toBe(true);
    expect(requiresStrictAmoraFirstUseApplicationReplay({
      confirmed_amora_action_id: application.actionId,
      toolResults: [application.toolResult],
      model: "legacy-provider-model",
      provider_call_count: 1,
    })).toBe(false);
  });

  it("keeps a committed first-use application claim complete when privacy changes before release", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const application = configureDeterministicFirstUseApplication();
    mocks.getPrivacyEpoch.mockReset();
    mocks.getPrivacyEpoch
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    {
      label: "arbitrary action id",
      overrides: { toolActionId: "act_forged" },
    },
    {
      label: "arbitrary action href",
      overrides: { toolHref: "/admin" },
    },
    {
      label: "provider-owned origin",
      overrides: { responseOrigin: "provider" },
    },
  ])("rejects a committed first-use application with $label without failing its claim", async ({ overrides }) => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const application = configureDeterministicFirstUseApplication(overrides);

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_INVALID",
      retryable: true,
      retryPolicy: "same_request",
    });
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    {
      label: "arbitrary action href",
      overrides: { toolHref: "/admin" },
    },
    {
      label: "tampered origin",
      overrides: { responseOrigin: "provider" },
    },
    {
      label: "tampered origin and provider count",
      overrides: { responseOrigin: "provider", providerCallCount: 1 },
    },
  ])("keeps an exact retry with $label behind the strict application replay gate", async ({ overrides }) => {
    const application = configureDeterministicFirstUseApplication(overrides);
    mocks.findPersisted.mockResolvedValue(application.buildPersistedMessage());

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_REPLAY_INVALID",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "stale application",
      finalError: {
        code: "40001",
        message: "AMORA_FIRST_USE_ACTION_APPLICATION_STALE",
      },
      status: 409,
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_STALE",
      retryPolicy: "regenerate_first_use_action",
    },
    {
      label: "application infrastructure outage",
      finalError: {
        code: "08006",
        message: "connection unavailable",
      },
      status: 503,
      code: "AMORA_FIRST_USE_ACTION_APPLICATION_UNAVAILABLE",
      retryPolicy: "same_request",
    },
  ] as const)("maps $label before provider work", async ({
    finalError,
    status,
    code,
    retryPolicy,
  }) => {
    const application = configureDeterministicFirstUseApplication({ finalError });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, retryPolicy });
    expect(mocks.failClaim).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("keeps a mixed first-use confirmation on the provider-backed path", async () => {
    const application = configureDeterministicFirstUseApplication();
    const mixedText = `${FIRST_USE_APPLICATION_CONFIRMATION} 그리고 예식장 비교 기준도 알려줘.`;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: mixedText,
    };
    mocks.executeTool.mockResolvedValueOnce(application.toolResult);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "행동 카드 결과와 예식장 비교 기준을 함께 안내할게요.",
      usage: { input_tokens: 10, output_tokens: 6 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: mixedText }],
      confirmedActionId: application.actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_amora_action",
      application.canonicalAddActionInput,
      expect.objectContaining({ pendingActionId: application.actionId }),
    );
  });

  it("keeps a first-use confirmation with an attachment on the provider-backed path", async () => {
    const application = configureDeterministicFirstUseApplication();
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    await bindCanonicalProviderAttachments([attachment]);
    mocks.executeTool.mockResolvedValueOnce(application.toolResult);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "행동 카드 결과와 첨부 내용을 함께 확인할게요.",
      usage: { input_tokens: 10, output_tokens: 6 },
    }));

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      attachments: [{ ...attachment, fileName: "context.png" }],
      confirmedActionId: application.actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_amora_action",
      application.canonicalAddActionInput,
      expect.objectContaining({ pendingActionId: application.actionId }),
    );
  });

  it("seals only a newly persisted ordinary provider add-action proposal", async () => {
    const userText = "예식장 후보 세 곳 비교를 액션으로 기억해 줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "둘이 확인할 다음 행동으로 정리했어요.",
        '[pending_action]{"tool":"add_amora_action","input":{"title":"예식장 후보 세 곳 비교","description":"둘이 같은 기준으로 후보를 비교해요."}}[/pending_action]',
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      amora_add_action_proposal_origin_v1: "ordinary_provider",
      pending_amora_action: {
        tool: "add_amora_action",
        input: {
          title: "예식장 후보 세 곳 비교",
          description: "둘이 같은 기준으로 후보를 비교해요.",
        },
      },
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_grounding",
    );
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("does not stamp a private provider add-action response as an eligible shared proposal", async () => {
    const userText = "예식장 후보 세 곳 비교를 액션으로 기억해 줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      visibility: "bride_private",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "개인 대화에서 참고할 다음 행동이에요.",
        '[pending_action]{"tool":"add_amora_action","input":{"title":"예식장 후보 비교"}}[/pending_action]',
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
      visibility: "bride_private",
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_add_action_proposal_origin_v1",
    );
  });

  it("does not stamp a W1 provider add-action marker as a W0 application source", async () => {
    const userText = "신혼집 이사 비용 분담을 액션으로 기억해 줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "신혼집 논의에서 참고할 다음 행동이에요.",
        '[pending_action]{"tool":"add_amora_action","input":{"title":"이사 비용 분담 논의"}}[/pending_action]',
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W1_wedding_adjacent",
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_add_action_proposal_origin_v1",
    );
  });

  it("does not stamp a demo provider add-action response as a durable application source", async () => {
    const userText = "예식장 후보 세 곳 비교를 액션으로 기억해 줘";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "체험에서 참고할 다음 행동이에요.",
        '[pending_action]{"tool":"add_amora_action","input":{"title":"예식장 후보 비교"}}[/pending_action]',
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
      messages: [{ role: "user", content: userText }],
      weddingContext: {
        weddingDate: "2027-05-01",
        budget: 30_000_000,
        venue: null,
        progress: {},
      },
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(mocks.persist).toHaveBeenCalledTimes(1);
    expect(mocks.persist.mock.calls[0]?.[0]?.metadata).not.toHaveProperty(
      "amora_add_action_proposal_origin_v1",
    );
  });

  it.each([
    {
      label: "first-use grounding",
      sourceMetadata: { amora_first_use_grounding: { version: 1 } },
    },
    {
      label: "first-use promotion id",
      sourceMetadata: {
        amora_first_use_promotion_id:
          "a5000000-0000-4000-8000-000000000099",
      },
    },
    {
      label: "first-use promotion seal",
      sourceMetadata: { amora_first_use_action_promotion_v1: { version: 1 } },
    },
    {
      label: "schedule-care action draft",
      sourceMetadata: { amora_schedule_care_action_draft_v1: { version: 1 } },
    },
    {
      label: "schedule-care follow-up provenance",
      sourceMetadata: { amora_schedule_care_follow_up_v1: { version: 1 } },
    },
    {
      label: "deterministic response origin",
      sourceMetadata: {
        response_origin: "server_authoritative_first_use_promotion",
      },
    },
    {
      label: "provider response origin",
      sourceMetadata: { response_origin: "provider" },
    },
    {
      label: "zero provider-call marker",
      sourceMetadata: { provider_call_count: 0 },
    },
    {
      label: "positive provider-call marker",
      sourceMetadata: { provider_call_count: 1 },
    },
    {
      label: "non-provider persistence source",
      sourceMetadata: {
        persistence_terminal_source: "server_mutation_receipts",
      },
    },
    {
      label: "provider persistence source",
      sourceMetadata: { persistence_terminal_source: "provider" },
    },
    {
      label: "missing canonical source request key",
      sourceMetadata: { client_request_id: null },
    },
    {
      label: "missing source user-message binding",
      sourceMetadata: { in_reply_to_user_message_id: null },
    },
  ])("rejects a forged ordinary-provider source seal combined with $label", ({
    sourceMetadata,
  }) => {
    const application = configureProviderBackedAddActionApplication({
      sourceMetadata,
    });

    expect(parseAmoraProviderBackedAddActionApplicationSource({
      sourceMessage: application.sourceMessage,
      confirmedActionId: application.actionId,
      availableTools: mocks.safeTools,
      expectedJourneyRevision: 0,
      now: Date.now(),
    })).toBeNull();
  });

  it("accepts only the sealed ordinary provider source without deterministic provenance", () => {
    const application = configureProviderBackedAddActionApplication();

    expect(parseAmoraProviderBackedAddActionApplicationSource({
      sourceMessage: application.sourceMessage,
      confirmedActionId: application.actionId,
      availableTools: mocks.safeTools,
      expectedJourneyRevision: 0,
      now: Date.now(),
    })).toMatchObject({
      sourceProposalMessageId: application.sourceMessageId,
      pendingAction: application.pendingAction,
      journeyRevision: 0,
    });
  });

  it.each([
    ["NBSP", "\u00a0"],
    ["OGHAM SPACE MARK", "\u1680"],
    ...Array.from(
      { length: 0x200a - 0x2000 + 1 },
      (_, index) => [`U+${(0x2000 + index).toString(16)}`, String.fromCodePoint(0x2000 + index)],
    ),
    ["NARROW NBSP", "\u202f"],
    ["MEDIUM MATHEMATICAL SPACE", "\u205f"],
    ["IDEOGRAPHIC SPACE", "\u3000"],
  ])("does not seal or parse %s normalization drift in action text", (
    _label,
    whitespace,
  ) => {
    for (const overrides of [
      { actionTitle: `A${whitespace}${whitespace}B` },
      { actionDescription: `A${whitespace}${whitespace}B` },
    ]) {
      const application = configureProviderBackedAddActionApplication(overrides);

      expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
        pendingAction: application.pendingAction,
        isDurableSharedW0: true,
        persistenceSourceIsProvider: true,
        hasApprovedPendingAction: false,
        hasFirstUseProvenance: false,
        scheduleCareDraftStatus: "absent",
        hasResolvedScheduleCareFollowUp: false,
        attachmentCount: 0,
      })).toBe(false);
      expect(parseAmoraProviderBackedAddActionApplicationSource({
        sourceMessage: application.sourceMessage,
        confirmedActionId: application.actionId,
        availableTools: mocks.safeTools,
        expectedJourneyRevision: 0,
        now: Date.now(),
      })).toBeNull();
    }
  });

  it.each(["title", "description", "href"] as const)(
    "does not seal or parse non-BMP text in action %s",
    (field) => {
      const emoji = String.fromCodePoint(0x1f600);
      const application = configureProviderBackedAddActionApplication({
        ...(field === "title" ? { actionTitle: `A${emoji}B` } : {}),
        ...(field === "description"
          ? { actionDescription: `A${emoji}B` }
          : {}),
        ...(field === "href" ? { actionHref: `/A${emoji}B` } : {}),
      });

      expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
        pendingAction: application.pendingAction,
        isDurableSharedW0: true,
        persistenceSourceIsProvider: true,
        hasApprovedPendingAction: false,
        hasFirstUseProvenance: false,
        scheduleCareDraftStatus: "absent",
        hasResolvedScheduleCareFollowUp: false,
        attachmentCount: 0,
      })).toBe(false);
      expect(parseAmoraProviderBackedAddActionApplicationSource({
        sourceMessage: application.sourceMessage,
        confirmedActionId: application.actionId,
        availableTools: mocks.safeTools,
        expectedJourneyRevision: 0,
        now: Date.now(),
      })).toBeNull();
    },
  );

  it.each([
    ["NEXT LINE", "\u0085"],
    ["LINE SEPARATOR", "\u2028"],
    ["PARAGRAPH SEPARATOR", "\u2029"],
    ["BOM", "\ufeff"],
  ])("rejects extractor-hostile %s at the seal boundary too", (
    _label,
    whitespace,
  ) => {
    const application = configureProviderBackedAddActionApplication();
    const pendingAction = {
      ...application.pendingAction,
      input: {
        ...application.pendingAction.input,
        title: `A${whitespace}B`,
      },
    };

    expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
      pendingAction,
      isDurableSharedW0: true,
      persistenceSourceIsProvider: true,
      hasApprovedPendingAction: false,
      hasFirstUseProvenance: false,
      scheduleCareDraftStatus: "absent",
      hasResolvedScheduleCareFollowUp: false,
      attachmentCount: 0,
    })).toBe(false);
  });

  it.each([
    ["121-character title", { actionTitle: "a".repeat(121) }],
    ["501-character description", { actionDescription: "a".repeat(501) }],
    ["181-character href", { actionHref: `/${"a".repeat(180)}` }],
    ["non-rooted href", { actionHref: "wedding/lounge" }],
    ["padded due date", { actionDueDate: " 2026-08-20 " }],
    ["invalid due date", { actionDueDate: "2026-02-30" }],
  ] as const)("does not seal or parse an atomic-invalid %s", (
    _label,
    overrides,
  ) => {
    const application = configureProviderBackedAddActionApplication(overrides);

    expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
      pendingAction: application.pendingAction,
      isDurableSharedW0: true,
      persistenceSourceIsProvider: true,
      hasApprovedPendingAction: false,
      hasFirstUseProvenance: false,
      scheduleCareDraftStatus: "absent",
      hasResolvedScheduleCareFollowUp: false,
      attachmentCount: 0,
    })).toBe(false);
    expect(parseAmoraProviderBackedAddActionApplicationSource({
      sourceMessage: application.sourceMessage,
      confirmedActionId: application.actionId,
      availableTools: mocks.safeTools,
      expectedJourneyRevision: 0,
      now: Date.now(),
    })).toBeNull();
  });

  it.each([
    ["120-character title", { actionTitle: "a".repeat(120) }],
    ["500-character description", { actionDescription: "a".repeat(500) }],
    ["180-character href", { actionHref: `/${"a".repeat(179)}` }],
    ["exact due date", { actionDueDate: "2026-08-20" }],
  ] as const)("keeps an atomic-valid %s eligible", (_label, overrides) => {
    const application = configureProviderBackedAddActionApplication(overrides);

    expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
      pendingAction: application.pendingAction,
      isDurableSharedW0: true,
      persistenceSourceIsProvider: true,
      hasApprovedPendingAction: false,
      hasFirstUseProvenance: false,
      scheduleCareDraftStatus: "absent",
      hasResolvedScheduleCareFollowUp: false,
      attachmentCount: 0,
    })).toBe(true);
    expect(parseAmoraProviderBackedAddActionApplicationSource({
      sourceMessage: application.sourceMessage,
      confirmedActionId: application.actionId,
      availableTools: mocks.safeTools,
      expectedJourneyRevision: 0,
      now: Date.now(),
    })).not.toBeNull();
  });

  it.each(["\t", "\n", "\r"])(
    "does not seal legacy-dispatcher edge whitespace %s in action text",
    (whitespace) => {
      for (const overrides of [
        { actionTitle: `${whitespace}A` },
        { actionDescription: `A${whitespace}` },
      ]) {
        const application = configureProviderBackedAddActionApplication(overrides);

        expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
          pendingAction: application.pendingAction,
          isDurableSharedW0: true,
          persistenceSourceIsProvider: true,
          hasApprovedPendingAction: false,
          hasFirstUseProvenance: false,
          scheduleCareDraftStatus: "absent",
          hasResolvedScheduleCareFollowUp: false,
          attachmentCount: 0,
        })).toBe(false);
        expect(parseAmoraProviderBackedAddActionApplicationSource({
          sourceMessage: application.sourceMessage,
          confirmedActionId: application.actionId,
          availableTools: mocks.safeTools,
          expectedJourneyRevision: 0,
          now: Date.now(),
        })).toBeNull();
      }
    },
  );

  it.each([
    ["interior tab", { actionTitle: "A\tB" }],
    ["plain-space edges", { actionDescription: " A " }],
  ] as const)("keeps legacy-dispatcher-compatible %s eligible", (
    _label,
    overrides,
  ) => {
    const application = configureProviderBackedAddActionApplication(overrides);
    expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
      pendingAction: application.pendingAction,
      isDurableSharedW0: true,
      persistenceSourceIsProvider: true,
      hasApprovedPendingAction: false,
      hasFirstUseProvenance: false,
      scheduleCareDraftStatus: "absent",
      hasResolvedScheduleCareFollowUp: false,
      attachmentCount: 0,
    })).toBe(true);
  });

  it.each([
    { label: "private", isDurableSharedW0: false, persistenceSourceIsProvider: true },
    { label: "W1", isDurableSharedW0: false, persistenceSourceIsProvider: true },
    { label: "demo", isDurableSharedW0: false, persistenceSourceIsProvider: true },
    { label: "non-provider terminal", isDurableSharedW0: true, persistenceSourceIsProvider: false },
  ])("does not seal a $label provider add-action proposal", ({
    isDurableSharedW0,
    persistenceSourceIsProvider,
  }) => {
    const application = configureProviderBackedAddActionApplication();

    expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
      pendingAction: application.pendingAction,
      isDurableSharedW0,
      persistenceSourceIsProvider,
      hasApprovedPendingAction: false,
      hasFirstUseProvenance: false,
      scheduleCareDraftStatus: "absent",
      hasResolvedScheduleCareFollowUp: false,
      attachmentCount: 0,
    })).toBe(false);
  });

  it.each(["mc", "gift"] as const)(
    "does not seal or parse an omitted-href %s proposal while TS and SQL defaults differ",
    async (actionCategoryKey) => {
      const application = configureProviderBackedAddActionApplication({
        actionCategoryKey,
      });

      expect(shouldSealAmoraOrdinaryProviderAddActionProposal({
        pendingAction: application.pendingAction,
        isDurableSharedW0: true,
        persistenceSourceIsProvider: true,
        hasApprovedPendingAction: false,
        hasFirstUseProvenance: false,
        scheduleCareDraftStatus: "absent",
        hasResolvedScheduleCareFollowUp: false,
        attachmentCount: 0,
      })).toBe(false);
      expect(parseAmoraProviderBackedAddActionApplicationSource({
        sourceMessage: application.sourceMessage,
        confirmedActionId: application.actionId,
        availableTools: mocks.safeTools,
        expectedJourneyRevision: 0,
        now: Date.now(),
      })).toBeNull();

      const rpcResponse = await mocks.adminRpc(
        "finalize_amora_provider_backed_add_action_application_v1",
        {
          p_chat_request_key:
            application.receiptMetadata.client_request_id,
        },
      );
      expect(parseAmoraProviderBackedAddActionApplication({
        value: rpcResponse.data,
        expectedChatRequestKey:
          application.receiptMetadata.client_request_id,
        expectedVisibleRequestKey:
          application.receiptMetadata.client_visible_request_id,
        expectedConfirmationMessageId:
          application.receiptMetadata.in_reply_to_user_message_id,
        expectedSourceMessageId: application.sourceMessageId,
        expectedPendingAction: application.pendingAction,
        expectedJourneyRevision: 0,
        expectedCoupleId: COUPLE_ID,
      })).toBeNull();
    },
  );

  it.each(["mc", "gift"] as const)(
    "keeps an explicit valid href eligible for a sealed %s proposal",
    (actionCategoryKey) => {
      const application = configureProviderBackedAddActionApplication({
        actionCategoryKey,
        actionHref: "/wedding/chat",
      });

      expect(parseAmoraProviderBackedAddActionApplicationSource({
        sourceMessage: application.sourceMessage,
        confirmedActionId: application.actionId,
        availableTools: mocks.safeTools,
        expectedJourneyRevision: 0,
        now: Date.now(),
      })).not.toBeNull();
    },
  );

  it("applies an exact ordinary provider-generated add-action with one canonical server receipt and no provider work", async () => {
    const application = configureProviderBackedAddActionApplication();
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "이 문장은 deterministic 경로에서 사용되면 안 돼요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);
    const claimedRequestKey = mocks.claim.mock.calls[0]?.[0]?.requestKey;

    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "finalize_amora_provider_backed_add_action_application_v1",
      {
        p_couple_id: COUPLE_ID,
        p_actor_user_id: "00000000-0000-4000-8000-000000000001",
        p_source_proposal_message_id: application.sourceMessageId,
        p_confirmation_message_id:
          "30000000-0000-4000-8000-000000000001",
        p_chat_request_key: claimedRequestKey,
        p_chat_claim_attempt_count: 1,
        p_expected_privacy_epoch: 7,
      },
    );
    expect(responseText).toContain(
      `"fullContent":${JSON.stringify(application.displayMessage)}`,
    );
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(responseText).toContain(
      '"response_origin":"server_authoritative_provider_backed_add_action_application"',
    );
    expect(responseText).toContain(
      `"source_amora_action_message_id":"${application.sourceMessageId}"`,
    );
    expect(responseText).toContain('"provider_call_count":0');
    expect(responseText).toContain('"toolName":"add_amora_action"');
    expect(responseText).toContain(`"id":"${application.savedActionId}"`);
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it("releases a racing ordinary provider add-action application replay without provider work", async () => {
    const application = configureProviderBackedAddActionApplication({
      outcome: "replayed",
      messageReused: true,
    });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain('"replayed":true');
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("replays a committed ordinary provider add-action application before its finalizer", async () => {
    const application = configureProviderBackedAddActionApplication();
    mocks.findPersisted.mockResolvedValue(application.buildPersistedMessage());

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(responseText).toContain('"replayed":true');
    expect(responseText).toContain(
      `"serverMessageId":"${application.receiptMessageId}"`,
    );
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) =>
          name === "finalize_amora_provider_backed_add_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("withholds a partial ordinary-provider application receipt instead of replaying it generically", async () => {
    const application = configureProviderBackedAddActionApplication();
    const persistedApplication = application.buildPersistedMessage();
    mocks.findPersisted.mockResolvedValue({
      ...persistedApplication,
      metadata: {
        client_request_id: application.receiptMetadata.client_request_id,
        source_amora_action_message_id: application.sourceMessageId,
      },
    });

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: application.actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PROVIDER_BACKED_ADD_ACTION_APPLICATION_REPLAY_INVALID",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("classifies exact and partial ordinary-provider receipts without capturing legacy provider receipts", () => {
    const application = configureProviderBackedAddActionApplication();
    const applicationMetadata = application.buildPersistedMessage().metadata;

    expect(
      requiresStrictAmoraProviderBackedAddActionApplicationReplay(
        applicationMetadata,
      ),
    ).toBe(true);
    expect(requiresStrictAmoraProviderBackedAddActionApplicationReplay({
      source_amora_action_message_id: application.sourceMessageId,
    })).toBe(true);
    expect(requiresStrictAmoraProviderBackedAddActionApplicationReplay({
      confirmed_amora_action_id: application.actionId,
      toolResults: [application.toolResult],
      provider_call_count: 0,
    })).toBe(true);
    expect(requiresStrictAmoraProviderBackedAddActionApplicationReplay({
      confirmed_amora_action_id: application.actionId,
      toolResults: [application.toolResult],
      provider_call_count: 1,
      response_origin: "provider",
      model: "legacy-provider-model",
    })).toBe(false);
  });

  it.each(["mc", "gift"] as const)(
    "keeps an omitted-href %s action confirmation off the deterministic finalizer",
    async (actionCategoryKey) => {
      const application = configureProviderBackedAddActionApplication({
        actionCategoryKey,
      });
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: "기존 provider-backed 승인 경로에서 처리했어요.",
        usage: { input_tokens: 10, output_tokens: 4 },
      }));

      const response = await POST(request({
        messages: [{
          role: "user",
          content: FIRST_USE_APPLICATION_CONFIRMATION,
        }],
        confirmedActionId: application.actionId,
      }));
      const responseText = await response.text();

      expect(response.status, responseText).toBe(200);
      expect(
        mocks.adminRpc.mock.calls.filter(
          ([name]) =>
            name === "finalize_amora_provider_backed_add_action_application_v1",
        ),
      ).toHaveLength(0);
      expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
      expect(mocks.provider).toHaveBeenCalledTimes(1);
      expect(mocks.reserve).toHaveBeenCalledTimes(1);
      expect(mocks.executeTool).toHaveBeenCalledWith(
        "add_amora_action",
        application.actionInput,
        expect.objectContaining({ pendingActionId: application.actionId }),
      );
    },
  );

  it("keeps a mixed ordinary-provider add-action confirmation on the existing provider path", async () => {
    const application = configureProviderBackedAddActionApplication();
    const mixedText =
      `${FIRST_USE_APPLICATION_CONFIRMATION} 그리고 예식장 비교 기준도 알려줘.`;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: mixedText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "행동 카드 결과와 비교 기준을 함께 정리할게요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: mixedText }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) =>
          name === "finalize_amora_provider_backed_add_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_amora_action",
      application.actionInput,
      expect.objectContaining({ pendingActionId: application.actionId }),
    );
  });

  it("keeps an attached ordinary-provider add-action confirmation on the existing provider path", async () => {
    const application = configureProviderBackedAddActionApplication();
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    await bindCanonicalProviderAttachments([attachment]);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "행동 카드 결과와 첨부 내용을 함께 확인할게요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      attachments: [{ ...attachment, fileName: "context.png" }],
      confirmedActionId: application.actionId,
    }));
    const responseText = await response.text();

    expect(response.status, responseText).toBe(200);
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) =>
          name === "finalize_amora_provider_backed_add_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_amora_action",
      application.actionInput,
      expect.objectContaining({ pendingActionId: application.actionId }),
    );
  });

  it.each([
    { label: "schedule-care add-action", scheduleCareMetadata: true },
  ])("keeps an $label confirmation on the provider-backed path", async ({
    scheduleCareMetadata,
  }) => {
    const actionId = "a2000000-0000-4000-8000-000000000099";
    const issuedAt = Date.now();
    const actionInput = {
      title: "후속 할 일 정리",
      description: "두 사람이 확인할 준비 행동",
      category_key: "general",
      priority: "medium",
      source: "chat",
    };
    const pendingAction = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        tool: "add_amora_action",
        input: actionInput,
      })}[/pending_action]`,
      allowedTools: mocks.safeTools,
      now: issuedAt,
      createActionId: () => actionId,
    }).pendingAction!;
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
        metadata: { client_request_id: REQUEST_ID },
        visibility: "shared",
        created_at: "2026-08-16T00:01:00.000Z",
      },
      {
        id: "a3000000-0000-4000-8000-000000000099",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: pendingAction.confirmation,
        metadata: {
          pending_amora_action: pendingAction,
          pending_amora_action_journey_revision: 0,
          ...(scheduleCareMetadata
            ? {
                amora_schedule_care_action_draft_v1: {
                  version: 1,
                  title: actionInput.title,
                },
              }
            : {}),
        },
        visibility: "shared",
        created_at: new Date(issuedAt).toISOString(),
      },
    );
    const displayMessage = `"${actionInput.title}"을 아모라 행동 카드로 저장했어요.`;
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "add_amora_action",
      toolInput: actionInput,
      toolOutput: { action: { id: "act_ordinary", status: "open" } },
      success: true,
      displayMessage,
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "행동 카드 저장 결과를 확인했어요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{
        role: "user",
        content: FIRST_USE_APPLICATION_CONFIRMATION,
      }],
      confirmedActionId: actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_application_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_amora_action",
      actionInput,
      expect.objectContaining({ pendingActionId: actionId }),
    );
  });

  it.each([
    {
      label: "stale deterministic proposal state",
      rpcError: {
        code: "40001",
        message: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_CLAIM_STALE",
      },
      status: 409,
      code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_STALE",
      retryPolicy: "regenerate_first_use_action",
    },
    {
      label: "privacy context changed during deterministic finalization",
      rpcError: {
        code: "42501",
        message: "AMORA_FIRST_USE_PROMOTION_SCOPE_CHANGED",
      },
      status: 409,
      code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_STALE",
      retryPolicy: "regenerate_first_use_action",
    },
    {
      label: "deterministic proposal infrastructure outage",
      rpcError: {
        code: "42501",
        message:
          "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_SERVICE_ROLE_REQUIRED",
      },
      status: 503,
      code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_UNAVAILABLE",
      retryPolicy: "same_request",
    },
    {
      label: "deterministic replay invariant failure",
      rpcError: {
        code: "55000",
        message: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_REPLAY_INVALID",
      },
      status: 503,
      code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVARIANT_FAILED",
      retryPolicy: "new_message",
    },
  ])("maps $label without provider work", async ({
    rpcError,
    status,
    code,
    retryPolicy,
  }) => {
    const { userText } = configureDeterministicFirstUseProposal({
      promotionId: "93000000-0000-4000-8000-000000000001",
      finalError: rpcError,
    });

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({
      code,
      retryPolicy,
    });
    expect(mocks.failClaim).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("replays an exact committed deterministic proposal without finalizer or provider work", async () => {
    const {
      userText,
      actionId,
      buildPersistedMessage,
    } = configureDeterministicFirstUseProposal({
      promotionId: "94000000-0000-4000-8000-000000000001",
      actionId: "95000000-0000-4000-8000-000000000001",
      assistantMessageId: "96000000-0000-4000-8000-000000000001",
    });
    mocks.findPersisted.mockResolvedValue(buildPersistedMessage());

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(responseText).toContain(`"actionId":"${actionId}"`);
    expect(responseText).toContain('"replayed":true');
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_proposal_v1",
      ),
    ).toHaveLength(0);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  });

  it("withholds a committed deterministic proposal when privacy changes and never fails its completed claim", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { userText } = configureDeterministicFirstUseProposal();
    mocks.getPrivacyEpoch.mockReset();
    mocks.getPrivacyEpoch
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(8);

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_CHANGED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(
      mocks.adminRpc.mock.calls.filter(
        ([name]) => name === "finalize_amora_first_use_action_proposal_v1",
      ),
    ).toHaveLength(1);
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rejects fake provider metadata from a committed deterministic proposal without overwriting its claim", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { userText } = configureDeterministicFirstUseProposal({
      finalMetadata: { model: "fake-provider-model" },
    });

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_FIRST_USE_DETERMINISTIC_PROPOSAL_INVALID",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("keeps a server-guarded verification action proposal-capable without bypassing high-risk scope", async () => {
    const canonicalActionInput = {
      action: "계약·결제 상태 확인하기",
      reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
      completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
    };
    const {
      promotionId,
      actionId,
      canonicalAddActionInput,
      userText,
    } = configureDeterministicFirstUseProposal({
      promotionId: "90000000-0000-4000-8000-000000000003",
      actionId: "97000000-0000-4000-8000-000000000001",
      assistantMessageId: "98000000-0000-4000-8000-000000000001",
      canonicalActionInput,
    });

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(responseText).toContain('"question_scope":"W0_wedding_core"');
    expect(responseText).toContain(
      `"amora_first_use_promotion_id":"${promotionId}"`,
    );
    expect(responseText).toContain(`"actionId":"${actionId}"`);
    expect(responseText).toContain(JSON.stringify(canonicalAddActionInput));
    expect(mocks.providerLedger).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("does not let a valid first-use receipt launder legal judgment into an action proposal", async () => {
    const promotionId = "90000000-0000-4000-8000-000000000004";
    const canonicalActionInput = {
      action: "계약서 조항의 법적 효력 판단하기",
      reason: "위약금 조항이 법적으로 유효한지 결론이 필요해요.",
      completionCriterion: "계약 해지 권리를 확정하면 끝나요.",
    };
    const canonicalAddActionInput = {
      title: canonicalActionInput.action,
      description: `이유: ${canonicalActionInput.reason} 완료 기준: ${canonicalActionInput.completionCriterion}`,
      category_key: "general",
      priority: "medium",
      source: "chat",
    };
    const userText = [
      "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
      `지금 할 한 가지: ${canonicalActionInput.action}`,
      `이유: ${canonicalActionInput.reason}`,
      `완료 기준: ${canonicalActionInput.completionCriterion}`,
      "저장 전에는 확인 카드만 보여줘.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      metadata: {
        client_request_id: REQUEST_ID,
        amora_first_use_promotion_id: promotionId,
      },
    };
    mocks.adminRpc.mockImplementation(async (name: string) => (
      name === "validate_amora_first_use_action_promotion_v1"
        ? {
            data: {
              version: 1,
              promotionId,
              canonicalActionInput,
              canonicalAddActionInput,
            },
            error: null,
          }
        : { data: { authorized: true }, error: null }
    ));
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"add_amora_action","input":{"title":"법적 효력 확정"}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W2_high_risk_adjacent",
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "pending_amora_action",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_promotion_id",
    );
  });

  it.each([
    {
      label: "forged receipt",
      error: {
        code: "22023",
        message: "AMORA_FIRST_USE_PROMOTION_SOURCE_INVALID",
      },
      status: 409,
      code: "AMORA_FIRST_USE_PROMOTION_STALE",
    },
    {
      label: "service-role validation outage",
      error: {
        code: "42501",
        message: "AMORA_FIRST_USE_PROMOTION_SERVICE_ROLE_REQUIRED",
      },
      status: 503,
      code: "AMORA_FIRST_USE_PROMOTION_UNAVAILABLE",
    },
  ])("fails $label closed before provider work", async ({ error, status, code }) => {
    const userText = [
      "나만 상담에서 정리한 이 한 가지를 둘이 볼 실행 카드로 제안해줘.",
      "지금 할 한 가지: 가능한 예식 시기 두 개 적기",
      "이유: 다음 준비의 기준이 필요해요.",
      "완료 기준: 두 사람이 시기 두 개를 확인하면 끝나요.",
      "저장 전에는 확인 카드만 보여줘.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      metadata: {
        client_request_id: REQUEST_ID,
        amora_first_use_promotion_id:
          "90000000-0000-4000-8000-000000000001",
      },
    };
    mocks.adminRpc.mockResolvedValueOnce({ data: null, error });

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it("rejects a request that is not bound to the authenticated user's durable message", async () => {
    const response = await POST(request({
      userMessageId: "30000000-0000-4000-8000-000000000099",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "USER_MESSAGE_SCOPE_MISMATCH" });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("rejects a different client request id for the same durable user row before claiming", async () => {
    const response = await POST(request({
      clientRequestId: "00000000-0000-4000-8000-000000000098",
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("rejects a durable user row without its canonical request id before claiming", async () => {
    mocks.canonicalRequestBindingId = null;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: null,
    };

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_REQUEST_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a cold-start text-only replay when the durable row requires an attachment", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
      },
    };

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("continues a user-approved text-only recovery when the v1 contract matches", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
      },
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "중단된 답변을 이어서 정리했어요.",
      usage: { input_tokens: 6, output_tokens: 4 },
    }));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("rejects different attachment bytes even when the ordered count and media type match", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 첨부를 확인해줘",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 2,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
        provider_attachment_manifest: [{
          media_type: "image/png",
          byte_length: 5,
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        }],
        imagePaths: [await createChatImageObjectPathV2({
          coupleId: COUPLE_ID,
          senderId: mocks.authenticatedUser?.id ?? "",
          clientRequestId: REQUEST_ID,
          attachmentIndex: 0,
          mediaType: "image/png",
          sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        })],
      },
    };

    const response = await POST(request({
      messages: [{ role: "user", content: "이 첨부를 확인해줘" }],
      attachments: [{
        mediaType: "image/png",
        base64: "SEVMTE8=",
        fileName: "changed.png",
      }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects canonical image paths that are not bound to the v2 attachment digest", async () => {
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "첨부 이미지와 분석 바이트를 함께 확인해줘",
    };
    await bindCanonicalProviderAttachments([attachment]);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        ...(mocks.canonicalRows[0]?.metadata as Record<string, unknown>),
        imagePaths: [
          `${COUPLE_ID}/${mocks.authenticatedUser?.id}/40000000-0000-4000-8000-000000000001.png`,
        ],
      },
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "첨부를 확인했어요.",
      usage: { input_tokens: 6, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "첨부 이미지와 분석 바이트를 함께 확인해줘" }],
      attachments: [{ ...attachment, fileName: "image.png" }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_CONTRACT_INVALID",
      retryPolicy: "new_message",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects changed Storage object bytes before the v2 attachment reaches the provider", async () => {
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "첨부 이미지와 분석 바이트를 함께 확인해줘",
    };
    await bindCanonicalProviderAttachments([attachment]);
    mocks.storageDownloadStream.mockResolvedValueOnce({
      data: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("world"));
          controller.close();
        },
      }),
      error: null,
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "첨부를 확인했어요.",
      usage: { input_tokens: 6, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "첨부 이미지와 분석 바이트를 함께 확인해줘" }],
      attachments: [{ ...attachment, fileName: "image.png" }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_STORAGE_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.storageFrom).toHaveBeenCalledWith("chat-image");
    expect(mocks.storageDownload).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a missing canonical v2 image object before claim or provider work", async () => {
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "Check the attached image",
    };
    await bindCanonicalProviderAttachments([attachment]);
    mocks.storageInfo.mockResolvedValueOnce({
      data: null,
      error: { statusCode: 404, message: "object not found" },
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "Check the attached image" }],
      attachments: [{ ...attachment, fileName: "image.png" }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_STORAGE_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.storageInfo).toHaveBeenCalledTimes(1);
    expect(mocks.storageDownload).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("continues to the provider when the ordered v2 attachment bytes match exactly", async () => {
    const mediaType = "image/png";
    const base64 = "aGVsbG8=";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 첨부를 확인해줘",
    };
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "첨부 내용을 확인했어요.",
      usage: { input_tokens: 6, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "이 첨부를 확인해줘" }],
      attachments: [{ mediaType, base64, fileName: "private-name.png" }],
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.claim).toHaveBeenCalledTimes(1);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("rejects a v2 retry when the same attachment bytes are supplied in a different order", async () => {
    const first = { mediaType: "image/png", base64: "aGVsbG8=" };
    const second = { mediaType: "application/pdf", base64: "d29ybGQ=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "두 첨부를 순서대로 확인해줘",
    };
    await bindCanonicalProviderAttachments([first, second]);

    const response = await POST(request({
      messages: [{ role: "user", content: "두 첨부를 순서대로 확인해줘" }],
      attachments: [
        { ...second, fileName: "second.pdf" },
        { ...first, fileName: "first.png" },
      ],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("never starts a new provider call for a positive-count v1 attachment row", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "구형 첨부를 확인해줘",
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 1,
      },
    };

    const response = await POST(request({
      messages: [{ role: "user", content: "구형 첨부를 확인해줘" }],
      attachments: [{
        mediaType: "image/png",
        base64: "aGVsbG8=",
        fileName: "legacy.png",
      }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a non-demo attachment provider request without an exact durable user message id", async () => {
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "첨부를 확인해줘",
    };
    await bindCanonicalProviderAttachments([attachment]);

    const response = await POST(request({
      userMessageId: undefined,
      messages: [{ role: "user", content: "첨부를 확인해줘" }],
      attachments: [{ ...attachment, fileName: "missing-binding.png" }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_BINDING_MISMATCH",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("replays an already persisted answer before consuming mismatched resent attachment bytes", async () => {
    const original = { mediaType: "image/png", base64: "aGVsbG8=" };
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "첨부 답변을 이어줘",
    };
    await bindCanonicalProviderAttachments([original]);
    mocks.findPersisted.mockResolvedValue({
      ...persisted("이미 저장된 첨부 답변이에요."),
      reused: true,
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "첨부 답변을 이어줘" }],
      attachments: [{
        mediaType: "image/png",
        base64: "SEVMTE8=",
        fileName: "changed-after-completion.png",
      }],
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("이미 저장된 첨부 답변이에요.");
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects an internally inconsistent v1 attachment contract before paid work", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 1,
      },
    };

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_CONTRACT_INVALID",
      retryPolicy: "new_message",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a canonical v2 manifest whose declared total exceeds the provider limit", async () => {
    const oversizedPart = Math.floor(AMORA_MAX_TOTAL_ATTACHMENT_BYTES / 2) + 1;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 2,
        ai_response_requested: true,
        provider_attachment_state: "present",
        provider_attachment_count: 2,
        provider_attachment_manifest: [
          {
            media_type: "application/pdf",
            byte_length: oversizedPart,
            sha256: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
          },
          {
            media_type: "application/pdf",
            byte_length: oversizedPart,
            sha256: "486ea46224d1bb4fb680f34f7c9ad96a8f24ec88be73ea8e5a6c65260e9cb8a7",
          },
        ],
      },
    };

    const response = await POST(request());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_ATTACHMENT_CONTRACT_INVALID",
      retryPolicy: "new_message",
    });
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.storageDownload).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("blocks a legacy mutation checkpoint while continuing the reclaimed turn", async () => {
    const reasoning = {
      id: "rs_resume",
      type: "reasoning",
      summary: [],
      encrypted_content: "opaque-resume-reasoning",
    };
    const functionCall = {
      id: "fc_resume",
      type: "function_call",
      call_id: "call_resume",
      name: "update_budget",
      arguments: JSON.stringify({ total_budget: 30_000_000 }),
      status: "completed",
    };
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    mocks.journal.push({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      toolCalls: [{
        callId: "call_resume",
        name: "update_budget",
        input: { total_budget: 30_000_000 },
        inputDigest: "a".repeat(64),
        operationKey: "b".repeat(64),
      }],
      outputItems: [reasoning, functionCall],
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "확인 절차가 없는 변경은 실행하지 않았어요.",
      outputItems: [{ id: "msg_resume", type: "message" }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("실행하지 않았어요.");

    expect(mocks.loadJournal).toHaveBeenCalledWith(expect.objectContaining({
      attemptCount: 2,
    }));
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ callIndex: 2, phase: "tool_round" }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.executeTool).not.toHaveBeenCalled();
    const continuationInput = mocks.provider.mock.calls[0]?.[0]?.input as unknown[];
    expect(continuationInput).toEqual(expect.arrayContaining([
      reasoning,
      functionCall,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_resume",
      }),
    ]));
    expect(JSON.stringify(continuationInput)).toContain(
      "MODEL_MUTATION_TOOL_BLOCKED",
    );
  });

  it("resumes an allowed read checkpoint without regenerating its provider call", async () => {
    const reasoning = {
      id: "rs_resume_read",
      type: "reasoning",
      summary: [],
      encrypted_content: "opaque-resume-read-reasoning",
    };
    const functionCall = {
      id: "fc_resume_read",
      type: "function_call",
      call_id: "call_resume_read",
      name: "get_wedding_info",
      arguments: "{}",
      status: "completed",
    };
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    mocks.journal.push({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      toolCalls: [{
        callId: "call_resume_read",
        name: "get_wedding_info",
        input: {},
        inputDigest: "c".repeat(64),
        operationKey: "d".repeat(64),
      }],
      outputItems: [reasoning, functionCall],
    });
    mocks.executeTool.mockResolvedValue({
      toolName: "get_wedding_info",
      toolInput: {},
      toolOutput: { wedding_date: null, total_budget: 0 },
      success: true,
      displayMessage: "현재 결혼 준비 정보를 확인했어요.",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 결혼 준비 정보를 확인했어요.",
      outputItems: [{ id: "msg_resume_read", type: "message" }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("현재 결혼 준비 정보를 확인했어요.");

    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ callIndex: 2, phase: "tool_round" }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "get_wedding_info",
      {},
      expect.objectContaining({ providerCallIndex: 1 }),
    );
    const continuationInput = mocks.provider.mock.calls[0]?.[0]?.input as unknown[];
    expect(continuationInput).toEqual(expect.arrayContaining([
      reasoning,
      functionCall,
      expect.objectContaining({
        type: "function_call_output",
        call_id: "call_resume_read",
      }),
    ]));
  });

  it("replays the exact confirmed server action before continuing a journaled tool round", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const pendingAction = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
      allowedTools: mocks.safeTools,
      now,
      createActionId: () => actionId,
    }).pendingAction;
    expect(pendingAction).not.toBeNull();
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 2,
      reclaimed: true,
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "Yes",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "Change the budget?",
        metadata: {
          pending_amora_action: pendingAction,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.journal.push({
      version: 1,
      callIndex: 1,
      phase: "tool_round",
      toolCalls: [{
        callId: "call_read",
        name: "get_wedding_info",
        input: {},
        inputDigest: "a".repeat(64),
        operationKey: "b".repeat(64),
      }],
      outputItems: [{
        id: "fc_read",
        type: "function_call",
        call_id: "call_read",
        name: "get_wedding_info",
        arguments: "{}",
        status: "completed",
      }],
    });
    mocks.executeTool.mockImplementation(async (toolName: string, toolInput: unknown) => ({
      toolName,
      toolInput,
      toolOutput: toolName === "update_budget"
        ? { total_budget: 30_000_000, previous_budget: 10_000_000 }
        : { total_budget: 30_000_000 },
      success: true,
      displayMessage: "Done.",
    }));
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "The confirmed change is complete.",
      outputItems: [{ id: "msg_terminal", type: "message" }],
      usage: { input_tokens: 20, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "Yes" }],
      confirmedActionId: actionId,
    }));
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);

    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({
        pendingActionId: actionId,
        actorProfileId: "00000000-0000-4000-8000-000000000001",
      }),
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "get_wedding_info",
      {},
      expect.objectContaining({ providerCallIndex: 1 }),
    );
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
      .toContain("SERVER_CONFIRMED_ACTION_RESULT");
  });

  it("keeps the schedule actor and internal event ID out of confirmed-action provider feedback", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const eventId = "22222222-2222-4222-8222-222222222222";
    const actorId = "00000000-0000-4000-8000-000000000001";
    const input = {
      event_id: eventId,
      expected_title: "드레스 최종 피팅",
      expected_date: "2026-08-20",
      reason: "업체 일정 변경",
    };
    const pendingAction = extractAmoraPendingAction({
      text: `[pending_action]${JSON.stringify({
        tool: "cancel_schedule_event",
        input,
      })}[/pending_action]`,
      allowedTools: mocks.safeTools,
      now,
      createActionId: () => actionId,
    }).pendingAction;
    expect(pendingAction).not.toBeNull();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: actorId,
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "드레스 최종 피팅 일정을 취소 상태로 남길까요?",
        metadata: { pending_amora_action: pendingAction },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "cancel_schedule_event",
      toolInput: input,
      toolOutput: {
        event: {
          id: eventId,
          date: "2026-08-20",
          title: "드레스 최종 피팅",
          status: "cancelled",
          cancellation: {
            cancelledAt: "2026-08-02T03:04:05.000Z",
            cancelledByProfileId: actorId,
            reason: "업체 일정 변경",
          },
        },
      },
      success: true,
      displayMessage: "드레스 최종 피팅 일정을 취소 상태로 남겼어요.",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "취소 기록을 남겼어요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    const responseText = await response.text();
    expect(response.status, responseText).toBe(200);
    expect(responseText).not.toContain(eventId);
    expect(responseText).not.toContain("cancelledByProfileId");
    const streamedToolResult = responseText
      .split(/\r?\n/)
      .find((line) => line.includes('"type":"tool_result"')) ?? "";
    expect(streamedToolResult).not.toContain(actorId);

    const confirmedResultInput = String((
      mocks.provider.mock.calls[0]?.[0]?.input as Array<{ content?: unknown }>
    ).find((item) => String(item.content).includes(
      "SERVER_CONFIRMED_ACTION_RESULT",
    ))?.content);
    expect(confirmedResultInput).toContain("드레스 최종 피팅");
    expect(confirmedResultInput).toContain("업체 일정 변경");
    expect(confirmedResultInput).not.toContain(eventId);
    expect(confirmedResultInput).not.toContain(actorId);
    expect(confirmedResultInput).not.toContain("cancelledByProfileId");
  });

  it("passes the durable normal-chat user message into the request claim", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "확인했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000001",
      userMessageId: "30000000-0000-4000-8000-000000000001",
      visibility: "shared",
    }));
  });

  it.each([
    ["initial_greeting", {}],
    ["mediation", { conflictContext: "일정과 예산 우선순위가 달라요" }],
  ])("disables mutation tools for %s requests", async (requestKind, extra) => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "안전한 안내 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ requestKind, ...extra }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual([]);
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).not.toContain("`update_budget`");
    expect(mocks.executeTool).not.toHaveBeenCalled();
    if (requestKind === "mediation") {
      expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
        "구조화 중재 최종 안전 계약",
      );
    }
  });

  it("does not promote a mediation marker from an ordinary chat response", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "일반 상담 답변이에요.",
        "[mediation]",
        "공감: 요청자가 답답함을 느꼈다고 전했어요.",
        "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
        "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
        "합의안: 두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
        "[/mediation]",
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 20 },
    }));

    const response = await POST(request({ requestKind: "chat" }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toBe("일반 상담 답변이에요.");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
  });

  it("demotes a marker-only ordinary chat response to readable text", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "[mediation]",
        "공감: 요청자가 답답함을 느꼈다고 전했어요.",
        "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
        "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
        "합의안: 두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
        "[/mediation]",
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 20 },
    }));

    const response = await POST(request({ requestKind: "chat" }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toContain(
      "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
  });

  it("stamps a complete requested mediation draft with server-owned v2 provenance", async () => {
    const providerText = [
      "요청자가 전한 내용을 바탕으로 정리했어요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
      "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
      "합의안: 두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
      "[/mediation]",
    ].join("\n");
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(providerText);
      return providerResult({
        fullText: providerText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "예산 상한에 대한 생각이 다른 것 같아요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain("[mediation]");
    expect(body).not.toContain("[/mediation]");

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      memory_eligible: false,
      mediation: {
        empathy: "요청자가 답답함을 느꼈다고 전했어요.",
        translation: "요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
        data: "상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
        resolution: "두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
        origin: "user_requested",
        evidenceScope: "requester_summary_only",
        schemaVersion: 2,
      },
    });
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.atomicFinalizations[0]).toMatchObject({
      message: {
        stageTag: null,
        specialistType: "general",
        metadata: expect.objectContaining({ memory_eligible: false }),
      },
    });
  });

  it("drops provider suggestions from mediation turns so a biased action chip cannot bypass the card guard", async () => {
    const providerText = [
      "요청자가 전한 내용을 바탕으로 정리했어요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
      "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
      "합의안: 두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
      "[/mediation]",
      "[suggestions]",
      "신랑이 먼저 사과하기",
      "[/suggestions]",
    ].join("\n");
    mocks.extractSuggestions.mockReturnValueOnce({
      cleanText: providerText.replace(
        "[suggestions]\n신랑이 먼저 사과하기\n[/suggestions]",
        "",
      ).trim(),
      suggestions: ["신랑이 먼저 사과하기"],
    });
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(providerText);
      return providerResult({
        fullText: providerText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "예산 상한에 대한 생각이 다른 것 같아요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("suggestions");
    expect(body).not.toContain('"type":"suggestions"');
    expect(body).not.toContain("신랑이 먼저 사과하기");
  });

  it("replaces a rejected one-sided mediation card with deterministic neutral guidance", async () => {
    const biasedProviderText = [
      "요청자가 전한 내용을 바탕으로 정리했어요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 요청자가 맞아요.",
      "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
      "합의안: 민수님이 양보하고 사과하세요.",
      "[/mediation]",
    ].join("\n");
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(biasedProviderText);
      return providerResult({
        fullText: biasedProviderText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "예산 상한에 대한 생각이 다른 것 같아요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.content).toContain("잘잘못이나 속마음을 단정하지 않고");
    expect(mocks.atomicResponses[0]?.content).toContain("확인된 사실");
    expect(mocks.atomicResponses[0]?.content).not.toContain("요청자가 맞아요");
    expect(mocks.atomicResponses[0]?.content).not.toContain("민수님이 양보");
    expect(body).toContain("잘잘못이나 속마음을 단정하지 않고");
    expect(body).not.toContain("요청자가 맞아요");
    expect(body).not.toContain("민수님이 양보");
  });

  it("promotes reverse-order financial authority detection through persistence and SSE", async () => {
    const biasedProviderText = [
      "요청자가 전한 내용을 바탕으로 정리했어요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
      "데이터: 신랑이 더 많은 비용을 부담할 수 있다고 전했어요.",
      "합의안: 결정권은 돈을 70% 내는 신랑에게 있어야 해요.",
      "[/mediation]",
    ].join("\n");
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(biasedProviderText);
      return providerResult({
        fullText: biasedProviderText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "예산 기여 비율 때문에 의견이 달라요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.content).toContain("확인된 사실");
    expect(mocks.atomicResponses[0]?.content).not.toContain("결정권은");
    expect(body).not.toContain("결정권은");
  });

  it("does not repeat an attributed insult or one-sided demand in persisted or streamed mediation output", async () => {
    const biasedProviderText = [
      "요청자가 전한 내용을 바탕으로 정리했어요.",
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      '통역: 요청자는 "신랑이 이기적이고 먼저 사과해야 한다"고 말했어요.',
      "데이터: 상대방의 입장은 아직 확인되지 않았어요.",
      "합의안: 두 사람이 각자 원하는 기준을 적어 비교해 보세요.",
      "[/mediation]",
    ].join("\n");
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(biasedProviderText);
      return providerResult({
        fullText: biasedProviderText,
        usage: { input_tokens: 10, output_tokens: 20 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "사과 순서 때문에 의견이 달라요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.content).toContain("확인된 사실");
    expect(mocks.atomicResponses[0]?.content).not.toContain("신랑이 이기적");
    expect(body).not.toContain("신랑이 이기적");
  });

  it("applies the same neutrality fallback when a mediation response omits its marker", async () => {
    const biasedProviderText =
      "사용자가 이기적이에요. 민수님이 먼저 사과하는 게 좋겠어요.";
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(biasedProviderText);
      return providerResult({
        fullText: biasedProviderText,
        usage: { input_tokens: 10, output_tokens: 12 },
      });
    });

    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: "예산 상한에 대한 생각이 다른 것 같아요.",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.content).toContain("잘잘못이나 속마음을 단정하지 않고");
    expect(mocks.atomicResponses[0]?.content).not.toContain("사용자가 이기적");
    expect(mocks.atomicResponses[0]?.content).not.toContain("민수님이 먼저 사과");
    expect(body).toContain("잘잘못이나 속마음을 단정하지 않고");
    expect(body).not.toContain("사용자가 이기적");
    expect(body).not.toContain("민수님이 먼저 사과");
  });

  it("demotes a W2 mediation request to ordinary no-memory guidance", async () => {
    const providerText = [
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 계약금 환불 판단을 원한다고 전했어요.",
      "데이터: 법적 권리와 의무는 자격 있는 전문가에게 확인해야 해요.",
      "합의안: 두 분이 계약서를 다시 확인해 보세요.",
      "[/mediation]",
    ].join("\n");
    mocks.extractSuggestions.mockReturnValueOnce({
      cleanText: providerText,
      suggestions: ["신랑의 법적 판단을 따르기"],
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: providerText,
      usage: { input_tokens: 10, output_tokens: 20 },
    }));

    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: "예식장 계약금 환불이 가능한지 법적으로 판단해줘",
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools).toEqual([]);
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W2_high_risk_adjacent",
    );
    expect(providerArgs?.systemPrompt).not.toContain(
      "구조화 중재 최종 안전 계약",
    );
    expect(mocks.chooseModelRole).toHaveBeenCalled();
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRole: "fast",
        specialistType: "general",
        stageTag: null,
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(body).not.toContain("[mediation]");
    expect(body).not.toContain("공감:");
    expect(body).not.toContain("통역:");
    expect(body).not.toContain("데이터:");
    expect(body).not.toContain("합의안:");
    expect(body).not.toContain('"type":"suggestions"');
    expect(body).not.toContain("신랑의 법적 판단을 따르기");
    expect(body).toContain("자격 있는 전문가나 공식 기관");
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W2_high_risk_adjacent",
      memory_eligible: false,
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("suggestions");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_wedding_context_revision",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_grounding",
    );
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("uses only the requester's explicit summary as mediation conversation evidence", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "요청자가 전한 내용을 바탕으로 정리했어요.",
        "[mediation]",
        "공감: 요청자가 답답함을 느꼈다고 전했어요.",
        "통역: 요청자가 예산 기준을 먼저 정하고 싶다고 전했어요.",
        "데이터: 상대방이 생각하는 예산 상한은 아직 확인되지 않았어요.",
        "합의안: 두 사람이 각자 가능한 상한을 적어 비교해 보세요.",
        "[/mediation]",
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 20 },
    }));

    const requesterSummary = "REQUESTER_SUMMARY_ONLY 예산 상한을 조율하고 싶어요.";
    const response = await POST(request({
      requestKind: "mediation",
      conflictContext: requesterSummary,
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain(requesterSummary);
    expect(providerInput).not.toContain("CANONICAL_DB_USER");
  });

  it("lets a signed demo session reach OpenAI without a Supabase user or durable writes", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "체험 상담 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
      weddingContext: {
        weddingDate: "2026-10-15",
        budget: 25_000_000,
        venue: null,
        progress: {},
      },
    }));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("체험 상담 응답");
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      "[체험 상담 저장 경계]",
    );
    expect(mocks.provider.mock.calls[0]?.[0]?.safetyIdentifierScope)
      .toMatch(/^demo:[a-f0-9]{64}$/);
    expect(mocks.provider.mock.calls[0]?.[0]?.safetyIdentifierScope)
      .not.toContain(mocks.demoSessionToken);
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      isDemo: true,
      coupleId: "demo-couple",
    }));
    expect(mocks.completeClaim).not.toHaveBeenCalled();
    expect(mocks.adminFrom).not.toHaveBeenCalledWith("profiles");
    expect(mocks.log).not.toHaveBeenCalled();
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, coupleId: null }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("bounds oversized tool feedback before it is sent into the next provider call", async () => {
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "get_wedding_info",
      toolInput: {},
      toolOutput: { rows: "x".repeat(40_000), ending: "fine-print" },
      success: true,
      displayMessage: "updated",
    });
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_large",
          name: "get_wedding_info",
          input: {},
        }],
        outputItems: [{ id: "fc_large", type: "function_call" }],
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "현재 정보를 확인했어요." }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const [, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(output.length).toBeLessThanOrEqual(4_000);
    expect(JSON.parse(output)).toMatchObject({ truncated: true });
    expect(output).toContain("fine-print");
  });

  it("never executes more than eight model-requested tools in one user turn", async () => {
    const toolCalls = Array.from({ length: 10 }, (_, index) => ({
      callId: `call_limit_${index}`,
      name: "get_wedding_info",
      input: { index },
    }));
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls,
        outputItems: toolCalls.map((call) => ({
          id: `fc_${call.callId}`,
          type: "function_call",
        })),
      }))
      .mockResolvedValueOnce(providerResult({ fullText: "실행한 범위만 정리했어요." }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).toHaveBeenCalledTimes(8);
    expect(mocks.buildToolResult).toHaveBeenCalledTimes(10);
    const overflowOutputs = mocks.buildToolResult.mock.calls
      .slice(8)
      .map(([, output]) => JSON.parse(String(output)));
    expect(overflowOutputs).toEqual([
      expect.objectContaining({ error_code: "TOOL_CALL_LIMIT_REACHED" }),
      expect.objectContaining({ error_code: "TOOL_CALL_LIMIT_REACHED" }),
    ]);
  });

  it("narrows beta-safe tools to the current durable request domain", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    // 변경 함수 제거 후: 직접 호출은 읽기 도구만, 변경은 제안 계약으로만.
    expect(toolNames).toEqual(["get_wedding_info"]);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).not.toContain("add_schedule_event");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .toContain("[서버 발급 후속 확인 계약]");
  });

  it.each([
    {
      userText: "주식 투자 예산을 3천만원으로 바꿔줘",
      expectedScope: "W4_out_of_scope",
    },
    {
      userText: "예식장 계약이 법적으로 무효인지 판정해줘",
      expectedScope: "W2_high_risk_adjacent",
    },
    {
      userText: "그냥 오늘 너무 힘들어",
      expectedScope: "W3_social_care",
    },
  ])("enforces $expectedScope as the final no-tool and no-memory ceiling", async ({
    userText,
    expectedScope,
  }) => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 요청에 맞는 안전한 범위에서 답할게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools).toEqual([]);
    expect(providerArgs?.systemPrompt).toContain(
      `question_scope: ${expectedScope}`,
    );
    expect(providerArgs?.systemPrompt).not.toContain(
      "[서버 발급 후속 확인 계약]",
    );
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ question_scope: expectedScope }),
    }));
  });

  it("binds adaptive decision depth to the current canonical wedding question", async () => {
    const userText = "상견례를 처음 준비하는데 놓치는 것까지 전부 알려줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 상황에 필요한 준비만 골라서 볼게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const systemPrompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(systemPrompt).toContain("[서버 확정 결혼 결정 깊이 계약]");
    expect(systemPrompt).toContain("decision_depth: comprehensive");
    expect(systemPrompt).toContain("decision_topic: family_meeting");
  });

  it.each([
    {
      userText: "임신 중인데 결혼식 전에 이 약을 먹어도 돼?",
      expectedScope: "W2_high_risk_adjacent",
    },
    {
      userText: "안녕, 오늘 어때?",
      expectedScope: "W3_social_care",
    },
    {
      userText: "삼성전자 주식 사도 돼?",
      expectedScope: "W4_out_of_scope",
    },
  ])("sends only the current turn in the minimized $expectedScope provider envelope", async ({
    userText,
    expectedScope,
  }) => {
    setSensitiveStoredProviderContext(userText);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청만 보고 답할게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    const envelope = JSON.stringify({
      systemPrompt: providerArgs?.systemPrompt,
      input: providerArgs?.input,
    });
    expect(envelope).toContain(userText);
    expect(providerArgs?.systemPrompt).toContain(`question_scope: ${expectedScope}`);
    for (const sentinel of [
      "PRIVATE_VENUE_SENTINEL",
      "PRIVATE_BRIDE_SENTINEL",
      "PRIVATE_GROOM_SENTINEL",
      "PRIVATE_PROGRESS_SENTINEL",
      "PRIVATE_SCHEDULE_SENTINEL",
      "PRIVATE_PREFERENCE_SENTINEL",
      "PRIVATE_SUMMARY_SENTINEL",
      "PRIVATE_DECISION_SENTINEL",
      "PRIVATE_CONFLICT_SENTINEL",
      "PRIVATE_PROFILE_SENTINEL",
      "PRIVATE_ASSISTANT_HISTORY_SENTINEL",
      "PRIVATE_USER_HISTORY_SENTINEL",
      "44444444",
    ]) {
      expect(envelope).not.toContain(sentinel);
    }
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        specialistType: "general",
        stageTag: null,
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.atomicFinalizations[0]).toMatchObject({
      outcome: "persisted",
      message: {
        stageTag: null,
        specialistType: "general",
      },
    });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      specialistType: "general",
      metadata: expect.objectContaining({ stage_tag: null }),
    }));
  });

  it("answers an explanation follow-up from one exact linked wedding exchange without tools or memory", async () => {
    const currentText = "왜?";
    const priorText = "웨딩 스튜디오 두 곳을 비교해줘";
    const assistantText = "첫 번째는 자연광, 두 번째는 야간 연출이 강해요.";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: assistantText,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "자연광이 두 분의 편안한 분위기 선호와 더 잘 맞기 때문이에요.",
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W4_out_of_scope",
    );
    expect(providerArgs?.systemPrompt).toContain(
      "context_mode: linked_context_only",
    );
    expect(providerArgs?.systemPrompt).toContain("capabilities: none");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: priorText },
      { role: "assistant", content: assistantText },
      { role: "user", content: currentText },
    ]);
    expect(providerArgs?.tools).toEqual([]);
    expect(providerArgs?.systemPrompt).not.toContain("[서버 발급 후속 확인 계약]");
    expect(JSON.stringify(providerArgs)).not.toContain("PRIVATE_");
    expect(mocks.chatHistoryLimit).toHaveBeenCalledWith(3);
    expect(mocks.chatHistoryEq).toHaveBeenCalledWith("segment_id", segmentId);
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W4_out_of_scope",
      memory_eligible: false,
      memory_enqueue_requested: false,
      context_mode: "linked_context_only",
    });
    expect(new Set(
      mocks.requestFrom.mock.calls.map(([table]) => table),
    )).toEqual(new Set(["conversation_segments", "chat_messages"]));
  });

  it("keeps an exact linked follow-up inside the requester's private visibility", async () => {
    const currentText = "왜?";
    const priorText = "드레스 예산 안에서 두 선택지를 비교해줘";
    const assistantText = "첫 번째는 예산 여유가 크고, 두 번째는 원하는 소재에 더 가까워요.";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000002";
    mocks.activeSegment = { id: segmentId, status: "active" };
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "bride_private",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: assistantText,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "bride_private",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "bride_private",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 초과 위험을 줄이는 쪽을 먼저 권했기 때문이에요.",
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("context_mode: linked_context_only");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: priorText },
      { role: "assistant", content: assistantText },
      { role: "user", content: currentText },
    ]);
    expect(providerArgs?.tools).toEqual([]);
    expect(mocks.chatHistoryEq).toHaveBeenCalledWith(
      "visibility",
      "bride_private",
    );
    expect(mocks.chatHistoryEq).not.toHaveBeenCalledWith(
      "visibility",
      "shared",
    );
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses[0]).toMatchObject({
      metadata: {
        context_mode: "linked_context_only",
        memory_eligible: false,
      },
    });
    expect(mocks.atomicFinalizations[0]).toMatchObject({
      message: { visibility: "bride_private" },
    });
  });

  it("continues a selection follow-up from one linked W1 exchange without widening capabilities", async () => {
    const currentText = "첫 번째가 좋아";
    const priorText = "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어";
    const assistantText = "첫 번째는 공동 생활비만 합치고, 두 번째는 전액을 합치는 방식이에요.";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: assistantText,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W1_wedding_adjacent",
          memory_eligible: true,
        },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공동 생활비만 합치는 방식이 더 편하신 거군요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("question_scope: W4_out_of_scope");
    expect(providerArgs?.systemPrompt).toContain("context_mode: linked_context_only");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: priorText },
      { role: "assistant", content: assistantText },
      { role: "user", content: currentText },
    ]);
    expect(providerArgs?.tools).toEqual([]);
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it.each([
    ["W2_high_risk_adjacent", "그거 법적으로 판단해줘"],
    ["W4_out_of_scope", "그걸로 삼성전자 주식 사줘"],
  ])("never launders current %s authority through an exact prior wedding exchange", async (
    expectedScope,
    currentText,
  ) => {
    const priorText = "웨딩 스튜디오 두 곳을 비교해줘";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "PRIOR_ASSISTANT_MUST_NOT_CROSS_SCOPE",
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청의 안전한 범위에서만 답할게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(`question_scope: ${expectedScope}`);
    expect(providerArgs?.systemPrompt).not.toContain("context_mode: linked_context_only");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    expect(JSON.stringify(providerArgs)).not.toContain("PRIOR_ASSISTANT_MUST_NOT_CROSS_SCOPE");
    expect(providerArgs?.tools).toEqual([]);
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("conversation_segments");
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous explanation current-only when the assistant reply link is missing", async () => {
    const currentText = "왜?";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    const unlinkedAssistant = "UNLINKED_ASSISTANT_MUST_NOT_REPLAY";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: unlinkedAssistant,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000010",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "웨딩 스튜디오 두 곳을 비교해줘",
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "어떤 부분의 이유인지 한 번만 더 알려주세요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("question_scope: W4_out_of_scope");
    expect(providerArgs?.systemPrompt).not.toContain("context_mode: linked_context_only");
    expect(providerArgs?.input).toEqual([{ role: "user", content: currentText }]);
    expect(JSON.stringify(providerArgs)).not.toContain(unlinkedAssistant);
    expect(providerArgs?.tools).toEqual([]);
  });

  it("carries only one exact linked exchange for an explicit W3 follow-up", async () => {
    const currentText = "그게 너무 속상해";
    const priorText = "예식장 계약 때문에 파트너와 의견이 달라요";
    const assistantText = "예식장 계약 조건을 하나씩 다시 확인해볼 수 있어요.";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: assistantText,
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "계약 이야기 뒤라서 더 마음이 무거웠겠어요.",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"done"');
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: priorText },
      { role: "assistant", content: assistantText },
      { role: "user", content: currentText },
    ]);
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual([]);
    expect(mocks.chatHistoryLimit).toHaveBeenCalledWith(3);
    expect(mocks.chatHistorySelect).toHaveBeenCalledWith(
      expect.stringContaining("segment_id"),
    );
    expect(mocks.chatHistoryEq).toHaveBeenCalledWith("segment_id", segmentId);
    expect(new Set(mocks.requestFrom.mock.calls.map(([table]) => table)))
      .toEqual(new Set(["chat_messages", "conversation_segments"]));
    expect(mocks.segmentEq).toHaveBeenCalledWith("couple_id", COUPLE_ID);
    expect(mocks.segmentEq).toHaveBeenCalledWith("visibility", "shared");
    expect(mocks.segmentEq).toHaveBeenCalledWith("status", "active");
    expect(mocks.requestFrom.mock.calls.filter(
      ([table]) => table === "conversation_segments",
    )).toHaveLength(1);
    expect(mocks.getPrivacyEpoch).toHaveBeenCalled();
    expect(mocks.getPrivacySnapshot).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({ expectedPrivacyEpoch: 7 }),
    ]);
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("keeps a topic-breaking W3 turn current-only after a wedding exchange", async () => {
    const currentText = "그거랑 상관없이 오늘 너무 힘들어";
    const priorText = "PRIVATE_PRIOR_WEDDING_CONTEXT 예식장 후보를 비교해줘";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "PRIVATE_PRIOR_ASSISTANT_CONTEXT 두 후보의 조건을 비교했어요.",
        metadata: { in_reply_to_user_message_id: priorId },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: priorText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "오늘 힘든 마음부터 짧게 같이 살펴볼게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("question_scope: W3_social_care");
    expect(providerArgs?.systemPrompt).not.toContain("context_mode: linked_context_only");
    expect(providerArgs?.input).toEqual([{ role: "user", content: currentText }]);
    expect(JSON.stringify(providerArgs)).not.toContain("PRIVATE_PRIOR_");
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("conversation_segments");
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("does not replay a fully linked W3 exchange from a closed segment", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const currentText = "그게 너무 속상해";
    const closedSegmentId = "60000000-0000-4000-8000-000000000098";
    const activeSegmentId = "60000000-0000-4000-8000-000000000001";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const closedUserText =
      "예식장 계약 CLOSED_SEGMENT_USER_TEXT_MUST_NOT_REPLAY 때문에 의견이 달라요";
    const closedAssistantText = "CLOSED_SEGMENT_ASSISTANT_MUST_NOT_REPLAY";
    mocks.activeSegment = { id: activeSegmentId, status: "active" };
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: {
          client_request_id: "00000000-0000-4000-8000-000000000098",
        },
        visibility: "shared",
        segment_id: closedSegmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: closedAssistantText,
        metadata: { in_reply_to_user_message_id: priorId },
        visibility: "shared",
        segment_id: closedSegmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: closedUserText,
        metadata: null,
        visibility: "shared",
        segment_id: closedSegmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 말씀만 놓고 곁에 있을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
      clientRequestId: "00000000-0000-4000-8000-000000000098",
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    const providerEnvelope = JSON.stringify(mocks.provider.mock.calls[0]?.[0]);
    expect(providerEnvelope).not.toContain(closedUserText);
    expect(providerEnvelope).not.toContain(closedAssistantText);
    expect(mocks.requestFrom).toHaveBeenCalledWith("conversation_segments");
    expect(mocks.segmentEq).toHaveBeenCalledWith("status", "active");
    expect(mocks.chatHistoryLimit).not.toHaveBeenCalledWith(3);
    expect(new Set(mocks.requestFrom.mock.calls.map(([table]) => table)))
      .toEqual(new Set(["chat_messages", "conversation_segments"]));
    warningSpy.mockRestore();
  });

  it("falls back to current-only W3 when the active segment lookup is unavailable", async () => {
    const warningSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const currentText = "그게 너무 속상해";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const unavailableText =
      "예식장 계약 UNAVAILABLE_ACTIVE_SEGMENT_TEXT_MUST_NOT_REPLAY 때문에 의견이 달라요";
    mocks.activeSegment = null;
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "UNAVAILABLE_ACTIVE_SEGMENT_ASSISTANT_MUST_NOT_REPLAY",
        metadata: { in_reply_to_user_message_id: priorId },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: unavailableText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 말씀만 놓고 곁에 있을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]))
      .not.toContain(unavailableText);
    expect(mocks.requestFrom).toHaveBeenCalledWith("conversation_segments");
    expect(mocks.chatHistoryLimit).not.toHaveBeenCalledWith(3);
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(new Set(mocks.requestFrom.mock.calls.map(([table]) => table)))
      .toEqual(new Set(["chat_messages", "conversation_segments"]));
    warningSpy.mockRestore();
  });

  it("does not read the active segment for W3 without an explicit continuity reference", async () => {
    const currentText = "그냥 오늘 너무 힘들어";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: currentText,
      metadata: null,
      visibility: "shared",
      segment_id: "60000000-0000-4000-8000-000000000001",
      created_at: "2026-07-15T00:00:00.000Z",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 말씀만 놓고 곁에 있을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("conversation_segments");
    expect(new Set(mocks.requestFrom.mock.calls.map(([table]) => table)))
      .toEqual(new Set(["chat_messages"]));
  });

  it("keeps W3 current-only when an otherwise linked row belongs to an older segment", async () => {
    const currentText = "그게 너무 속상해";
    const currentSegmentId = "60000000-0000-4000-8000-000000000001";
    const oldSegmentId = "60000000-0000-4000-8000-000000000099";
    const priorId = "30000000-0000-4000-8000-000000000010";
    const oldText = "OLD_SEGMENT_WEDDING_TEXT_MUST_NOT_CROSS";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: currentSegmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "OLD_SEGMENT_ASSISTANT_MUST_NOT_CROSS",
        metadata: { in_reply_to_user_message_id: priorId },
        visibility: "shared",
        segment_id: oldSegmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: oldText,
        metadata: null,
        visibility: "shared",
        segment_id: oldSegmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 말씀만 놓고 곁에 있을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]))
      .not.toContain(oldText);
    expect(mocks.chatHistoryEq).toHaveBeenCalledWith(
      "segment_id",
      currentSegmentId,
    );
  });

  it("falls back to current-only W3 when the assistant reply binding is absent", async () => {
    const currentText = "그게 너무 속상해";
    const segmentId = "60000000-0000-4000-8000-000000000001";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "이 문장은 연결 근거가 없어 전달되면 안 돼요.",
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000010",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "예식장 계약 때문에 파트너와 의견이 달라요",
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "지금 말씀만 놓고 곁에 있을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.input).toEqual([
      { role: "user", content: currentText },
    ]);
  });

  it("keeps mediation requester-summary-only across the entire provider envelope", async () => {
    const requesterSummary = "예산을 어디에서 줄일지 의견이 달라요";
    setSensitiveStoredProviderContext("PRIVATE_CANONICAL_CURRENT_SENTINEL");
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: [
        "두 분이 확인할 기준부터 정리할게요.",
        "[mediation]",
        "공감: 의견을 맞추는 과정이 쉽지 않으셨겠어요.",
        "통역: 요청자가 전한 예산 쟁점만 정리했어요.",
        "데이터: 상대방에게 줄이기 어려운 항목을 확인해주세요.",
        "합의안: 각자 지킬 항목 하나씩을 먼저 정해보세요.",
        "[/mediation]",
      ].join("\n"),
      usage: { input_tokens: 10, output_tokens: 20 },
    }));

    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: requesterSummary,
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    const envelope = JSON.stringify({
      systemPrompt: providerArgs?.systemPrompt,
      input: providerArgs?.input,
    });
    expect(envelope).toContain(requesterSummary);
    for (const sentinel of [
      "PRIVATE_CANONICAL_CURRENT_SENTINEL",
      "PRIVATE_VENUE_SENTINEL",
      "PRIVATE_BRIDE_SENTINEL",
      "PRIVATE_GROOM_SENTINEL",
      "PRIVATE_SCHEDULE_SENTINEL",
      "PRIVATE_PREFERENCE_SENTINEL",
      "PRIVATE_SUMMARY_SENTINEL",
      "PRIVATE_DECISION_SENTINEL",
      "PRIVATE_CONFLICT_SENTINEL",
      "PRIVATE_PROFILE_SENTINEL",
      "PRIVATE_ASSISTANT_HISTORY_SENTINEL",
      "PRIVATE_USER_HISTORY_SENTINEL",
      "44444444",
    ]) {
      expect(envelope).not.toContain(sentinel);
    }
  });

  it("does not add a terminal privacy read for a current-only W4 turn", async () => {
    const userText = "삼성전자 주식 사도 돼?";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.getPrivacyEpoch.mockReset();
    mocks.getPrivacyEpoch.mockResolvedValue(7);
    // 실제 SDK 계약을 모사하는 fake를 쓴다. 그래야 egress gate 읽기까지 세어진다.
    providerAfterPreGeneration(providerResult({
      fullText: "결혼 준비 밖의 투자 추천은 하지 않을게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    // Replay preflight, initial current-only epoch, the pre-egress fence that
    // guards token counting, the pre-generation fence, and the post-provider
    // fence. There is deliberately no further terminal-release read.
    expect(mocks.getPrivacyEpoch).toHaveBeenCalledTimes(5);
  });

  it("keeps the minimized private-mode guard without disclosing the stored actor role", async () => {
    const userText = "삼성전자 주식 사도 돼?";
    setSensitiveStoredProviderContext(userText);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "결혼 준비 밖의 투자 추천은 하지 않을게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{
        role: "user",
        content: `${SCHEDULE_CARE_CANONICAL_PROMPT} ${userText}`,
      }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const systemPrompt = String(mocks.provider.mock.calls[0]?.[0]?.systemPrompt);
    expect(systemPrompt).toContain("사용자의 개인 비공개 대화");
    expect(systemPrompt).not.toContain("신부 분이");
    expect(systemPrompt).not.toContain("PRIVATE_BRIDE_SENTINEL");
    expect(systemPrompt).not.toContain("PRIVATE_GROOM_SENTINEL");
  });

  it.each([
    {
      label: "W2",
      currentUserText: "임신 중인데 결혼식 전에 이 약을 먹어도 돼?",
      overrides: {},
    },
    {
      label: "W3",
      currentUserText: "안녕, 오늘 어때?",
      overrides: {},
    },
    {
      label: "high-confidence W4",
      currentUserText: "삼성전자 주식 사도 돼?",
      overrides: {},
    },
    {
      label: "low-confidence W4 without a bounded reference",
      currentUserText: "이거 어떻게 하면 돼?",
      overrides: {},
    },
    {
      label: "initial greeting",
      currentUserText: null,
      overrides: {
        requestKind: "initial_greeting",
        userMessageId: undefined,
      },
    },
    {
      label: "mediation",
      currentUserText: null,
      overrides: {
        requestKind: "mediation",
        userMessageId: undefined,
        conflictContext: "예산을 어디에서 줄일지 의견이 달라요",
      },
    },
  ])("skips irrelevant stored-context reads for $label", async ({
    currentUserText,
    overrides,
  }) => {
    if (currentUserText) {
      mocks.canonicalRows[0] = {
        ...mocks.canonicalRows[0],
        content: currentUserText,
      };
    }
    mocks.getPrivacySnapshot.mockRejectedValue(
      new Error("PRIVATE_SNAPSHOT_SENTINEL"),
    );
    mocks.journeyError = { code: "PGRST500", message: "JOURNEY_SENTINEL" };
    mocks.directoryError = { code: "PGRST500", message: "DIRECTORY_SENTINEL" };
    mocks.summariesError = { code: "PGRST500", message: "SUMMARY_SENTINEL" };
    mocks.decisionsError = { code: "PGRST500", message: "DECISION_SENTINEL" };
    mocks.profileProjectionError = { code: "PGRST500" };
    mocks.personalizationError = { code: "PGRST500" };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "현재 요청만으로 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      ...overrides,
      ...(currentUserText
        ? { messages: [{ role: "user", content: currentUserText }] }
        : {}),
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.getPrivacySnapshot).not.toHaveBeenCalled();
    for (const table of [
      "wedding_journeys",
      "couple_profile_directory",
      "chat_summaries",
      "decision_nodes",
      "amora_personalization_preferences",
      "conversation_segments",
    ]) {
      expect(mocks.requestFrom).not.toHaveBeenCalledWith(table);
    }
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("keeps the privacy/context fail-closed path for W0", async () => {
    const userText = "우리 결혼 총 예산을 4천만원으로 변경해줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.getPrivacySnapshot.mockRejectedValue(new Error("snapshot unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps a confirmed action on the full fail-closed context path even with a mixed W2 question", async () => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    const userText = "응, 예산 적용해줘. 그리고 임신 중인데 이 약 먹어도 돼?";
    setCanonicalConfirmedBudgetAction(actionId, userText);
    mocks.getPrivacySnapshot.mockRejectedValue(new Error("snapshot unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps wedding-adjacent discussion read-only while retaining bounded wedding context", async () => {
    const userText = "신혼집 이사 비용 때문에 부부 재정을 어떻게 나눌지 대화하고 싶어";
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "두 분이 먼저 맞출 기준부터 정리해볼게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools.map((tool: { name: string }) => tool.name))
      .toEqual(["get_wedding_info"]);
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W1_wedding_adjacent",
    );
    expect(providerArgs?.systemPrompt).not.toContain(
      "[서버 발급 후속 확인 계약]",
    );
    expect(mocks.enqueueMemory).toHaveBeenCalledTimes(1);
  });

  it("rejects a provider tool call that exceeds the server question-scope ceiling", async () => {
    const userText = "주식 투자 예산을 3천만원으로 바꿔줘";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_scope_escape",
          name: "get_wedding_info",
          input: {},
        }],
        outputItems: [{
          id: "fc_scope_escape",
          type: "function_call",
          call_id: "call_scope_escape",
          name: "get_wedding_info",
          arguments: "{}",
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "아모라는 결혼 준비 범위에서 도울게요.",
      }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).not.toHaveBeenCalled();
    const [, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(JSON.parse(output)).toMatchObject({
      success: false,
      error_code: "QUESTION_SCOPE_TOOL_BLOCKED",
    });
    expect(mocks.provider.mock.calls[1]?.[0]?.tools).toEqual([]);
  });

  it("never executes a provider-requested mutation even inside W0", async () => {
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_model_mutation",
          name: "update_budget",
          input: { total_budget: 30_000_000 },
        }],
        outputItems: [{
          id: "fc_model_mutation",
          type: "function_call",
          call_id: "call_model_mutation",
          name: "update_budget",
          arguments: JSON.stringify({ total_budget: 30_000_000 }),
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "변경은 확인 절차를 거쳐야 해요.",
      }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).not.toHaveBeenCalled();
    const [, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(JSON.parse(output)).toMatchObject({
      success: false,
      error_code: "MODEL_MUTATION_TOOL_BLOCKED",
    });
  });

  it("rejects a read tool that was not offered by the current intent policy", async () => {
    mocks.provider
      .mockResolvedValueOnce(providerResult({
        toolCalls: [{
          callId: "call_unoffered_read",
          name: "analyze_quote",
          input: {},
        }],
        outputItems: [{
          id: "fc_unoffered_read",
          type: "function_call",
          call_id: "call_unoffered_read",
          name: "analyze_quote",
          arguments: "{}",
          status: "completed",
        }],
      }))
      .mockResolvedValueOnce(providerResult({
        fullText: "현재 요청 범위 안에서 답할게요.",
      }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).not.toHaveBeenCalled();
    const [, output] = mocks.buildToolResult.mock.calls[0] as [string, string];
    expect(JSON.parse(output)).toMatchObject({
      success: false,
      error_code: "TOOL_NOT_AVAILABLE_FOR_TURN",
    });
  });

  it("replaces and audits an affirmative persistence claim that has no server receipt", async () => {
    const providerText =
      "예산 우선순위를 먼저 정해보는 게 좋아요. 총예산을 3,000만 원으로 반영했어요.";
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(providerText);
      return providerResult({
        fullText: providerText,
        usage: { input_tokens: 10, output_tokens: 8 },
      });
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(body).toContain('"type":"text_clear"');
    expect(body).not.toContain("3,000만 원으로 반영했어요");
    expect(body).toContain("실제 실행 결과가 확인되지 않아");
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({
        content: expect.stringContaining("아직 반영되지 않았어요"),
        metadata: expect.objectContaining({
          persistence_claim_corrected: true,
          persistence_claim_removed_count: 1,
        }),
      }),
    ]);
  });

  it("never flashes an unsupported completion claim on an ordinary streamed chat", async () => {
    const providerText =
      "차근차근 같이 볼게요. 드레스 투어 일정을 저장했어요.";
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.("차근차근 같이 볼게요. ");
      options.onTextDelta?.("드레스 투어 일정을 저장했어요.");
      return providerResult({
        fullText: providerText,
        usage: { input_tokens: 10, output_tokens: 8 },
      });
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "안녕, 처음 왔어" }],
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain("차근차근 같이 볼게요.");
    expect(body).not.toContain("드레스 투어 일정을 저장했어요");
    expect(body).toContain("실제 실행 결과가 확인되지 않아");
    expect(body).toContain('"type":"text_clear"');
  });

  it("does not treat canonical assistant prose plus a generic approval as write authority", async () => {
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응, 그렇게 해줘",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총 예산을 4천만원으로 변경해드릴까요?",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "말씀하신 예산으로 변경할게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응, 그렇게 해줘" }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).not.toContain("add_schedule_event");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("keeps one exact prior wedding request as context only for a narrow confirmation", async () => {
    const now = Date.now();
    const segmentId = "60000000-0000-4000-8000-000000000001";
    const priorId = "30000000-0000-4000-8000-000000000008";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응, 해줘",
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "요청 내용을 확인해볼게요.",
        metadata: {
          in_reply_to_user_message_id: priorId,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          pending_amora_action: {
            version: 2,
            actionId: "11111111-1111-4111-8111-111111111111",
            tool: "update_budget",
            input: { total_budget: 40_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation: "총 예산을 4천만원으로 변경할까요?",
            issuedAt: now - 1_000,
            expiresAt: now + 60_000,
          },
        },
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: priorId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "우리 결혼 총 예산을 4천만원으로 바꿔줘",
        metadata: null,
        visibility: "shared",
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "아직 변경하지 않았어요.\n[pending_action]{\"tool\":\"update_budget\",\"input\":{\"total_budget\":40000000}}[/pending_action]",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응, 해줘" }],
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W4_out_of_scope",
    );
    expect(providerArgs?.systemPrompt).toContain(
      "context_mode: linked_context_only",
    );
    expect(providerArgs?.systemPrompt).not.toContain(
      "[서버 발급 후속 확인 계약]",
    );
    expect(providerArgs?.input).toEqual([
      { role: "user", content: "우리 결혼 총 예산을 4천만원으로 바꿔줘" },
      { role: "assistant", content: "요청 내용을 확인해볼게요." },
      { role: "user", content: "응, 해줘" },
    ]);
    expect(providerArgs?.tools).toEqual([]);
    expect(body).not.toContain("[pending_action]");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "pending_amora_action",
    );
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("does not inherit a partner's shared wedding request for a short reply", async () => {
    const currentText = "응";
    const partnerWeddingRequest = "우리 결혼 총 예산을 4천만원으로 바꿔줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000002",
        sender_id: "00000000-0000-4000-8000-000000000002",
        sender_type: "groom",
        role: "user",
        content: partnerWeddingRequest,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "무엇을 확인하신 건지 한 번만 더 알려주세요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W4_out_of_scope",
    );
    expect(providerArgs?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    expect(providerArgs?.tools).toEqual([]);
    expect(JSON.stringify(providerArgs)).not.toContain(partnerWeddingRequest);
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("does not treat a generic reply as authority even when the previous message has a pending action", async () => {
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "다음 변경을 적용할까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId: "11111111-1111-4111-8111-111111111111",
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "어떤 변경을 말씀하시는지 다시 알려주세요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("executes only the exact server-issued action after the immediate shared confirmation", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "총예산을 3,000만 원으로 반영했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({
        currentUserText: "응",
        pendingActionId: actionId,
      }),
    );
    expect(mocks.reserve.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.executeTool.mock.invocationCallOrder[0]!);
    expect(mocks.executeTool.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.provider.mock.invocationCallOrder[0]!);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "update_budget" }),
    ]));
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W0_wedding_core",
    );
    expect(providerArgs?.systemPrompt).toContain(actionId);
    expect(JSON.stringify(providerArgs?.input)).toContain("SERVER_CONFIRMED_ACTION_RESULT");
    expect(JSON.stringify(providerArgs?.input)).toContain("update_budget");
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "authorize_amora_shared_action_execution",
      {
        p_action_id: actionId,
        p_confirmation_message_id: "30000000-0000-4000-8000-000000000001",
        p_couple_id: COUPLE_ID,
        p_source_message_id: "20000000-0000-4000-8000-000000000009",
        p_user_id: "00000000-0000-4000-8000-000000000001",
      },
    );
  });

  it.each([
    {
      userText: "응, 예산 적용해줘. 그리고 임신 중인데 이 약 먹어도 돼?",
      expectedScope: "W2_high_risk_adjacent",
    },
    {
      userText: "응, 예산 적용해줘. 그리고 삼성전자 주식 사도 돼?",
      expectedScope: "W4_out_of_scope",
    },
  ])("executes only the approved action while $expectedScope still governs the mixed current question", async ({
    userText,
    expectedScope,
  }) => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    setCanonicalConfirmedBudgetAction(actionId, userText);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "승인된 예산 변경 결과와 별개로 안전한 범위에서 안내할게요.",
      usage: { input_tokens: 10, output_tokens: 4 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
      confirmedActionId: actionId,
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({
        currentUserText: userText,
        pendingActionId: actionId,
      }),
    );
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.tools).toEqual([]);
    expect(providerArgs?.systemPrompt).toContain(
      `question_scope: ${expectedScope}`,
    );
    expect(JSON.stringify(providerArgs?.input))
      .toContain("SERVER_CONFIRMED_ACTION_RESULT");
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ question_scope: expectedScope }),
    }));
  });

  it("never exposes provider prose for a confirmed mutation receipt", async () => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    const providerFalseSuccess = "완료됐어요. 예산과 일정까지 모두 저장했어요.";
    const serverDisplayMessage = "총예산을 3,000만 원으로 변경했어요.";
    setCanonicalConfirmedBudgetAction(actionId);
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { committed: true },
      success: true,
      displayMessage: serverDisplayMessage,
    });
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(providerFalseSuccess);
      return providerResult({
        fullText: providerFalseSuccess,
        usage: { input_tokens: 10, output_tokens: 6 },
      });
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain(providerFalseSuccess);
    expect(body).toContain(serverDisplayMessage);
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({ content: serverDisplayMessage }),
    ]);
    const confirmedResultInput = String((
      mocks.provider.mock.calls[0]?.[0]?.input as Array<{ content?: unknown }>
    ).find((item) => String(item.content).includes(
      "SERVER_CONFIRMED_ACTION_RESULT",
    ))?.content);
    expect(confirmedResultInput).toContain('"success":true');
    expect(confirmedResultInput).toContain(serverDisplayMessage);
  });

  it("uses a failed mutation receipt instead of a provider success claim", async () => {
    const actionId = "11111111-1111-4111-8111-111111111111";
    const providerFalseSuccess = "예산 변경 완료했어요.";
    const serverFailureMessage = "예산은 변경되지 않았어요. 입력값을 다시 확인해주세요.";
    setCanonicalConfirmedBudgetAction(actionId);
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "update_budget",
      toolInput: { total_budget: 30_000_000 },
      toolOutput: { error: "invalid_budget" },
      success: false,
      displayMessage: serverFailureMessage,
    });
    mocks.provider.mockImplementationOnce(async (options: {
      onTextDelta?: (value: string) => void;
    }) => {
      options.onTextDelta?.(providerFalseSuccess);
      return providerResult({ fullText: providerFalseSuccess });
    });

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    const body = await response.text();

    expect(body).not.toContain(providerFalseSuccess);
    expect(body).toContain(serverFailureMessage);
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({ content: serverFailureMessage }),
    ]);
  });

  it("rechecks privacy before reserving or executing a confirmed side effect", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const withdrawn = privacySnapshot({
      memory: {
        shared: {
          enabled: false,
          resetAt: "2026-07-31T00:01:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(initial, withdrawn);

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));
    const body = await response.text();

    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("binds every replay of one confirmation to one durable request key", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "적용을 계속해 주세요.",
        metadata: {
          client_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          confirmed_amora_action_id: actionId,
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValue(providerResult({
      fullText: "총예산을 반영했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const first = await POST(request({
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      messages: [{ role: "user", content: "적용을 계속해 주세요." }],
      confirmedActionId: actionId,
    }));
    expect(first.status).toBe(200);
    await first.text();
    const second = await POST(request({
      clientRequestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      messages: [{ role: "user", content: "적용을 계속해 주세요." }],
      confirmedActionId: actionId,
    }));
    expect(second.status).toBe(200);
    await second.text();

    const firstRequestKey = mocks.claim.mock.calls[0]?.[0]?.requestKey;
    const secondRequestKey = mocks.claim.mock.calls[1]?.[0]?.requestKey;
    expect(firstRequestKey).toBe(secondRequestKey);
    expect(firstRequestKey).not.toContain("aaaaaaaa");
    expect(mocks.atomicResponses).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          confirmed_amora_action_id: actionId,
        }),
      }),
    ]));
  });

  it("rejects a high-impact action before cost or mutation when both confirmations are absent", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.adminRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "55000", message: "AMORA_SHARED_ACTION_APPROVAL_REQUIRED" },
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "두 사람 확인을 마쳤어요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );

    const response = await POST(request({
      messages: [{ role: "user", content: "두 사람 확인을 마쳤어요." }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SHARED_ACTION_APPROVAL_REQUIRED",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps reversible schedule additions on the one-confirmation path", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const pendingAction = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-08-01","title":"드레스 피팅"}}[/pending_action]',
      allowedTools: mocks.safeTools,
      now,
      createActionId: () => actionId,
    }).pendingAction;
    expect(pendingAction).not.toBeNull();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "일정을 추가해 주세요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: pendingAction?.confirmation,
        metadata: { pending_amora_action: pendingAction },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "add_schedule_event",
      toolInput: { date: "2026-08-01", title: "드레스 피팅" },
      toolOutput: { event_id: "evt_1" },
      success: true,
      displayMessage: "일정을 추가했어요.",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일정을 추가했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "일정을 추가해 주세요." }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.adminRpc).toHaveBeenCalledWith(
      "authorize_amora_shared_action_execution",
      {
        p_action_id: actionId,
        p_confirmation_message_id: "30000000-0000-4000-8000-000000000001",
        p_couple_id: COUPLE_ID,
        p_source_message_id: "20000000-0000-4000-8000-000000000009",
        p_user_id: "00000000-0000-4000-8000-000000000001",
      },
    );
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "add_schedule_event",
      { date: "2026-08-01", title: "드레스 피팅" },
      expect.objectContaining({ pendingActionId: actionId }),
    );
  });

  it("rejects a pending action before tools when no application lease was granted", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    const pendingAction = extractAmoraPendingAction({
      text: '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-08-01","title":"드레스 피팅"}}[/pending_action]',
      allowedTools: mocks.safeTools,
      now,
      createActionId: () => actionId,
    }).pendingAction;
    expect(pendingAction).not.toBeNull();
    mocks.adminRpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: "55000",
        message: "AMORA_SHARED_ACTION_APPLICATION_CLAIM_REQUIRED",
      },
    });
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "일정을 추가해 주세요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: pendingAction?.confirmation,
        metadata: { pending_amora_action: pendingAction },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );

    const response = await POST(request({
      messages: [{ role: "user", content: "일정을 추가해 주세요." }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SHARED_ACTION_APPLICATION_CLAIM_REQUIRED",
    });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("recovers a private durable request when only newer Amora context is shared", async () => {
    const privateUserMessageId = "30000000-0000-4000-8000-000000000001";
    const privateUserText = "결혼식 예산을 다시 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "공유 대화의 더 새로운 아모라 답변",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: privateUserMessageId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: privateUserText,
        metadata: null,
        visibility: "bride_private",
        created_at: "2026-07-15T00:01:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "개인 대화를 이어서 답할게요.",
      usage: { input_tokens: 10, output_tokens: 6 },
    }));

    const response = await POST(request({
      visibility: "bride_private",
      userMessageId: privateUserMessageId,
      messages: [{ role: "user", content: privateUserText }],
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("rejects a private durable request when its own lane has newer Amora context", async () => {
    const privateUserMessageId = "30000000-0000-4000-8000-000000000001";
    const privateUserText = "결혼식 예산을 다시 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "개인 대화의 더 새로운 아모라 답변",
        metadata: null,
        visibility: "bride_private",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: privateUserMessageId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: privateUserText,
        metadata: null,
        visibility: "bride_private",
        created_at: "2026-07-15T00:01:00.000Z",
      },
    );

    const response = await POST(request({
      visibility: "bride_private",
      userMessageId: privateUserMessageId,
      messages: [{ role: "user", content: privateUserText }],
    }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "USER_MESSAGE_NOT_LATEST",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("recovers a shared durable request when only newer Amora context is private", async () => {
    const sharedUserMessageId = "30000000-0000-4000-8000-000000000001";
    const sharedUserText = "결혼식 예산을 다시 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "개인 대화의 더 새로운 아모라 답변",
        metadata: null,
        visibility: "bride_private",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: sharedUserMessageId,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: sharedUserText,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공유 대화를 이어서 답할게요.",
      usage: { input_tokens: 10, output_tokens: 6 },
    }));

    const response = await POST(request({
      visibility: "shared",
      userMessageId: sharedUserMessageId,
      messages: [{ role: "user", content: sharedUserText }],
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.provider).toHaveBeenCalledTimes(1);
  });

  it("rejects a stale durable confirmation when newer Amora context already exists", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "날짜를 다시 확인한 뒤 새로 제안할게요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "USER_MESSAGE_NOT_LATEST" });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("keeps a confirmation current when the only newer row is partner-only", async () => {
    const now = Date.now();
    const actionId = "11111111-1111-4111-8111-111111111111";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "40000000-0000-4000-8000-000000000010",
        sender_id: "00000000-0000-4000-8000-000000000002",
        sender_type: "groom",
        role: "user",
        content: "이건 우리끼리 이야기할게.",
        metadata: { target: "partner" },
        visibility: "shared",
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "총예산을 3,000만 원으로 바꿀까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "총예산을 반영했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: actionId,
    }));

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.executeTool).toHaveBeenCalledWith(
      "update_budget",
      { total_budget: 30_000_000 },
      expect.objectContaining({ pendingActionId: actionId }),
    );
  });

  it("fails closed before provider or tools when the supplied action id is not the immediate proposal", async () => {
    const now = Date.now();
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "응",
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000009",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: "다음 변경을 적용할까요?",
        metadata: {
          pending_amora_action: {
            version: 2,
            actionId: "11111111-1111-4111-8111-111111111111",
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation:
              "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원",
            issuedAt: now - 1_000,
            expiresAt: now - 1_000 + 24 * 60 * 60 * 1_000,
          },
        },
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
      confirmedActionId: "22222222-2222-4222-8222-222222222222",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "AMORA_PENDING_ACTION_CONFIRMATION_REJECTED",
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("overrides a misleading model proposal and persists only the server-owned truthful summary", async () => {
    const modelConfirmation = "일정만 가볍게 확인해볼까요?";
    const canonicalConfirmation =
      "다음 변경을 적용할까요?\n- 변경: 총 결혼 예산 변경\n- 총 예산: 3,000만 원";
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: `${modelConfirmation}\n[pending_action]{"tool":"update_budget","input":{"total_budget":30000000},"confirmation":"${modelConfirmation}"}[/pending_action]`,
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain("[pending_action]");
    expect(body).toContain('"type":"text_clear"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({
        content: canonicalConfirmation,
        metadata: expect.objectContaining({
          pending_amora_action: expect.objectContaining({
            version: 2,
            tool: "update_budget",
            input: { total_budget: 30_000_000 },
            ...BUDGET_PENDING_IDENTITY,
            confirmation: canonicalConfirmation,
          }),
          pending_amora_action_journey_revision: 0,
          pending_amora_action_impact_preview: expect.objectContaining({
            version: 1,
            kind: "budget_change",
            tool: "update_budget",
            inputDigest: BUDGET_PENDING_IDENTITY.inputDigest,
            sourceRevision: 0,
            recordedSpendBasis: "explicit_spent_only",
            current: expect.objectContaining({ totalBudget: 0 }),
            proposed: expect.objectContaining({ totalBudget: 30_000_000 }),
            delta: expect.objectContaining({ totalBudget: 30_000_000 }),
          }),
        }),
      }),
    ]);
  });

  it("server-binds an important schedule date, moment, and category before persisting the approval card", async () => {
    const userText = "2027년 2월 20일에 상견례야";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"add_schedule_event","input":{"date":"2027-02-27","title":"상견례"}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).not.toContain("[pending_action]");
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          pending_amora_action: expect.objectContaining({
            tool: "add_schedule_event",
            input: expect.objectContaining({
              date: "2027-02-20",
              title: "상견례",
              moment_type: "sanggyeonrye",
              category_key: "meeting",
            }),
          }),
        }),
      }),
    ]);
  });

  it("does not persist an executable proposal without a proposal-time journey revision", async () => {
    mocks.journeyStateRevision = null;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"update_budget","input":{"total_budget":30000000}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain('"type":"error"');
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects remote attachments before a durable claim or quota reservation", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 첨부를 봐줘",
    };

    const response = await POST(request({
      messages: [{ role: "user", content: "이 첨부를 봐줘" }],
      attachments: [{
        mediaType: "application/pdf",
        url: "https://untrusted.example/quote.pdf",
        fileName: "quote.pdf",
      }],
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "REMOTE_URL_NOT_ALLOWED" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects malformed attachment entries instead of silently dropping them", async () => {
    const response = await POST(request({ attachments: [null] }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_ATTACHMENT" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects an unsafe DOCX archive before a durable claim or quota reservation", async () => {
    const mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const base64 = makeDocxZipFixture(docxRequiredEntries([{
      name: "word/bomb.bin",
      data: Buffer.from("x"),
      method: 8,
      uncompressedSize: 10 * 1024 * 1024,
    }])).toString("base64");
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    const response = await POST(request({
      attachments: [{
        mediaType,
        base64,
        fileName: "bomb.docx",
      }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "UNSAFE_DOCX_ARCHIVE",
      error: expect.stringContaining("안전"),
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.mammothExtract).not.toHaveBeenCalled();
  });

  it("rejects excessive extracted DOCX text before a durable claim or quota reservation", async () => {
    const mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const base64 = makeDocxZipFixture(docxRequiredEntries()).toString("base64");
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    mocks.mammothExtract.mockResolvedValueOnce({ value: "x".repeat(200_001) });
    const response = await POST(request({
      attachments: [{
        mediaType,
        base64,
        fileName: "long.docx",
      }],
    }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      code: "DOCX_TEXT_TOO_LARGE",
      error: expect.stringContaining("너무 길"),
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("validates but strips a W4 DOCX before the minimized provider envelope", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 Word 문서를 봐줘",
    };
    const mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const base64 = makeDocxZipFixture(docxRequiredEntries()).toString("base64");
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    mocks.mammothExtract.mockResolvedValueOnce({ value: "계약금은 300만원입니다." });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "문서 내용을 살펴봤어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "이 Word 문서를 봐줘" }],
      attachments: [{
        mediaType,
        base64,
        fileName: "contract.docx",
      }],
    }));
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(mocks.mammothExtract).toHaveBeenCalledTimes(1);
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).not.toContain("contract.docx");
    expect(providerInput).not.toContain("계약금은 300만원입니다.");
    expect(providerInput).toContain("이 Word 문서를 봐줘");
    expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual([]);
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      "question_scope: W4_out_of_scope",
    );
    expect(body).not.toContain("문서 내용을 살펴봤어요");
    expect(body).toContain("결혼 준비 관련 파일이라면");
    expect(body).toContain("파일을 다시 첨부");
    expect(mocks.atomicResponses[0]?.content).toContain("파일을 다시 첨부");
  });

  it("keeps only the current explicit W2 attachment while stripping stored history", async () => {
    const userText = "웨딩홀 계약금 환불이 가능한지 법적으로 봐줘";
    setSensitiveStoredProviderContext(userText);
    const mediaType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const base64 = makeDocxZipFixture(docxRequiredEntries()).toString("base64");
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    mocks.mammothExtract.mockResolvedValueOnce({
      value: "W2_ATTACHMENT_CONTENT_SENTINEL",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "법률 판단 없이 확인할 항목만 정리할게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
      attachments: [{
        mediaType,
        base64,
        fileName: "W2_ATTACHMENT_FILE_SENTINEL.docx",
      }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    const envelope = JSON.stringify({
      systemPrompt: providerArgs?.systemPrompt,
      input: providerArgs?.input,
    });
    expect(envelope).toContain(userText);
    expect(envelope).not.toContain("W2_ATTACHMENT_FILE_SENTINEL.docx");
    expect(envelope).toContain("attachment-1.docx");
    expect(envelope).toContain("W2_ATTACHMENT_CONTENT_SENTINEL");
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W2_high_risk_adjacent",
    );
    for (const sentinel of [
      "PRIVATE_BRIDE_SENTINEL",
      "PRIVATE_SCHEDULE_SENTINEL",
      "PRIVATE_SUMMARY_SENTINEL",
      "PRIVATE_DECISION_SENTINEL",
      "PRIVATE_CONFLICT_SENTINEL",
      "PRIVATE_PROFILE_SENTINEL",
      "PRIVATE_ASSISTANT_HISTORY_SENTINEL",
      "PRIVATE_USER_HISTORY_SENTINEL",
    ]) {
      expect(envelope).not.toContain(sentinel);
    }
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        specialistType: "contract_reviewer",
        stageTag: null,
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.atomicFinalizations[0]).toMatchObject({
      message: {
        specialistType: "contract_reviewer",
        stageTag: null,
      },
    });
  });

  it("routes a server-accepted PDF to document analysis tools", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "이 웨딩 견적 PDF를 봐줘",
    };
    const mediaType = "application/pdf";
    const base64 = "JVBERi0xLjQK";
    await bindCanonicalProviderAttachments([{ mediaType, base64 }]);
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "견적서를 살펴볼게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "이 웨딩 견적 PDF를 봐줘" }],
      attachments: [{
        mediaType,
        base64,
        fileName: "quote.pdf",
      }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.buildMultimodal).toHaveBeenCalledWith(
      expect.any(String),
      [expect.objectContaining({ fileName: "attachment-1.pdf" })],
    );
    expect(JSON.stringify(mocks.buildMultimodal.mock.calls)).not.toContain("quote.pdf");
    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    expect(toolNames).toContain("analyze_quote");
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ specialistType: "contract_reviewer" }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("wraps each provider generation in the per-call ledger and applies the exact request envelope", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "예산 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.providerLedger).toHaveBeenCalledTimes(1);
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        coupleId: COUPLE_ID,
        userId: "00000000-0000-4000-8000-000000000001",
        callIndex: 1,
        phase: "tool_round",
        modelRole: "fast",
      }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.provider).toHaveBeenCalledWith(expect.objectContaining({
      maxInputTokens: 64_000,
      maxOutputTokens: 1_400,
    }));
  });

  it("does not expose a buffered draft or durable done event when the atomic terminal commit is unconfirmed", async () => {
    mocks.provider.mockImplementationOnce(async (options: {
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeGeneration?.();
      options.onTextDelta?.("아직 커밋되지 않은 초안");
      return providerResult({
        fullText: "아직 커밋되지 않은 초안",
        usage: { input_tokens: 10, output_tokens: 3 },
      });
    });
    mocks.providerLedger.mockImplementationOnce(async (_context, call, options) => {
      const result = await call(
        async () => undefined,
        async () => undefined,
        mocks.providerEgressAuthorizer,
      );
      options?.buildAtomicChatResponse?.(result);
      throw new Error("[ai-ledger] terminal chat response was not committed");
    });

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("아직 커밋되지 않은 초안");
    expect(body).toContain('"type":"text_clear"');
    expect(body).toContain('"type":"error"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.completeClaim).not.toHaveBeenCalled();
  });

  it("maps an oversized provider input to an actionable SSE error without leaking internals", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.provider.mockRejectedValueOnce(Object.assign(
      new Error("SECRET_PROVIDER_INPUT_DETAILS"),
      { providerCode: "input_token_limit", requestStage: "input_count" },
    ));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    expect(body).toContain('"code":"AMORA_INPUT_TOO_LARGE"');
    expect(body).toContain('"retryable":false');
    expect(body).toContain('"retryPolicy":"new_message"');
    expect(body).toContain("대화나 첨부파일 내용이 너무 길어요");
    expect(body).not.toContain("SECRET_PROVIDER_INPUT_DETAILS");
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: false,
      model: null,
      tokensInput: null,
      tokensOutput: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      costUsd: null,
    }));
    errorSpy.mockRestore();
  });

  it("distinguishes an input-count service failure from oversized input", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.provider.mockRejectedValueOnce(Object.assign(
      new Error("SECRET_COUNT_ENDPOINT_DETAILS"),
      { providerCode: "server_error", requestStage: "input_count" },
    ));

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"code":"AMORA_INPUT_COUNT_UNAVAILABLE"');
    expect(body).toContain('"retryable":true');
    expect(body).toContain('"retryPolicy":"same_request"');
    expect(body).toContain("입력 분량을 확인하는 중 문제가 생겼어요");
    expect(body).not.toContain("SECRET_COUNT_ENDPOINT_DETAILS");
    expect(mocks.reserve).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("ignores authenticated client wedding context and safely handles malformed nested fields", async () => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "서버 정보를 기준으로 답했어요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      weddingContext: {
        weddingDate: "2030-01-01",
        budget: 999_999_999,
        venue: "CLIENT_WEDDING_CONTEXT_INJECTION",
        progress: {
          __events: "not-an-array",
          __preferences: { priorities: "not-an-array" },
        },
      },
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = JSON.stringify(mocks.provider.mock.calls[0]?.[0]);
    expect(providerArgs).not.toContain("CLIENT_WEDDING_CONTEXT_INJECTION");
    expect(providerArgs).not.toContain("999999999");
  });

  it("fails closed before cost reservation when canonical wedding context is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.journeyError = { code: "PGRST500", message: "database unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "WEDDING_CONTEXT_UNAVAILABLE" });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it.each([
    ["directoryError", "COUPLE_DIRECTORY_UNAVAILABLE"],
    ["decisionsError", "DECISIONS_CONTEXT_UNAVAILABLE"],
  ] as const)(
    "fails closed when canonical %s lookup fails",
    async (errorKey, expectedCode) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks[errorKey] = { code: "PGRST500", message: "database unavailable" };

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: expectedCode });
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.failClaim).toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it("fails closed on a consented memory-summary outage instead of pretending there is no history", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.summariesError = { code: "PGRST500", message: "database unavailable" };

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "MEMORY_CONTEXT_UNAVAILABLE" });
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("fails closed before context reads when the initial privacy snapshot is unavailable", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.privacySnapshotSequence.push(
      privacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE"),
    );

    const response = await POST(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_PRIVACY_CONTEXT_UNAVAILABLE",
    });
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    errorSpy.mockRestore();
  });

  it("does not atomically persist or display a reply when privacy changes during generation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const withdrawn = privacySnapshot({
      memory: {
        shared: {
          enabled: false,
          resetAt: "2026-07-31T00:01:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    // Initial context read, pre-count recheck, pre-generation recheck, then
    // the new post-provider/pre-atomic recheck observes withdrawal.
    mocks.privacySnapshotSequence.push(initial, initial, initial, withdrawn);
    const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
      fullText: "저장되거나 표시되면 안 되는 답변",
    }));

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(networkBoundary).toHaveBeenCalledTimes(1);
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(body).toContain('"retryable":false');
    expect(body).toContain('"retryPolicy":"new_message"');
    expect(body).not.toContain("저장되거나 표시되면 안 되는 답변");
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.atomicFinalizations).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("discards a stored-context reply when the atomic privacy epoch changes at commit", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const privateDraft = "PRIVATE_PROVIDER_DRAFT_MUST_NEVER_FLASH";
    mocks.atomicOutcome = "privacy_context_changed";
    mocks.provider.mockImplementationOnce(async (options: {
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeGeneration?.();
      options.onTextDelta?.(privateDraft);
      return providerResult({ fullText: privateDraft });
    });

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(body).not.toContain(privateDraft);
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({ expectedPrivacyEpoch: 7 }),
    ]);
    expect(mocks.atomicFinalizations).toEqual([
      expect.objectContaining({
        outcome: "privacy_context_changed",
        message: null,
      }),
    ]);
    // The privacy-fenced database finalizer already failed this exact claim.
    expect(mocks.failClaim).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("withholds every stored-context tool payload when the terminal privacy commit is rejected", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const currentUserText = "예식장 정보를 확인해줘";
    const toolRoundDraft = "PRIVATE_TOOL_ROUND_PROVIDER_DRAFT";
    const finalDraft = "PRIVATE_FINAL_PROVIDER_DRAFT";
    const privateToolResult = "PRIVATE_TOOL_RESULT_MUST_NOT_FLASH";
    setSensitiveStoredProviderContext(currentUserText);
    mocks.atomicOutcome = "privacy_context_changed";
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "get_wedding_info",
      toolInput: { source: "PRIVATE_TOOL_INPUT_MUST_NOT_FLASH" },
      toolOutput: { weddingVenue: privateToolResult },
      success: true,
      displayMessage: privateToolResult,
    });
    mocks.provider
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(toolRoundDraft);
        return providerResult({
          fullText: toolRoundDraft,
          toolCalls: [{
            callId: "call_private_tool_round",
            name: "get_wedding_info",
            input: { source: "PRIVATE_TOOL_INPUT_MUST_NOT_FLASH" },
          }],
          outputItems: [{
            id: "fc_private_tool_round",
            type: "function_call",
            call_id: "call_private_tool_round",
            name: "get_wedding_info",
            arguments: '{"source":"PRIVATE_TOOL_INPUT_MUST_NOT_FLASH"}',
            status: "completed",
          }],
        });
      })
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(finalDraft);
        return providerResult({ fullText: finalDraft });
      });

    const response = await POST(request({
      messages: [{ role: "user", content: currentUserText }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(body).not.toContain(toolRoundDraft);
    expect(body).not.toContain(finalDraft);
    expect(body).not.toContain("PRIVATE_TOOL_INPUT_MUST_NOT_FLASH");
    expect(body).not.toContain(privateToolResult);
    expect(body).not.toContain('"type":"tool_start"');
    expect(body).not.toContain('"type":"tool_result"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.buildJournalCheckpoint).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.atomicFinalizations).toEqual([
      expect.objectContaining({
        outcome: "privacy_context_changed",
        message: null,
      }),
    ]);
    // The privacy-fenced database finalizer already failed this exact claim.
    expect(mocks.failClaim).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("withholds every terminal payload until durable memory enqueue is confirmed", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const currentUserText = "예식장 정보를 확인해줘";
    const toolRoundDraft = "PRIVATE_TOOL_ROUND_DRAFT_BEFORE_MEMORY_PROOF";
    const finalDraft = "PRIVATE_FINAL_DRAFT_BEFORE_MEMORY_PROOF";
    const toolResult = "PRIVATE_TOOL_RESULT_BEFORE_MEMORY_PROOF";
    const suggestion = "PRIVATE_SUGGESTION_BEFORE_MEMORY_PROOF";
    setSensitiveStoredProviderContext(currentUserText);
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    mocks.enqueueMemory.mockResolvedValueOnce("failed");
    mocks.extractSuggestions.mockReturnValueOnce({
      cleanText: finalDraft,
      suggestions: [suggestion],
    });
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "get_wedding_info",
      toolInput: {},
      toolOutput: { venue: toolResult },
      success: true,
      displayMessage: toolResult,
    });
    mocks.provider
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(toolRoundDraft);
        return providerResult({
          fullText: toolRoundDraft,
          toolCalls: [{
            callId: "call_memory_proof",
            name: "get_wedding_info",
            input: {},
          }],
          outputItems: [{
            id: "fc_memory_proof",
            type: "function_call",
            call_id: "call_memory_proof",
            name: "get_wedding_info",
            arguments: "{}",
            status: "completed",
          }],
        });
      })
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(finalDraft);
        return providerResult({ fullText: finalDraft });
      });

    const response = await POST(request({
      messages: [{ role: "user", content: currentUserText }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED");
    for (const protectedValue of [
      toolRoundDraft,
      finalDraft,
      toolResult,
      suggestion,
    ]) {
      expect(body).not.toContain(protectedValue);
    }
    expect(body).not.toContain('"type":"tool_start"');
    expect(body).not.toContain('"type":"tool_result"');
    expect(body).not.toContain('"type":"text_delta"');
    expect(body).not.toContain('"type":"suggestions"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      memory_enqueue_requested: true,
    });
    errorSpy.mockRestore();
  });

  it("withholds the normal terminal when privacy changes while memory enqueue resolves disabled", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const currentUserText = "예식장 정보를 확인해줘";
    const toolDraft = "NORMAL_PRIVACY_RACE_TOOL_DRAFT";
    const finalDraft = "NORMAL_PRIVACY_RACE_FINAL_DRAFT";
    const toolResult = "NORMAL_PRIVACY_RACE_TOOL_RESULT";
    const suggestion = "NORMAL_PRIVACY_RACE_SUGGESTION";
    setSensitiveStoredProviderContext(currentUserText);
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    mocks.getPrivacyEpoch.mockReset();
    mocks.getPrivacyEpoch.mockResolvedValue(7);
    mocks.enqueueMemory.mockImplementationOnce(async () => {
      // Consent/reset changes after the atomic terminal commit but before the
      // memory reconciliation returns its fail-open `disabled` result.
      mocks.getPrivacyEpoch.mockResolvedValue(8);
      return "disabled";
    });
    mocks.extractSuggestions.mockReturnValueOnce({
      cleanText: finalDraft,
      suggestions: [suggestion],
    });
    mocks.executeTool.mockResolvedValueOnce({
      toolName: "get_wedding_info",
      toolInput: {},
      toolOutput: { venue: toolResult },
      success: true,
      displayMessage: toolResult,
    });
    mocks.provider
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(toolDraft);
        return providerResult({
          fullText: toolDraft,
          toolCalls: [{
            callId: "call_normal_privacy_race",
            name: "get_wedding_info",
            input: {},
          }],
          outputItems: [{
            id: "fc_normal_privacy_race",
            type: "function_call",
            call_id: "call_normal_privacy_race",
            name: "get_wedding_info",
            arguments: "{}",
            status: "completed",
          }],
        });
      })
      .mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(finalDraft);
        return providerResult({ fullText: finalDraft });
      });

    const response = await POST(request({
      messages: [{ role: "user", content: currentUserText }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"code":"AMORA_PRIVACY_CONTEXT_CHANGED"');
    expect(body).toContain('"retryPolicy":"new_message"');
    for (const protectedValue of [
      toolDraft,
      finalDraft,
      toolResult,
      suggestion,
    ]) {
      expect(body).not.toContain(protectedValue);
    }
    expect(body).not.toContain('"type":"tool_start"');
    expect(body).not.toContain('"type":"tool_result"');
    expect(body).not.toContain('"type":"text_delta"');
    expect(body).not.toContain('"type":"suggestions"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicFinalizations).toEqual([
      expect.objectContaining({ outcome: "persisted" }),
    ]);
    expect(mocks.enqueueMemory).toHaveBeenCalledTimes(1);
    expect(mocks.getPrivacyEpoch).toHaveBeenCalledTimes(2);
    expect(mocks.failClaim).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("withholds the MAX_TOOL_ROUNDS terminal when privacy changes during memory reconciliation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const currentUserText = "예식장 정보를 두 번 확인해줘";
    const finalDraft = "MAX_PRIVACY_RACE_FINAL_DRAFT";
    const suggestion = "MAX_PRIVACY_RACE_SUGGESTION";
    setSensitiveStoredProviderContext(currentUserText);
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    mocks.getPrivacyEpoch.mockReset();
    mocks.getPrivacyEpoch.mockResolvedValue(7);
    mocks.enqueueMemory.mockImplementationOnce(async () => {
      mocks.getPrivacyEpoch.mockResolvedValue(8);
      return "disabled";
    });
    mocks.extractSuggestions.mockReturnValueOnce({
      cleanText: finalDraft,
      suggestions: [suggestion],
    });
    mocks.executeTool.mockImplementation(async (
      toolName: string,
      toolInput: Record<string, unknown>,
    ) => ({
      toolName,
      toolInput,
      toolOutput: { private: `MAX_PRIVACY_RACE_RESULT_${String(toolInput.round)}` },
      success: true,
      displayMessage: `MAX_PRIVACY_RACE_RESULT_${String(toolInput.round)}`,
    }));
    for (let round = 0; round < 2; round++) {
      mocks.provider.mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
        onTextDelta?: (value: string) => void;
      }) => {
        await options.beforeGeneration?.();
        options.onTextDelta?.(`MAX_PRIVACY_RACE_DRAFT_${round}`);
        return providerResult({
          fullText: `MAX_PRIVACY_RACE_DRAFT_${round}`,
          toolCalls: [{
            callId: `call_max_privacy_race_${round}`,
            name: "get_wedding_info",
            input: { round },
          }],
          outputItems: [{
            id: `fc_max_privacy_race_${round}`,
            type: "function_call",
            call_id: `call_max_privacy_race_${round}`,
            name: "get_wedding_info",
            arguments: JSON.stringify({ round }),
            status: "completed",
          }],
        });
      });
    }
    mocks.provider.mockImplementationOnce(async (options: {
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeGeneration?.();
      options.onTextDelta?.(finalDraft);
      return providerResult({ fullText: finalDraft });
    });

    const response = await POST(request({
      messages: [{ role: "user", content: currentUserText }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"code":"AMORA_PRIVACY_CONTEXT_CHANGED"');
    for (const protectedValue of [
      "MAX_PRIVACY_RACE_DRAFT_0",
      "MAX_PRIVACY_RACE_DRAFT_1",
      "MAX_PRIVACY_RACE_RESULT_0",
      "MAX_PRIVACY_RACE_RESULT_1",
      finalDraft,
      suggestion,
    ]) {
      expect(body).not.toContain(protectedValue);
    }
    expect(body).not.toContain('"type":"tool_start"');
    expect(body).not.toContain('"type":"tool_result"');
    expect(body).not.toContain('"type":"text_delta"');
    expect(body).not.toContain('"type":"suggestions"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.provider).toHaveBeenCalledTimes(3);
    expect(mocks.atomicFinalizations).toEqual([
      expect.objectContaining({ outcome: "persisted" }),
    ]);
    expect(mocks.enqueueMemory).toHaveBeenCalledTimes(1);
    expect(mocks.getPrivacyEpoch).toHaveBeenCalledTimes(2);
    expect(mocks.failClaim).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not reserve, call the provider network, or persist after memory consent is withdrawn", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const withdrawn = privacySnapshot({
      memory: {
        shared: {
          enabled: false,
          resetAt: "2026-07-31T00:01:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(initial, withdrawn);
    const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
      fullText: "생성되면 안 되는 답변",
    }));

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(networkBoundary).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("does not cross the provider boundary when the memory reset boundary changes", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const reset = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:02:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(initial, reset);
    const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
      fullText: "생성되면 안 되는 답변",
    }));

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(networkBoundary).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    errorSpy.mockRestore();
  });

  it.each([
    [
      "deleted",
      { exists: false, revision: null },
    ],
    [
      "updated",
      { exists: true, revision: 3 },
    ],
  ] as const)(
    "does not cross the provider boundary when personalization is %s",
    async (_change, currentPersonalization) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.personalizationRow = {
        decision_start: "compare_first",
        answer_detail: "brief",
        support_order: "listen_first",
        work_mode: "hybrid",
        family_order: "couple_first",
        tone_style: "adaptive",
        revision: 2,
        confirmed_at: "2026-07-31T01:00:00.000Z",
        updated_at: "2026-07-31T02:00:00.000Z",
      };
      const initial = privacySnapshot();
      const changed = privacySnapshot({
        personalization: currentPersonalization,
      });
      mocks.privacySnapshotSequence.push(initial, changed);
      const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
        fullText: "생성되면 안 되는 답변",
      }));

      const response = await POST(request());
      const body = await response.text();

      expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
      expect(networkBoundary).not.toHaveBeenCalled();
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toEqual([]);
      expect(mocks.persist).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  it("fails closed before reservation when the final privacy recheck errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.privacySnapshotSequence.push(
      privacySnapshot(),
      privacyContextError("AMORA_PRIVACY_CONTEXT_UNAVAILABLE"),
    );
    const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
      fullText: "생성되면 안 되는 답변",
    }));

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain("AMORA_PRIVACY_CONTEXT_UNAVAILABLE");
    expect(networkBoundary).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rechecks again after provider input counting and before generation", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const reset = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:05:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(
      initial,
      privacySnapshot({ memory: initial.memory }),
      reset,
    );
    const inputCountBoundary = vi.fn();
    const generationBoundary = vi.fn();
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
    }) => {
      // 실제 계약과 같은 순서: egress gate가 토큰 계산보다도 먼저다.
      await options.beforeProviderEgress?.();
      inputCountBoundary();
      await options.beforeGeneration?.();
      generationBoundary();
      return providerResult({ fullText: "생성되면 안 되는 답변" });
    });

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(inputCountBoundary).toHaveBeenCalledTimes(1);
    expect(generationBoundary).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    errorSpy.mockRestore();
  });

  it("allows a scope enabled after the prompt was built to finish without rebuilding it", async () => {
    const initial = privacySnapshot();
    const newlyEnabled = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:03:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(initial, newlyEnabled);
    const networkBoundary = providerNetworkAfterPreGeneration(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain('"type":"done"');
    expect(networkBoundary).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
  });

  it("rechecks privacy after every provider round before executing a tool", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    const initial = privacySnapshot({
      memory: {
        shared: {
          enabled: true,
          resetAt: "2026-07-31T00:00:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    const stillCurrent = privacySnapshot({
      memory: initial.memory,
    });
    const withdrawn = privacySnapshot({
      memory: {
        shared: {
          enabled: false,
          resetAt: "2026-07-31T00:04:00.000Z",
        },
        bride_private: { enabled: false, resetAt: null },
        groom_private: { enabled: false, resetAt: null },
      },
    });
    mocks.privacySnapshotSequence.push(
      initial,
      stillCurrent,
      privacySnapshot({ memory: initial.memory }),
      withdrawn,
    );
    const networkBoundary = vi.fn();
    mocks.provider.mockImplementation(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      networkBoundary();
      if (networkBoundary.mock.calls.length === 1) {
        return providerResult({
          toolCalls: [{
            callId: "call_privacy_round",
            name: "get_wedding_info",
            input: {},
          }],
          outputItems: [{
            id: "fc_privacy_round",
            type: "function_call",
            call_id: "call_privacy_round",
            name: "get_wedding_info",
            arguments: "{}",
            status: "completed",
          }],
        });
      }
      return providerResult({ fullText: "생성되면 안 되는 두 번째 답변" });
    });

    const response = await POST(request());
    const body = await response.text();

    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(mocks.provider).toHaveBeenCalledTimes(1);
    expect(networkBoundary).toHaveBeenCalledTimes(1);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
    expect(mocks.persist).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("projects source-validated V2 profile nodes into the prompt when consent is on", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push({
      id: "50000000-0000-4000-8000-000000000001",
      couple_id: COUPLE_ID,
      visibility: "shared",
      memory_key: "venue:preferred_area",
      title: "선호 지역",
      chosen_value: { value: "강남" },
      reasoning: null,
      confidence: 0.9,
      source_message_id: "30000000-0000-4000-8000-000000000001",
      source_actor_role: "bride",
      superseded_at: null,
      metadata: { memory_kind: "preference", explicit: true },
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
      source_message: {
        id: "30000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        visibility: "shared",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        metadata: null,
      },
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "맞춤 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      "신부 명시 · venue:preferred_area = 강남",
    );
  });

  it("does not expose projected profile nodes when memory consent is off", async () => {
    mocks.profileProjectionRows.push({
      id: "50000000-0000-4000-8000-000000000002",
      couple_id: COUPLE_ID,
      visibility: "shared",
      memory_key: "venue:preferred_area",
      title: "선호 지역",
      chosen_value: { value: "CONSENT_OFF_SECRET" },
      reasoning: null,
      confidence: 0.9,
      source_message_id: "30000000-0000-4000-8000-000000000001",
      source_actor_role: "bride",
      superseded_at: null,
      metadata: { memory_kind: "preference", explicit: true },
      created_at: "2026-07-15T00:00:00.000Z",
      updated_at: "2026-07-15T00:00:00.000Z",
      source_message: {
        id: "30000000-0000-4000-8000-000000000001",
        couple_id: COUPLE_ID,
        visibility: "shared",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        metadata: null,
      },
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).not.toContain(
      "CONSENT_OFF_SECRET",
    );
    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
  });

  it("scopes a valid personal help style to the authenticated actor and prompt", async () => {
    mocks.personalizationRow = {
      decision_start: "compare_first",
      answer_detail: "brief",
      support_order: "listen_first",
      work_mode: "hybrid",
      family_order: "couple_first",
      tone_style: "calm_clear",
      revision: 2,
      confirmed_at: "2026-07-31T01:00:00.000Z",
      updated_at: "2026-07-31T02:00:00.000Z",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "개인 도움 방식 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.personalizationEq).toHaveBeenCalledWith(
      "owner_user_id",
      "00000000-0000-4000-8000-000000000001",
    );
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(
      'helpPreference={"decisionStart":"compare_first","answerDetail":"brief","supportOrder":"listen_first","workMode":"hybrid","familyOrder":"couple_first","toneStyle":"calm_clear"}',
    );
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      in_reply_to_user_message_id:
        "30000000-0000-4000-8000-000000000001",
    });
  });

  it("fails an invalid or unavailable personal help style neutral without leaking it", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.personalizationRow = {
      decision_start: "SECRET_PERSONALITY_CLASS",
      answer_detail: "brief",
      support_order: "listen_first",
      work_mode: "hybrid",
      family_order: "couple_first",
      tone_style: "expert_roleplay",
      revision: 1,
      confirmed_at: "2026-07-31T01:00:00.000Z",
      updated_at: "2026-07-31T01:00:00.000Z",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "중립 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const malformedResponse = await POST(request());
    expect(malformedResponse.status).toBe(200);
    await malformedResponse.text();
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .toContain("helpPreference=null");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("SECRET_PERSONALITY_CLASS");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("expert_roleplay");
    expect(warning).toHaveBeenCalledWith(
      "[chat] personalization row failed closed",
    );

    vi.clearAllMocks();
    mocks.personalizationRow = null;
    mocks.personalizationError = { code: "PGRST500" };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "오류에서도 중립 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    mocks.claim.mockResolvedValue({
      action: "acquired",
      attemptCount: 1,
      reclaimed: false,
    });
    mocks.reserve.mockResolvedValue({ allowed: true, remaining: 99 });
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        ...((mocks.canonicalRows[0]?.metadata as Record<string, unknown> | null) ?? {}),
        client_request_id: "00000000-0000-4000-8000-000000000098",
      },
    };

    const unavailableResponse = await POST(request({
      clientRequestId: "00000000-0000-4000-8000-000000000098",
    }));
    expect(unavailableResponse.status).toBe(200);
    await unavailableResponse.text();
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .toContain("helpPreference=null");
    expect(warning).toHaveBeenCalledWith(
      "[chat] personalization lookup failed",
      { code: "PGRST500" },
    );
    warning.mockRestore();
  });

  it("does not query profile sources or summaries for a disabled private scope", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    mocks.profileProjectionRows.push(projectionRow({
      visibility: "bride_private",
      memoryKey: "style:private_secret",
      value: "PRIVATE_CONSENT_OFF_SECRET",
    }));
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 개인 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.profileSourceSelect).not.toHaveBeenCalled();
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("chat_summaries");
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("PRIVATE_CONSENT_OFF_SECRET");
  });

  it("reserves a private actor quota subject instead of the couple's shared subject", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    providerAcrossBothEgressBoundaries(providerResult({
      fullText: "개인 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.reserve).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        coupleId: deriveAmoraQuotaSubjectId({
          coupleId: COUPLE_ID,
          actorUserId: "00000000-0000-4000-8000-000000000001",
          visibility: "bride_private",
        }),
      }),
    );
    expect(mocks.reserve.mock.calls[0]?.[1]?.coupleId).not.toBe(COUPLE_ID);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      metadata: expect.objectContaining({ visibility: "bride_private" }),
    }));
  });

  it("keeps private chat read-only even when the user asks for a shared-state change", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "우리 결혼 총 예산을 4천만원으로 변경해줘",
      visibility: "bride_private",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공유 대화에서 변경을 도와드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    const toolNames = mocks.provider.mock.calls[0]?.[0]?.tools
      .map((tool: { name: string }) => tool.name);
    expect(toolNames).not.toContain("update_budget");
    expect(toolNames).toContain("get_wedding_info");
  });

  it("uses only the shared projection in a shared chat turn", async () => {
    mocks.memoryEnablement = {
      shared: true,
      bride_private: true,
      groom_private: true,
    };
    mocks.profileProjectionRows.push(
      projectionRow({ value: "SHARED_PROFILE" }),
      projectionRow({
        visibility: "bride_private",
        memoryKey: "style:bride_private",
        value: "BRIDE_PRIVATE_PROFILE",
      }),
      projectionRow({
        visibility: "groom_private",
        actor: "groom",
        memoryKey: "style:groom_private",
        value: "GROOM_PRIVATE_PROFILE",
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "공유 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).toContain("SHARED_PROFILE");
    expect(prompt).not.toContain("BRIDE_PRIVATE_PROFILE");
    expect(prompt).not.toContain("GROOM_PRIVATE_PROFILE");
  });

  it("uses shared and bride-private projections only in a bride-private turn", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    mocks.memoryEnablement = {
      shared: true,
      bride_private: true,
      groom_private: true,
    };
    mocks.profileProjectionRows.push(
      projectionRow({ value: "SHARED_PROFILE" }),
      projectionRow({
        visibility: "bride_private",
        memoryKey: "style:bride_private",
        value: "BRIDE_PRIVATE_PROFILE",
      }),
      projectionRow({
        visibility: "groom_private",
        actor: "groom",
        memoryKey: "style:groom_private",
        value: "GROOM_PRIVATE_PROFILE",
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "개인 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({ visibility: "bride_private" }));
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).toContain("SHARED_PROFILE");
    expect(prompt).toContain("BRIDE_PRIVATE_PROFILE");
    expect(prompt).not.toContain("GROOM_PRIVATE_PROFILE");
  });

  it("fails profile projection closed when the bounded query returns 501 rows", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(
      projectionRow({ value: "OVERFLOW_MUST_NOT_LEAK" }),
      ...Array.from({ length: 500 }, () => ({})),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("OVERFLOW_MUST_NOT_LEAK");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection failed closed",
      "too_many_nodes",
    );
    warning.mockRestore();
  });

  it("fails profile projection closed when the dedicated query errors", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(projectionRow({ value: "QUERY_ERROR_SECRET" }));
    mocks.profileProjectionError = { code: "PGRST200" };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
      .not.toContain("QUERY_ERROR_SECRET");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection source query failed",
      "PGRST200",
    );
    warning.mockRestore();
  });

  it("fails all profile fields closed when a V2 source embed is incomplete", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.memoryEnablement.shared = true;
    mocks.profileProjectionRows.push(
      projectionRow({ value: "OTHERWISE_VALID_SECRET" }),
      projectionRow({
        memoryKey: "style:incomplete_source",
        value: "INCOMPLETE_SOURCE_SECRET",
        sourceMessage: null,
      }),
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "일반 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const prompt = mocks.provider.mock.calls[0]?.[0]?.systemPrompt;
    expect(prompt).not.toContain("OTHERWISE_VALID_SECRET");
    expect(prompt).not.toContain("INCOMPLETE_SOURCE_SECRET");
    expect(warning).toHaveBeenCalledWith(
      "[chat] profile projection failed closed",
      "invalid_source",
    );
    warning.mockRestore();
  });

  it("adds a server-owned non-persistence notice when demo AI omits it", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    const providerFalseSuccess =
      "날짜가 정해지니 갑자기 현실로 다가와 숨 막힐 수 있어요. 말씀하신 결혼 날짜는 실제 일정에 저장했어요.";
    mocks.provider.mockImplementationOnce(async (options: {
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeGeneration?.();
      options.onTextDelta?.(providerFalseSuccess);
      return providerResult({
        fullText: providerFalseSuccess,
        usage: { input_tokens: 10, output_tokens: 3 },
      });
    });

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
      messages: [{ role: "user", content: "결혼식은 내년 5월 3일로 정했는데 벌써 숨 막혀." }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain(providerFalseSuccess);
    expect(body).not.toContain("실제 일정에 저장했어요");
    expect(body).toContain("실제 일정에는 아직 저장되지 않았어요");
    expect(mocks.persist).toHaveBeenCalledWith(expect.objectContaining({
      cleanText: expect.stringContaining("실제 일정에는 아직 저장되지 않았어요"),
    }));
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ quotaScope: "demo" }),
    );
  });

  it("uses a signed, request-bound release evaluation path without consuming demo quota", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    providerAfterPreGeneration(providerResult({
      fullText: "평가 상담 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://hanbang.ai/api/chat"));

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("평가 상담 응답");
    expect(mocks.reserve).toHaveBeenCalledWith(
      expect.anything(),
      {
        coupleId: "00000000-0000-4000-8000-000000000001",
        isAdmin: false,
        quotaScope: "release_eval",
        maxCostMicrousd: 88_400,
      },
    );
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "chat-eval:production",
      expect.objectContaining({ maxRequests: 12 }),
      { failClosed: true },
    );
    expect(mocks.providerLedger).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, coupleId: null }),
      expect.any(Function),
      expect.any(Object),
    );
  });

  it("shares the production evaluation limit across immutable Vercel aliases", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "운영 고정 주소 평가 응답",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://wedding-hanbang-production-hanbang.vercel.app/api/chat"));

    expect(response.status).toBe(200);
    expect(mocks.rateLimit).toHaveBeenCalledWith(
      "chat-eval:production",
      expect.objectContaining({ maxRequests: 12 }),
      { failClosed: true },
    );
  });

  it("fails a signed release evaluation before provider use when atomic cost reservation is unavailable", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;
    mocks.reserve.mockResolvedValueOnce({
      allowed: false,
      reason: "guard_unavailable",
      message: "평가 사용량을 예약하지 못했습니다.",
    });
    providerAfterPreGeneration(providerResult({ fullText: "절대 생성되면 안 되는 응답" }));
    const token = createAmoraEvalToken(process.env.AMORA_EVAL_SECRET, REQUEST_ID);

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": token }, "https://hanbang.ai/api/chat"));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"code":"COST_GUARD_UNAVAILABLE"');
    expect(body).not.toContain("절대 생성되면 안 되는 응답");
    expect(mocks.persist).not.toHaveBeenCalled();
  });

  it("rejects an invalid release evaluation token instead of falling back to public demo", async () => {
    process.env.AMORA_EVAL_SECRET = "release-eval-secret-that-is-at-least-32-chars";
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }, { "X-Amora-Eval": "v1.1784067600000.invalid" }));

    expect(response.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("still rejects an unsigned demo claim without a Supabase user", async () => {
    mocks.authenticatedUser = null;

    const response = await POST(request({
      coupleId: "demo-couple",
      isDemo: true,
      userMessageId: undefined,
    }));

    expect(response.status).toBe(401);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("does not let a signed demo session select a real couple id", async () => {
    mocks.authenticatedUser = null;
    mocks.signedDemo = true;

    const response = await POST(request({
      isDemo: true,
      userMessageId: undefined,
    }));

    expect(response.status).toBe(400);
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("persists the exact server memory scope and withholds done when the first enqueue is unconfirmed", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    providerAfterPreGeneration(providerResult({
      fullText: "결혼 예산을 함께 정리해볼게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    mocks.enqueueMemory.mockResolvedValueOnce("failed");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"error"');
    expect(body).toContain('"code":"AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED"');
    expect(body).toContain('"retryable":true');
    expect(body).toContain('"retryPolicy":"same_request"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicResponses).toEqual([
      expect.objectContaining({
        metadata: expect.objectContaining({
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          memory_enqueue_requested: true,
        }),
      }),
    ]);
    expect(mocks.enqueueMemory).toHaveBeenCalledWith({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000001",
      visibility: "shared",
      toMessageId: "20000000-0000-4000-8000-000000000001",
      admin: undefined,
    });
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: false,
      errorMessage: "AMORA_MEMORY_ENQUEUE_RETRY_REQUIRED",
      metadata: expect.objectContaining({
        question_scope: "W0_wedding_core",
      }),
    }));
    errorSpy.mockRestore();
  });

  it("emits done when an immediate enqueue failure has an exact durable repair proof", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    providerAfterPreGeneration(providerResult({
      fullText: "결혼 예산을 함께 정리해볼게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));
    mocks.enqueueMemory.mockResolvedValueOnce("failed");
    mocks.verifyMemoryRepair.mockResolvedValueOnce({ status: "confirmed" });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await POST(request());
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"done"');
    expect(body).not.toContain('"type":"error"');
    expect(mocks.verifyMemoryRepair).toHaveBeenCalledWith(expect.objectContaining({
      coupleId: COUPLE_ID,
      userId: "00000000-0000-4000-8000-000000000001",
      visibility: "shared",
      toMessageId: "20000000-0000-4000-8000-000000000001",
    }));
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({
      interactionType: "chat_turn",
      success: true,
    }));
    errorSpy.mockRestore();
  });

  it("persists a false enqueue marker when auxiliary memory runtime is disabled", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.auxiliaryMemoryRuntimeEnabled = false;
    providerAfterPreGeneration(providerResult({
      fullText: "결혼 예산을 함께 정리해볼게요.",
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W0_wedding_core",
      memory_eligible: true,
      memory_enqueue_requested: false,
      amora_wedding_context_revision: 0,
      amora_first_use_grounding: {
        version: 1,
        sourceRevision: 0,
        confirmed: [],
        unknowns: [
          { key: "current_progress", label: "이미 마친 준비와 아직 남은 준비" },
          { key: "wedding_date", label: "결혼식 날짜" },
          { key: "next_schedule", label: "가장 가까운 중요한 일정" },
        ],
      },
    });
  });

  it("seals a safe canonical first action from a private provider response without private text", async () => {
    const providerText = [
      "지금 할 한 가지: 신라호텔 예약금 300만원 보내기",
      "이유: 업체 계약에 필요한 금액이에요.",
      "완료 기준: 2026-08-20까지 잔금 700만원을 보내면 끝나요.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility: "bride_private",
    };
    providerAfterPreGeneration(providerResult({ fullText: providerText }));

    const response = await POST(request({ visibility: "bride_private" }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      amora_first_use_action_promotion_v1: {
        version: 1,
        journeyRevision: 0,
        privacyEpoch: 7,
        rosterFingerprint: "a".repeat(32),
        criterionDecisionId: null,
        canonicalActionInput: {
          action: "계약·결제 상태 확인하기",
          reason: "저장된 준비 기록만으로 계약·결제 상태를 확정할 수 없어 먼저 확인이 필요해요.",
          completionCriterion: "계약서와 결제 내역에서 금액·상태·마감일을 확인해 둘이 볼 기록에 적으면 끝나요.",
        },
        sourceContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        actionDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
        sharedContentDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    });
    const metadata = JSON.stringify(mocks.atomicResponses[0]?.metadata);
    expect(metadata).not.toContain("신라호텔");
    expect(metadata).not.toContain("300만원");
    expect(metadata).not.toContain("700만원");
    expect(metadata).not.toContain("sourceMessageId");
  });

  it.each([
    {
      label: "ordinary private prose",
      visibility: "bride_private" as const,
      providerText: "지금 준비 상태를 차근차근 같이 살펴볼게요.",
    },
    {
      label: "an incomplete private action",
      visibility: "bride_private" as const,
      providerText: "지금 할 한 가지: 시기 후보 적기\n이유: 다음 준비의 기준이 필요해요.",
    },
    {
      label: "a shared action-shaped response",
      visibility: "shared" as const,
      providerText: "지금 할 한 가지: 시기 후보 적기\n이유: 다음 준비의 기준이 필요해요.\n완료 기준: 후보 두 개를 적으면 끝나요.",
    },
  ])("does not attach a private first-use seal to $label", async ({
    visibility,
    providerText,
  }) => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      visibility,
    };
    providerAfterPreGeneration(providerResult({ fullText: providerText }));

    const response = await POST(request({ visibility }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_action_promotion_v1",
    );
  });

  it("binds exact saved wedding progress to the first-use card metadata", async () => {
    mocks.journeyStateRevision = 12;
    mocks.journeyRow = {
      wedding_date: "2099-05-22",
      total_budget: 30_000_000,
      venue: "정원홀",
      progress: {
        venue: {
          checklist: [
            { id: "venue_01", label: "원하는 결혼식장 형태 정하기", done: true },
            { id: "venue_02", label: "비교할 장소 후보 정리", done: false },
          ],
        },
        __events: [
          { date: "2099-01-20", title: "부모님 첫 만남" },
          { date: "2099-02-01", title: "웨딩 사진 촬영" },
        ],
      },
    };
    providerAfterPreGeneration(providerResult({
      fullText: "저장된 준비 상태에서 다음 한 가지를 같이 정해볼게요.",
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W0_wedding_core",
      amora_wedding_context_revision: 12,
      amora_first_use_grounding: {
        version: 1,
        sourceRevision: 12,
        confirmed: [
          { key: "wedding_date", label: "결혼식 날짜: 2099-05-22" },
          { key: "next_schedule", label: "다음 일정: 2099-01-20 · 부모님 첫 만남" },
          {
            key: "current_progress",
            label: "저장한 체크리스트: 1/2 완료 · 남아 있는 항목: 비교할 장소 후보 정리",
          },
        ],
        unknowns: [],
      },
    });
  });

  it("binds the exact two-person criterion decision to the personalized action metadata", async () => {
    const criterionDecisionId = "44444444-4444-4444-8444-444444444444";
    const criterionValue = "우리 둘이 감당할 수 있는 범위 먼저 보기";
    mocks.decisionRows.push({
      id: criterionDecisionId,
      couple_id: COUPLE_ID,
      category: "preference",
      decision_type: "decided",
      title: "우리 기준",
      chosen_value: { value: criterionValue },
      reasoning: null,
      confidence: 1,
      stage_tag: null,
      source: "manual",
      visibility: "shared",
      source_actor_role: null,
      created_at: "2026-08-14T10:00:00.000Z",
      memory_key: null,
      superseded_at: null,
      metadata: {
        criterion_contract: "amora_couple_core_criterion_v1",
        criterion_version: 1,
        bride_user_id: "00000000-0000-4000-8000-000000000001",
        groom_user_id: "00000000-0000-4000-8000-000000000002",
        acceptance_count: 2,
        explicit: true,
      },
    });
    providerAfterPreGeneration(providerResult({
      fullText: "우리 기준과 준비 상태를 함께 보고 다음 한 가지를 정리할게요.",
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).toContain(criterionValue);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      amora_wedding_context_revision: 0,
      amora_couple_criterion_decision_id: criterionDecisionId,
    });
  });

  it("does not claim a personalized planning snapshot without a canonical journey revision", async () => {
    mocks.journeyStateRevision = null;
    providerAfterPreGeneration(providerResult({
      fullText: "확인 가능한 준비 기록부터 다시 불러올게요.",
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_wedding_context_revision",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_grounding",
    );
  });

  it("persists a false enqueue marker when current memory consent is disabled", async () => {
    mocks.memoryEnablement.shared = false;
    mocks.auxiliaryMemoryRuntimeEnabled = true;
    providerAfterPreGeneration(providerResult({
      fullText: "결혼 예산을 함께 정리해볼게요.",
    }));

    const response = await POST(request());
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W0_wedding_core",
      memory_eligible: true,
      memory_enqueue_requested: false,
    });
  });

  it("replays an exact committed D+1 answer before live schedule resolution", async () => {
    setBoundSanggyeonryeDAfterPrivateRow();
    mocks.findPersisted.mockResolvedValue({
      ...persisted("이미 안전하게 저장된 상견례 정리예요."),
      metadata: {
        amora_schedule_care_follow_up_v1: SCHEDULE_CARE_BINDING_METADATA,
      },
      visibility: "bride_private",
      reused: true,
    });
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce({
      ok: false,
      reason: "card_stale",
    });

    const response = await POST(request({ visibility: "bride_private" }));
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(body).toContain("이미 안전하게 저장된 상견례 정리예요.");
    expect(mocks.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.resolveScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("fails a mismatched committed D+1 receipt closed without live resolution", async () => {
    setBoundSanggyeonryeDAfterPrivateRow();
    mocks.findPersisted.mockResolvedValue({
      ...persisted("다른 카드에 저장된 답변"),
      metadata: {
        amora_schedule_care_follow_up_v1: {
          ...SCHEDULE_CARE_BINDING_METADATA,
          card_revision: SCHEDULE_CARE_BINDING_METADATA.card_revision + 1,
        },
      },
      visibility: "bride_private",
      reused: true,
    });

    const response = await POST(request({ visibility: "bride_private" }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "CHAT_REPLAY_INCONSISTENT",
      retryPolicy: "new_message",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.resolveScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(mocks.rateLimit).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("binds a current actor-private sanggyeonrye D+1 turn to canonical context and one private draft", async () => {
    const userText = "상견례에서 합의한 것과 더 이야기할 것을 나눠보고 싶어.";
    setBoundSanggyeonryeDAfterPrivateRow(userText);
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce(
      resolvedSanggyeonryeDAfter(),
    );
    providerAfterPreGeneration(providerResult({
      fullText: [
        "말씀한 내용을 사실과 아직 논의 중인 내용으로 나눠볼게요.",
        "[amora_schedule_care_action_draft]",
        JSON.stringify({
          version: 1,
          title: "상견례에서 나온 항목을 둘이 구분하기",
          reason: "합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요.",
          completionCriterion: "두 목록을 나누고 서로 확인하면 끝나요.",
        }),
        "[/amora_schedule_care_action_draft]",
      ].join(""),
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{ role: "user", content: userText }],
    }));
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(mocks.resolveScheduleCareFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientUserId: "00000000-0000-4000-8000-000000000001",
        coupleId: COUPLE_ID,
        binding: {
          cardId: SCHEDULE_CARE_CARD_ID,
          cardRevision: 3,
          sourceRevision: 0,
        },
      }),
    );
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("AMORA_SCHEDULE_CARE_D_AFTER_V1");
    expect(providerArgs?.systemPrompt).toContain("양가 부모님 첫 만남");
    expect(providerArgs?.systemPrompt).toContain("2026-08-14 18:00");
    expect(providerArgs?.systemPrompt).toContain("실제로 합의된 내용");
    expect(providerArgs?.systemPrompt).toContain("최대 한 개");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: userText },
    ]);
    expect(JSON.stringify(providerArgs?.input)).not.toContain(
      SCHEDULE_CARE_CANONICAL_PROMPT,
    );
    expect(providerArgs?.tools).toEqual([]);
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses[0]?.content).not.toContain(
      "amora_schedule_care_action_draft",
    );
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W0_wedding_core",
      memory_eligible: false,
      memory_enqueue_requested: false,
      amora_schedule_care_follow_up_v1: SCHEDULE_CARE_BINDING_METADATA,
      amora_schedule_care_action_draft_v1: {
        version: 1,
        title: "상견례에서 나온 항목을 둘이 구분하기",
        reason: "합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요.",
        completionCriterion: "두 목록을 나누고 서로 확인하면 끝나요.",
      },
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "pending_amora_action",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_first_use_grounding",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_wedding_context_revision",
    );
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    const persistedMetadata = JSON.stringify(mocks.atomicResponses[0]?.metadata);
    expect(persistedMetadata).not.toContain("event_private_source");
    expect(persistedMetadata).not.toContain("sourceStateDigest");
    expect(persistedMetadata).not.toContain(SCHEDULE_CARE_CANONICAL_PROMPT);
    expect(persistedMetadata).not.toContain(SCHEDULE_CARE_QUESTION);
  });

  it("does not grant D+1 context or draft metadata to an ordinary private turn", async () => {
    const userText = "상견례 이야기를 비공개로 정리하고 싶어.";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      metadata: { client_request_id: REQUEST_ID },
      visibility: "bride_private",
    };
    providerAfterPreGeneration(providerResult({
      fullText: [
        "함께 정리해볼게요.",
        "[amora_schedule_care_action_draft]",
        JSON.stringify({
          version: 1,
          title: "권한 없는 초안",
          reason: "일반 비공개 턴이에요.",
          completionCriterion: "바로 저장하면 끝나요.",
        }),
        "[/amora_schedule_care_action_draft]",
      ].join(""),
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{ role: "user", content: userText }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    expect(mocks.resolveScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt).not.toContain(
      "AMORA_SCHEDULE_CARE_D_AFTER_V1",
    );
    expect(mocks.atomicResponses[0]?.content).toBe("함께 정리해볼게요.");
    expect(mocks.atomicResponses[0]?.content).not.toContain(
      "amora_schedule_care_action_draft",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_schedule_care_follow_up_v1",
    );
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "amora_schedule_care_action_draft_v1",
    );
  });

  it("rejects malformed D+1 metadata before claims, cost, provider, tools, or writes", async () => {
    setBoundSanggyeonryeDAfterPrivateRow();
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: {
        client_request_id: REQUEST_ID,
        amora_ingest_contract_version: 1,
        ai_response_requested: true,
        provider_attachment_state: "none",
        provider_attachment_count: 0,
        amora_schedule_care_follow_up_v1: {
          ...SCHEDULE_CARE_BINDING_METADATA,
          card_revision: 0,
        },
      },
    };

    const response = await POST(request({ visibility: "bride_private" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_INVALID",
      retryPolicy: "new_message",
    });
    expect(mocks.resolveScheduleCareFollowUp).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it.each([
    {
      reason: "scope_changed",
      status: 403,
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_SCOPE_CHANGED",
      retryPolicy: "new_message",
    },
    {
      reason: "journey_stale",
      status: 409,
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_STALE",
      retryPolicy: "regenerate_schedule_care_follow_up",
    },
    {
      reason: "card_stale",
      status: 409,
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_STALE",
      retryPolicy: "regenerate_schedule_care_follow_up",
    },
    {
      reason: "source_unavailable",
      status: 503,
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_UNAVAILABLE",
      retryPolicy: "same_request",
    },
  ])("fails $reason D+1 resolution closed before durable or paid work", async ({
    reason,
    status,
    code,
    retryPolicy,
  }) => {
    setBoundSanggyeonryeDAfterPrivateRow();
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce({ ok: false, reason });

    const response = await POST(request({ visibility: "bride_private" }));

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, retryPolicy });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it.each([
    {
      label: "wrong resolved owner",
      mutate: (value: ReturnType<typeof resolvedSanggyeonryeDAfter>["value"]) => ({
        ...value,
        recipientUserId: "00000000-0000-4000-8000-000000000009",
      }),
    },
    {
      label: "wrong resolved couple",
      mutate: (value: ReturnType<typeof resolvedSanggyeonryeDAfter>["value"]) => ({
        ...value,
        coupleId: "00000000-0000-4000-8000-000000000099",
      }),
    },
    {
      label: "wrong resolved card revision",
      mutate: (value: ReturnType<typeof resolvedSanggyeonryeDAfter>["value"]) => ({
        ...value,
        binding: { ...value.binding, cardRevision: value.binding.cardRevision + 1 },
      }),
    },
  ])("rejects $label before claim, provider, cost, tools, or persistence", async ({
    mutate,
  }) => {
    setBoundSanggyeonryeDAfterPrivateRow();
    const resolution = resolvedSanggyeonryeDAfter();
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce({
      ok: true,
      value: mutate(resolution.value),
    });

    const response = await POST(request({ visibility: "bride_private" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_SCOPE_CHANGED",
      retryPolicy: "new_message",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it.each([
    {
      label: "a changed canonical prompt prefix",
      content: `${SCHEDULE_CARE_CANONICAL_PROMPT.replace("어제", "오늘")} 답변`,
    },
    {
      label: "an empty answer suffix",
      content: `${SCHEDULE_CARE_CANONICAL_PROMPT} `,
    },
  ])("rejects $label before claim, provider, cost, tools, or persistence", async ({
    content,
  }) => {
    setBoundSanggyeonryeDAfterPrivateRow();
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content,
    };
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce(
      resolvedSanggyeonryeDAfter(),
    );

    const response = await POST(request({ visibility: "bride_private" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      code: "AMORA_SCHEDULE_CARE_FOLLOW_UP_STALE",
      retryPolicy: "regenerate_schedule_care_follow_up",
    });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toEqual([]);
  });

  it("turns unsupported D+1 payment and agreement claims into a private verification draft", async () => {
    const userText = "상견례에서 계약금과 예단 얘기가 나왔어.";
    setBoundSanggyeonryeDAfterPrivateRow(userText);
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce(
      resolvedSanggyeonryeDAfter(),
    );
    providerAfterPreGeneration(providerResult({
      fullText: [
        "양가가 예단 500만원과 결제 완료에 모두 합의했고 저장했어요.",
        "[amora_schedule_care_action_draft]",
        JSON.stringify({
          version: 1,
          title: "예단 500만원 결제 완료로 저장하기",
          reason: "양가가 모두 동의한 것으로 확정됐어요.",
          completionCriterion: "합의된 결제 사실로 기록하면 끝나요.",
        }),
        "[/amora_schedule_care_action_draft]",
      ].join(""),
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{
        role: "user",
        content: `${SCHEDULE_CARE_CANONICAL_PROMPT} ${userText}`,
      }],
    }));
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(mocks.atomicResponses[0]?.content).toContain(
      "확정된 합의나 결제 사실로 단정하지 않고",
    );
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      amora_schedule_care_action_draft_v1: {
        version: 1,
        title: "상견례에서 나온 내용을 둘이 확인하기",
      },
    });
    expect(JSON.stringify(mocks.atomicResponses[0])).not.toContain("500만원");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "pending_amora_action",
    );
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("guards unsupported D+1 claims when the provider omits the private draft marker", async () => {
    const userText = "상견례에서 계약금과 예단 얘기가 나왔어.";
    setBoundSanggyeonryeDAfterPrivateRow(userText);
    mocks.resolveScheduleCareFollowUp.mockResolvedValueOnce(
      resolvedSanggyeonryeDAfter(),
    );
    providerAfterPreGeneration(providerResult({
      fullText: "양가 모두 예단 500만원 부담에 합의했어요.",
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{
        role: "user",
        content: `${SCHEDULE_CARE_CANONICAL_PROMPT} ${userText}`,
      }],
    }));
    const body = await response.text();

    expect(response.status, body).toBe(200);
    expect(mocks.atomicResponses[0]?.content).toContain(
      "확정된 합의나 결제 사실로 단정하지 않고",
    );
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      amora_schedule_care_action_draft_v1: {
        version: 1,
        title: "상견례에서 나온 내용을 둘이 확인하기",
      },
    });
    expect(JSON.stringify(mocks.atomicResponses[0])).not.toContain("500만원");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty(
      "pending_amora_action",
    );
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("routes the exact explicit shared bridge to only the existing add-action confirmation path", async () => {
    const userText = [
      "상견례 뒤 정리한 아래 내용을 둘이 볼 다음 할 일로 추가할 실행 카드로 제안해줘.",
      "",
      "다음 할 일: 상견례에서 나온 항목을 둘이 구분하기",
      "이유: 합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요.",
      "완료 기준: 두 목록을 나누고 서로 확인하면 끝나요.",
      "",
      "저장 전에는 확인 카드만 보여줘.",
    ].join("\n");
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: userText,
      metadata: { client_request_id: REQUEST_ID },
      visibility: "shared",
    };
    providerAfterPreGeneration(providerResult({
      fullText:
        '[pending_action]{"tool":"add_amora_action","input":{"title":"provider override","due_date":"2026-08-20"}}[/pending_action]',
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: userText }],
    }));
    const body = await response.text();

    expect(response.status, body).toBe(200);
    const systemPrompt = String(mocks.provider.mock.calls[0]?.[0]?.systemPrompt);
    expect(systemPrompt).toContain("제안 가능한 변경 도구: add_amora_action");
    expect(systemPrompt).toContain(
      "서버가 입력값을 모두 고정한 도구: add_amora_action",
    );
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      pending_amora_action: {
        tool: "add_amora_action",
        input: {
          title: "상견례에서 나온 항목을 둘이 구분하기",
          description:
            "이유: 합의된 내용과 아직 논의 중인 내용을 같은 기준으로 확인해요. 완료 기준: 두 목록을 나누고 서로 확인하면 끝나요.",
          category_key: "general",
          priority: "medium",
          source: "chat",
        },
      },
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.resolveScheduleCareFollowUp).not.toHaveBeenCalled();
  });
});
