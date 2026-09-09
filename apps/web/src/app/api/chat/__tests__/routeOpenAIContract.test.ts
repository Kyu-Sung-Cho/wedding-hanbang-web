import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { AiToolDefinition } from "@/lib/ai/toolDefinition";
import { createChatImageObjectPathV2 } from "@/lib/chat/attachmentStorage";
import { AMORA_MAX_TOTAL_ATTACHMENT_BYTES } from "@/lib/ai/amoraAttachments";
import { AMORA_EMPTY_TERMINAL_FALLBACK_TEXT } from "@/lib/ai/amoraOutputHygiene";
import { OpenAIProviderError } from "@/lib/ai/openai";
import { log as operationalLog } from "@/utils/log";
import {
  matchedSpecialistByKeyword,
  routeSpecialist,
} from "@/lib/ai/stage-router";

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
  const userProfile: {
    couple_id: string;
    role: "bride" | "groom";
    is_admin: boolean;
    name: string;
    preparation_status?: "preparing" | "paused" | "called_off" | null;
  } = {
    couple_id: "10000000-0000-4000-8000-000000000001",
    role: "bride",
    is_admin: false,
    name: "Test customer",
  };
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
  const afterAtomicFinalize = vi.fn();
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
    const result = await call(beforeGeneration, beforeGeneration);
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
      afterAtomicFinalize();
    }
    return result;
  });

  return {
    provider: vi.fn(),
    buildMultimodal: vi.fn((text: string) => text),
    mammothExtract: vi.fn(),
    providerLedger,
    afterAtomicFinalize,
    executeTool: vi.fn(),
    personalReadCount: vi.fn(async () => 2),
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
    chatHistoryGt: vi.fn(),
    summaryEq: vi.fn(),
    summarySelect: vi.fn(),
    summaryGt: vi.fn(),
    // 화면 정리(view reset) 커서. 기본은 커서 없음 = 오늘과 동일한 동작.
    chatViewClearedAt: {
      shared: null as string | null,
      private: null as string | null,
    },
    chatViewClearedAtError: null as { code: string; message: string } | null,
    chatViewClearedAtThrows: false,
    chatViewPrivacyEpoch: 7,
    requestRpc: vi.fn(),
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
    userProfile,
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
  onGt?: (column: string, value: unknown) => void;
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
  // `.gt` 는 화면 정리 커서가 쓴다. 실제 필터링은 하지 않는다 — 라우트가 행마다
  // 다시 거르는지(레인별 판정)를 그대로 보기 위해서다.
  query.gt = vi.fn((column: string, value: unknown) => {
    hooks.onGt?.(column, value);
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
    rpc: mocks.requestRpc,
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
          onGt: mocks.chatHistoryGt,
          filterEqColumns: ["id"],
        });
      }
      if (table === "couple_profile_directory") {
        return queryResult(mocks.directoryRows, {
          onSelectError: () => mocks.directoryError,
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
          onGt: mocks.summaryGt,
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
          ...(mocks.userProfile.preparation_status !== undefined
            ? { preparation_status: mocks.userProfile.preparation_status }
            : {}),
          shared_chat_cleared_at: mocks.chatViewClearedAt.shared,
          private_chat_cleared_at: mocks.chatViewClearedAt.private,
        }, {
          onSelectError: (selection) => {
            if (!selection.includes("shared_chat_cleared_at")) return null;
            if (mocks.chatViewClearedAtThrows) throw new Error("synthetic transport failure");
            return mocks.chatViewClearedAtError;
          },
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

vi.mock("@/lib/ai/openai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/openai")>();
  return {
    chatWithToolsStream: mocks.provider,
    buildToolResultInput: mocks.buildToolResult,
    buildMultimodalContent: mocks.buildMultimodal,
    // 2026-09-03: 실패 원인 문구는 정규화된 category 로 갈린다. 여기서만
    // 가짜를 쓰면 그 갈래가 시험되지 않으므로 실제 구현을 그대로 쓴다.
    normalizeOpenAIProviderError: actual.normalizeOpenAIProviderError,
    OpenAIProviderError: actual.OpenAIProviderError,
  };
});

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

vi.mock("@/lib/ai/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/tools")>();
  // 선택 필드도 실제 schema로 검증한다. date/title 전용 축약본은 합법적인 값을 제거한다.
  Object.assign(mocks.safeTools.find(tool => tool.name === "add_schedule_event")!,
    actual.WEDDING_TOOLS.find(tool => tool.name === "add_schedule_event")!);
  // route는 모듈 초기화 때 제안 도구 목록을 고정하므로 테스트 중 뒤늦게
  // 추가하지 않는다. 실제 배열 스키마/제목만 있는 할 일 계약을 그대로 쓴다.
  (mocks.safeTools as AiToolDefinition[]).push(...actual.BETA_SAFE_TOOLS.filter(tool =>
    tool.name === "apply_budget_plan" || tool.name === "add_amora_action" || tool.name === "get_personal_actions" || tool.name === "prepare_personal_action"));
  return { BETA_SAFE_TOOLS: mocks.safeTools, WEDDING_TOOLS: mocks.safeTools, BUDGET_CATEGORY_KEYS: actual.BUDGET_CATEGORY_KEYS };
});

vi.mock("@/lib/ai/amoraProviderCallLedger", () => ({
  runAmoraProviderCallWithLedger: mocks.providerLedger,
}));

vi.mock("@/lib/ai/amoraTurnJournal", () => ({
  loadAmoraToolRoundJournal: mocks.loadJournal,
  buildAmoraToolRoundCheckpoint: mocks.buildJournalCheckpoint,
}));

vi.mock("@/lib/ai/toolExecutor", () => ({ executeTool: mocks.executeTool }));
vi.mock("@/lib/amora/personalActionConversationRead", () => ({ readPersonalActionConversationCount: mocks.personalReadCount }));
vi.mock("mammoth", () => ({ extractRawText: mocks.mammothExtract }));
vi.mock("@/lib/ai/chatSuggestions", () => ({
  extractSuggestions: mocks.extractSuggestions,
}));
vi.mock("@/lib/ai/dissatisfaction", () => ({ detectDissatisfaction: vi.fn(() => null) }));
vi.mock("@/lib/ai/stage-router", () => ({
  determineStage: vi.fn(() => "planning_0"),
  routeSpecialist: vi.fn(() => "general"),
  // 2026-09-03: 라우팅 mock 이 늘 "general" 이므로 키워드 매칭도 없음으로 둔다.
  matchedSpecialistByKeyword: vi.fn(() => false),
  getSpecialistPromptAddon: vi.fn(() => ""),
}));
vi.mock("@/lib/compliance/ai-log", () => ({
  logAIInteraction: mocks.log,
  // 라우트는 `after()` 로 감싸는 쪽을 부른다. 여기서는 같은 mock 으로 받아
  // 아래 원장 단언들이 그대로 성립하게 한다.
  //
  // **이 별칭 때문에 감싸개 자체는 이 파일에서 한 번도 실행되지 않는다.**
  // 그쪽은 `lib/compliance/__tests__/aiLogAfterResponse.test.ts` 가 실제
  // 구현으로 시험한다 — after() 가 도는 경우와 던지는 경우 둘 다.
  logAIInteractionAfterResponse: mocks.log,
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

import { POST } from "@/app/api/chat/route";
import { createClientFromRequest } from "@/lib/supabase/server";
import { extractAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { getAmoraToolOperationIdentity } from "@/lib/ai/amoraToolIdentity";
import {
  docxRequiredEntries,
  makeDocxZipFixture,
} from "@/lib/ai/__tests__/docxArchiveFixture";
import { createAmoraEvalToken } from "@/lib/ai/amoraEvalAuth";

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

describe("POST /api/chat OpenAI Responses tool-loop contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "false");
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
    mocks.chatViewClearedAt = { shared: null, private: null };
    mocks.chatViewClearedAtError = null;
    mocks.chatViewClearedAtThrows = false;
    mocks.chatViewPrivacyEpoch = 7;
    mocks.requestRpc.mockReset();
    mocks.requestRpc.mockImplementation(async (name: string) => {
      if (name !== "get_own_amora_chat_view_snapshot") throw new Error("Unexpected authenticated RPC");
      if (mocks.chatViewClearedAtThrows) throw new Error("synthetic transport failure");
      return {
        data: { version: 1, privacyEpoch: mocks.chatViewPrivacyEpoch, ...mocks.chatViewClearedAt },
        error: mocks.chatViewClearedAtError,
      };
    });
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
    mocks.afterAtomicFinalize.mockReset();
    mocks.journal.splice(0);
    mocks.profileProjectionError = null;
    mocks.personalizationRow = null;
    mocks.personalizationError = null;
    mocks.journeyError = null;
    mocks.journeyStateRevision = 0;
    mocks.directoryError = null;
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
    mocks.adminRpc.mockResolvedValue({
      data: { authorized: true },
      error: null,
    });
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

  it("still emits fixed crisis guidance when the ordinary limiter and attachment path would reject", async () => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: "자해할 생각이 들어",
    };
    mocks.rateLimit.mockResolvedValue(new Response("limited", { status: 429 }));

    const response = await POST(request({
      preparationSource: "g.unknown",
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

  it("applies the same deterministic safety boundary to authenticated mediation", async () => {
    const sentinel = "MEDIATION_W5_SENTINEL";
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: `남편이 지금 제 목을 조르고 있어요 ${sentinel}`,
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).not.toContain(sentinel);
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
    // 2026-09-03: "저를 밀쳐서 넘어진 적 있어요" 를 여기서 뺐다. **위기 판정이
    // 이제 잡기 때문**이고, 그래서 422(사전점검 필요) 가 아니라 200 에 112·119
    // 안내가 나간다 — 저장·모델 호출이 막히는 것은 똑같고 사용자가 받는 것이
    // 더 낫다. 아래 별도 테스트가 그 경로를 확인한다.
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

  // 위 목록에서 옮겨 온 문장. 위기 판정에 걸리므로 중재에서도 즉시 안내가 나가고
  // 저장·모델 호출은 막힌다 — 422 보다 강한 결과다.
  it("gives immediate safety guidance for a mediation that the crisis classifier now catches", async () => {
    const sentinel = "MEDIATION_PUSH_SENTINEL";
    const response = await POST(request({
      requestKind: "mediation",
      userMessageId: undefined,
      conflictContext: `저를 밀쳐서 넘어진 적 있어요 ${sentinel}`,
    }));

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("경찰 112");
    expect(body).toContain("소방 119");
    expect(body).not.toContain(sentinel);
    // 422 갈래가 지키던 것을 그대로 지킨다.
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(0);
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.providerLedger).not.toHaveBeenCalled();
  });

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
        stage_tag: "planning_0",
        question_scope: "W0_wedding_core",
        tools_used: ["get_wedding_info", "get_wedding_info"],
        tool_rounds: 2,
        exceeded_max_rounds: true,
        correction_count: 0,
      },
    }));
  });

  it.each([
    { text: "강남 상견례 식당 찾아줘", visibility: "shared" },
    { text: '내 개인 할 일 초안을 만들어줘. 제목은 "내가 할 질문 정리"로 해줘. 강남 상견례 식당 찾아줘.', visibility: "bride_private" },
    // 식당과 할 일이 다른 문장에 있어도 상견례 검색을 비웨딩 업무로 오인하지 않는다.
    { text: '강남 상견례 식당 찾아줘. 내 개인 할 일 초안을 만들어줘. 제목은 "식당 상담 질문 준비"로 해줘.', visibility: "bride_private" },
  ])("renders NAVER results without forwarding them and preserves the place lock: $visibility", async ({ text, visibility }) => {
    // 2026-08-22부터 라우트는 **지금 쓸 수 없는 도구를 모델에게 주지 않는다**
    // (`isPlaceSearchConfigured()`). 자격증명이 없으면 장소 검색이 도구 목록에서
    // 빠지므로, NAVER 렌더링 계약을 확인하려면 설정된 상태를 만들어야 한다.
    const savedId = process.env.NAVER_API_HUB_CLIENT_ID;
    const savedSecret = process.env.NAVER_API_HUB_CLIENT_SECRET;
    process.env.NAVER_API_HUB_CLIENT_ID = "test-hub-id";
    process.env.NAVER_API_HUB_CLIENT_SECRET = "test-hub-secret";
    const restoreNaverEnv = () => {
      if (savedId === undefined) delete process.env.NAVER_API_HUB_CLIENT_ID;
      else process.env.NAVER_API_HUB_CLIENT_ID = savedId;
      if (savedSecret === undefined) delete process.env.NAVER_API_HUB_CLIENT_SECRET;
      else process.env.NAVER_API_HUB_CLIENT_SECRET = savedSecret;
    };

    const placeTool = {
      name: "search_nearby_places",
      description: "Search NAVER places",
      input_schema: {},
    };
    mocks.safeTools.push(placeTool);
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: text,
      visibility,
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
      const response = await POST(request({ visibility, messages: [{ role: "user", content: text }] }));
      expect(response.status).toBe(200);
      const body = await response.text();

      expect(mocks.executeTool.mock.calls.map(call => call[0])).toEqual(["search_nearby_places"]);
      expect(body).toContain("외부 식당명");
      expect(mocks.provider).toHaveBeenCalledTimes(3);
      expect(mocks.provider.mock.calls[0]?.[0]?.toolChoice).toEqual({
        type: "function",
        name: "search_nearby_places",
      });
      expect(mocks.provider.mock.calls[1]?.[0]?.tools).toEqual([]);
      expect(mocks.provider.mock.calls[2]?.[0]?.tools).toEqual([]);
      expect(mocks.provider.mock.calls[1]?.[0]?.toolChoice).toBeUndefined();
      expect(mocks.provider.mock.calls[2]?.[0]?.toolChoice).toBeUndefined();
      expect(mocks.chooseModelRole).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        evidenceSummaryContext: expect.objectContaining({ offersPlaceSearch: true }),
      }));
      if (visibility === "bride_private") {
        expect(mocks.provider.mock.calls[0]?.[0]?.tools).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: "prepare_personal_action" }),
        ]));
        expect(mocks.atomicResponses.at(-1)?.metadata).not.toHaveProperty("personal_action_draft");
      }
      expect(mocks.executeTool).toHaveBeenCalledTimes(1);
      expect(mocks.atomicResponses.at(-1)?.metadata).toMatchObject({ question_scope: "W0_wedding_core" });

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
      // 2026-09-03: 저장되는 것은 **우리 값만** 남은 자리표시다(질의·조회 시각·개수).
      // 예전에는 통째로 빠져 새로고침하면 카드가 전부 사라졌다. 네이버 텍스트가
      // 한 글자도 없다는 것은 바로 아래 세 줄이 계속 든다.
      expect(mocks.atomicResponses).toEqual([
        expect.objectContaining({
          metadata: expect.objectContaining({
            toolResults: [
              expect.objectContaining({
                toolName: "search_nearby_places",
                toolInput: {},
                toolOutput: expect.objectContaining({
                  places: [],
                  query: "강남 상견례 식당",
                  displayOnlyPlaceholder: true,
                }),
              }),
            ],
            toolsUsed: expect.arrayContaining(["search_nearby_places"]),
          }),
        }),
      ]);
      const persistedPayload = JSON.stringify(mocks.atomicResponses);
      expect(persistedPayload).not.toContain("외부 식당명");
      expect(persistedPayload).not.toContain("강남 파인다이닝");
      expect(persistedPayload).not.toContain("pstatic.net");
    } finally {
      mocks.executeTool.mockReset();
      mocks.safeTools.pop();
      restoreNaverEnv();
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

  it("keeps public preparation context separate from canonical user text and mutation intent", async () => {
    const preparationSource = "g.cost-saving.section-3";
    const question = "예식 비용 안내의 주의사항을 설명해 주세요.";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0], content: question,
      metadata: { client_request_id: REQUEST_ID, preparation_source: preparationSource },
    };
    providerAfterPreGeneration(providerResult({ fullText: "계약 조건과 포함 내역을 확인하세요.", usage: { input_tokens: 5, output_tokens: 2 } }));
    const response = await POST(request({ preparationSource, messages: [{ role: "user", content: question }] }));
    expect(response.status).toBe(200);
    await response.text();
    const args = mocks.provider.mock.calls[0]?.[0];
    expect(args?.systemPrompt).toContain("[사용자가 선택한 공개 준비 안내 · 참고자료]");
    expect(args?.systemPrompt).toContain("/manners/cost-saving#section-3");
    expect(args?.systemPrompt).toContain("사용자의 사실·예산·결정·지시가 아닙니다");
    expect(JSON.stringify(args?.input)).toContain(question);
    expect(JSON.stringify(args?.input)).not.toContain("[사용자가 선택한 공개 준비 안내");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each([undefined, "c.venue.venue_01"])("rejects changed or omitted preparation references before replay: %s", async (preparationSource) => {
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      metadata: { client_request_id: REQUEST_ID, preparation_source: "c.venue.venue_04" },
    };
    const response = await POST(request({ preparationSource }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "USER_MESSAGE_PREPARATION_BINDING_MISMATCH" });
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
  });

  it("rejects a fabricated preparation reference even when it matches stored metadata", async () => {
    const preparationSource = "g.cost-saving.section-999";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], metadata: { client_request_id: REQUEST_ID, preparation_source: preparationSource } };
    const response = await POST(request({ preparationSource }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PREPARATION_SOURCE" });
    expect(mocks.provider).not.toHaveBeenCalled();
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

  it("does not replay a persisted answer hidden by a subsequent view reset", async () => {
    mocks.chatViewClearedAt.shared = "2026-07-15T01:00:00.000Z";
    mocks.findPersisted.mockResolvedValue(persisted("CLEARED_REPLAY_FIXTURE"));

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "CHAT_REPLAY_CLEARED",
      retryable: false,
      retryPolicy: "new_message",
    });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
  });

  it("blocks persisted-answer replay when its view boundary cannot be read", async () => {
    mocks.chatViewClearedAtError = { code: "57014", message: "synthetic timeout" };
    mocks.findPersisted.mockResolvedValue(persisted("CLEARED_REPLAY_FIXTURE"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CHAT_VIEW_BOUNDARY_UNAVAILABLE" });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
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


  // 2026-09-04 브라우저 실측: #303 이 인사 키에 커플 id 를 붙였는데(위 주석의 의도),
  // 운영·스테이징의 `claim_amora_chat_request` 는 인사 키를 `greeting:<user>` **정확 일치**
  // 로만 받아 모든 새 커플의 첫 인사가 22023 으로 실패했다. 이 테스트는 클레임을 목으로
  // 두어 그 거절을 못 봤다. 커플 구분은 클레임 표의 PK `(couple_id, request_key)` 가 이미
  // 한다 — 키에 커플을 넣지 않는다. DB 규약대로 되돌리고, 그 규약을 못 박는다.
  it.each([
    ["initial_greeting", `greeting:00000000-0000-4000-8000-000000000001`],
    ["chat", `chat:00000000-0000-4000-8000-000000000001`],
  ] as const)("scopes the %s request key to the DB claim contract", async (requestKind, expectedPrefix) => {
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "안녕하세요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request(
      requestKind === "initial_greeting"
        ? { requestKind, userMessageId: undefined }
        : {},
    ));
    expect(response.status).toBe(200);
    await response.text();

    const requestKey = String(mocks.claim.mock.calls[0]?.[0]?.requestKey);
    expect(requestKey.startsWith(expectedPrefix)).toBe(true);
    if (requestKind === "initial_greeting") {
      // 정확히 이 모양이어야 한다 — 커플 id 를 붙이면 DB 가 거부한다.
      expect(requestKey).toBe(expectedPrefix);
      expect(requestKey).not.toContain(COUPLE_ID);
    }
    // 커플은 키가 아니라 별도 파라미터로 클레임에 들어간다.
    expect(mocks.claim.mock.calls[0]?.[0]?.coupleId).toBe(COUPLE_ID);
  });

  it.each(["shared", "bride_private"] as const)(
    "creates a fresh greeting after the %s view reset instead of replaying the old greeting",
    async (visibility) => {
      mocks.chatViewClearedAt[visibility === "shared" ? "shared" : "private"] =
        "2026-07-15T01:00:00.000Z";
      mocks.findPersisted.mockImplementation(async ({ clientRequestId }) =>
        clientRequestId.startsWith("greeting:")
          ? persisted("STALE_GREETING_FIXTURE")
          : null
      );
      providerAfterPreGeneration(providerResult({ fullText: "새 대화를 시작해요." }));

      const response = await POST(request({
        requestKind: "initial_greeting",
        userMessageId: undefined,
        visibility,
      }));
      const payload = await response.text();

      expect(response.status).toBe(200);
      expect(payload).not.toContain("STALE_GREETING_FIXTURE");
      expect(mocks.provider).toHaveBeenCalledTimes(1);
      expect(mocks.claim).toHaveBeenCalledWith(expect.objectContaining({
        requestKey: expect.stringMatching(/^lifecycle:[0-9a-f]{64}$/),
        visibility,
      }));
      expect(mocks.findPersisted).toHaveBeenCalledWith(expect.objectContaining({
        clientRequestId: mocks.claim.mock.calls[0]?.[0]?.requestKey,
      }));
    },
  );

  it("blocks greeting replay before lookup when the reset cursor is unavailable", async () => {
    mocks.chatViewClearedAtError = { code: "57014", message: "synthetic timeout" };
    mocks.findPersisted.mockResolvedValue(persisted("STALE_GREETING_FIXTURE"));

    const response = await POST(request({ requestKind: "initial_greeting", userMessageId: undefined }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "CHAT_VIEW_BOUNDARY_UNAVAILABLE" });
    expect(mocks.findPersisted).not.toHaveBeenCalled();
    expect(mocks.claim).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
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

  it("demotes a W2 mediation request to ordinary no-memory guidance", async () => {
    const providerText = [
      "[mediation]",
      "공감: 요청자가 답답함을 느꼈다고 전했어요.",
      "통역: 계약금 환불 판단을 원한다고 전했어요.",
      "데이터: 법적 권리와 의무는 자격 있는 전문가에게 확인해야 해요.",
      "합의안: 두 분이 계약서를 다시 확인해 보세요.",
      "[/mediation]",
    ].join("\n");
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
    expect(body).toContain("자격 있는 전문가나 공식 기관");
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      question_scope: "W2_high_risk_adjacent",
      memory_eligible: false,
    });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
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

  // 되묻기 고리. 아모라가 한 번 되물으면 그 대화에서 빠져나올 수 없었다 —
  // 짧은 답은 그 문장만 보면 W4라 도구가 0개가 되고, 확인 카드조차 낼 수 없어
  // 아모라가 또 되물었다(2026-08-20 스테이징 실측). 아래는 라우트 전체 배선을
  // 본다. 모듈 단위 테스트는 배선을 증명하지 못한다.
  function seedClarificationExchange({
    currentText,
    priorText,
    assistantText,
    assistantScope = "W0_wedding_core",
    segmentId = "60000000-0000-4000-8000-000000000001",
    visibility = "shared",
  }: {
    currentText: string;
    priorText: string;
    assistantText: string;
    assistantScope?: string;
    segmentId?: string;
    visibility?: string;
  }) {
    const priorId = "30000000-0000-4000-8000-000000000010";
    mocks.activeSegment = { id: segmentId, status: "active" };
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: currentText,
        metadata: null,
        visibility,
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
          question_scope: assistantScope,
          memory_eligible: true,
        },
        visibility,
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
        visibility,
        segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
  }

  const SCHEDULE_CLARIFICATION = {
    priorText: "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
    assistantText:
      "2026년 10월 17일 오후 2시로 넣을까요, 2027년 10월 17일 오후 2시로 넣을까요?",
  } as const;

  it.each([
    "응 넣어줘",
    "네",
    "그렇게 해줘",
    "2026년으로 넣어줘",
  ])(
    "되묻기 직후의 짧은 답이 도구와 확인 카드 자격을 되찾는다: %s",
    async (currentText) => {
      seedClarificationExchange({ ...SCHEDULE_CLARIFICATION, currentText });
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: "2026년 10월 17일 오후 2시로 넣을게요.",
        usage: { input_tokens: 10, output_tokens: 8 },
      }));

      const response = await POST(request({
        messages: [{ role: "user", content: currentText }],
      }));
      await response.text();

      expect(response.status).toBe(200);
      const providerArgs = mocks.provider.mock.calls[0]?.[0];
      expect(providerArgs?.systemPrompt).toContain(
        "question_scope: W0_wedding_core",
      );
      // 고리를 끊는 것은 이 두 줄이다. 도구가 살아 있고, 확인 카드를 낼 수 있다.
      expect(providerArgs?.tools?.length ?? 0).toBeGreaterThan(0);
      expect(providerArgs?.systemPrompt).toContain("[서버 발급 후속 확인 계약]");
      expect(providerArgs?.systemPrompt).toContain("add_schedule_event");
      // 아모라가 던진 질문이 모델에 실제로 전달되어야 답을 해석할 수 있다.
      // 사용자 행에는 화자 접두어가 붙으므로 본문 포함으로 확인한다.
      const providerInput = (providerArgs?.input ?? []) as ReadonlyArray<{
        role: string;
        content: string;
      }>;
      const inputRoles = providerInput.map((turn) => turn.role);
      const inputContents = providerInput.map((turn) => turn.content);
      expect(inputRoles).toEqual(["user", "assistant", "user"]);
      expect(inputContents[0]).toContain(SCHEDULE_CLARIFICATION.priorText);
      expect(inputContents[1]).toBe(SCHEDULE_CLARIFICATION.assistantText);
      expect(inputContents[2]).toContain(currentText);
    },
  );

  it("되묻기에 답하면 확인 카드까지 나온다 — 고리가 실제로 끝난다", async () => {
    // 도구가 돌아온 것만으로는 부족하다. 사용자가 **끝낼 수 있어야** 고친 것이다.
    // 이 턴에서 확인 카드가 나오고, 다음 요청에서 그 카드를 확인하면 서버가
    // 실행한다(그 뒷단은 기존 confirmedActionId 경로 그대로).
    seedClarificationExchange({ ...SCHEDULE_CLARIFICATION, currentText: "응 넣어줘" });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-10-17","title":"드레스 투어"}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응 넣어줘" }],
    }));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("[pending_action]");
    expect(mocks.atomicResponses[0]?.metadata?.pending_amora_action)
      .toMatchObject({
        tool: "add_schedule_event",
        input: { date: "2026-10-17", title: "드레스 투어" },
      });
    // 카드가 나왔을 뿐 아직 아무것도 저장되지 않았다. 확인은 여전히 사용자 몫이다.
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("연속성이 없으면 같은 답변이 카드도 못 만들고 조용히 사라진다(고리 재현)", async () => {
    // 대조군. 직전 턴이 관계 진술(W1)이면 범위가 W0으로 오르지 않아 제안 도구가
    // 비고, 모델이 똑같은 표식을 내도 서버가 버린다. 표식만 지워진 빈 답이
    // 남는 것이 "오류 없이 조용히 아무것도 안 한다"의 정체다.
    seedClarificationExchange({
      priorText: "남편은 무관심하고 나만 다 하고 있어",
      assistantText: "어떤 부분이 가장 힘드신지 알려주세요.",
      currentText: "응 넣어줘",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText:
        '[pending_action]{"tool":"add_schedule_event","input":{"date":"2026-10-17","title":"드레스 투어"}}[/pending_action]',
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응 넣어줘" }],
    }));
    await response.text();

    expect(mocks.atomicResponses[0]?.metadata?.pending_amora_action)
      .toBeUndefined();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each([
    ["payload_rejected", '[pending_action]{"tool":"not_a_tool","input":{"note":"SYNTHETIC_PRIVATE_MODEL_MARKER"}}[/pending_action]'],
    ["open_tag_without_json", "[pending_action]SYNTHETIC_PRIVATE_MODEL_MARKER"],
  ])("keeps private model output out of dropped-card diagnostics: %s", async (shape, marker) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], visibility: "bride_private" };
      providerAfterPreGeneration(providerResult({ fullText: `확인할 내용이 있어요. ${marker}` }));

      const response = await POST(request({ visibility: "bride_private" }));
      expect(response.status).toBe(200);
      await response.text();

      expect(warning).toHaveBeenCalledWith("[chat] pending action tag dropped", expect.objectContaining({
        shapes: [shape],
      }));
      const serializedWarnings = JSON.stringify(warning.mock.calls);
      expect(serializedWarnings).not.toContain("SYNTHETIC_PRIVATE_MODEL_MARKER");
      expect(serializedWarnings).not.toContain(COUPLE_ID);
      const diagnostic = warning.mock.calls.find(([message]) => message === "[chat] pending action tag dropped")?.[1];
      expect(diagnostic).toMatchObject({ requestCorrelationId: expect.stringMatching(/^[0-9a-f]{64}$/) });
      expect(diagnostic).not.toHaveProperty("payloadHeads");
      expect(diagnostic).not.toHaveProperty("tailHead");
    } finally {
      warning.mockRestore();
    }
  });

  it("사이에 낀 안전 턴이 라우트에서도 연속성을 끊는다", async () => {
    // 모듈 테스트만으로는 부족하다. 감사에서 지적된 대로 라우트가 실제로
    // 넘기는 행 모양(전체 창)에서 끊기는지 봐야 한다. 예전에는 신뢰 필터가
    // 폭력 서술을 **지워서** 웨딩 쌍이 답변과 붙어 보였고, 안전 질문에 답한
    // "응"이 W0 + 기억 ON + 도구 전부를 받았다.
    const segmentId = "60000000-0000-4000-8000-000000000001";
    const me = "00000000-0000-4000-8000-000000000001";
    mocks.activeSegment = { id: segmentId, status: "active" };
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
      {
        id: "30000000-0000-4000-8000-000000000001",
        sender_id: me, sender_type: "bride", role: "user",
        content: "응", metadata: null, visibility: "shared",
        segment_id: segmentId, created_at: "2026-07-15T00:04:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000012",
        sender_id: null, sender_type: "ai", role: "assistant",
        content: "지금 안전한 곳에 계신가요?",
        metadata: {
          in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000011",
          question_scope: "W2_high_risk_adjacent",
          memory_eligible: false,
        },
        visibility: "shared", segment_id: segmentId,
        created_at: "2026-07-15T00:03:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000011",
        sender_id: me, sender_type: "bride", role: "user",
        content: "남편이 어제 저를 때렸어요", metadata: null,
        visibility: "shared", segment_id: segmentId,
        created_at: "2026-07-15T00:02:00.000Z",
      },
      {
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null, sender_type: "ai", role: "assistant",
        content: "2026년으로 넣을까요, 2027년으로 넣을까요?",
        metadata: {
          in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000009",
          question_scope: "W0_wedding_core",
          memory_eligible: true,
        },
        visibility: "shared", segment_id: segmentId,
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: "30000000-0000-4000-8000-000000000009",
        sender_id: me, sender_type: "bride", role: "user",
        content: "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
        metadata: null, visibility: "shared", segment_id: segmentId,
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "무엇을 도와드릴까요?",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응" }],
    }));
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).not.toContain(
      "question_scope: W0_wedding_core",
    );
    expect(providerArgs?.tools ?? []).toEqual([]);
    expect(providerArgs?.systemPrompt).not.toContain("[서버 발급 후속 확인 계약]");
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      memory_eligible: false,
    });
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("되살아난 도구가 저장된 결혼 문맥과 함께 온다", async () => {
    // 범위만 W0으로 올리고 저장 문맥 읽기를 건너뛰면, 도구는 살아났는데 예산도
    // 예식장도 비어 있는 상태로 답하게 된다. 되묻기에 답한 사람에게는 그것도
    // 여전히 고리다.
    seedClarificationExchange({ ...SCHEDULE_CLARIFICATION, currentText: "응 넣어줘" });
    mocks.journeyRow = {
      progress: {},
      total_budget: 50_000_000,
      wedding_date: "2026-10-17",
      venue: "테스트그랜드홀",
    };
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "2026년 10월 17일 오후 2시로 넣을게요.",
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "응 넣어줘" }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("테스트그랜드홀");
    expect(providerArgs?.systemPrompt).toContain("\"budget\":50000000");
  });

  it("물음표 없이 끝난 되묻기의 답도 예산 도구를 되찾는다", async () => {
    seedClarificationExchange({
      priorText: "스튜디오 예산 300만원으로 잡아줘",
      assistantText:
        "이 금액이 사진 촬영만인지, 드레스·헤어·메이크업까지 포함한 묶음인지 알려주세요.",
      currentText: "사진 촬영만",
    });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "사진 촬영만 300만원으로 잡을게요.",
      usage: { input_tokens: 10, output_tokens: 8 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: "사진 촬영만" }],
    }));
    await response.text();

    expect(response.status).toBe(200);
    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W0_wedding_core",
    );
    expect(providerArgs?.systemPrompt).toContain("[서버 발급 후속 확인 계약]");
    expect(providerArgs?.systemPrompt).toContain("update_budget");
  });

  it.each([
    {
      label: "직전 사용자 발화가 위기",
      priorText: "결혼 준비고 뭐고 그냥 죽고 싶어",
      assistantText: "지금 많이 힘드신 것 같아요. 어떤 상황인지 알려주세요.",
      assistantScope: "W5_safety_override",
    },
    {
      label: "직전 사용자 발화가 폭력 서술",
      priorText: "예산 얘기하다가 남편이 저를 때렸어요",
      assistantText: "지금 안전한 곳에 계신가요?",
      assistantScope: "W2_high_risk_adjacent",
    },
    {
      // 직전 사용자 발화만 W1이다. 서버 기록은 W0이므로 **직전 발화 재판정만이**
      // 이 턴을 막을 수 있다. 두 관문을 함께 걸어두면 서로를 가려 한쪽이 사라져도
      // 아무 테스트도 빨개지지 않는다.
      label: "직전 사용자 발화가 관계 진술(재판정만이 막는다)",
      priorText: "남편은 무관심하고 나만 다 하고 있어",
      assistantText: "어떤 부분이 가장 힘드신지 알려주세요.",
      assistantScope: "W0_wedding_core",
    },
    {
      // 반대로 직전 사용자 발화는 멀쩡한 W0이고 서버 기록만 W3이다.
      // 이 턴은 **기록된 question_scope 확인만이** 막는다.
      // W1을 고른 이유가 있다. W2·W3·W5는 상위 `selectAmoraTrustedHistoryRows`가
      // 먼저 잘라내므로 이 관문이 사라져도 아무도 모른다. W1은 상위가 통과시키는
      // 값이라, 여기서 막는 것은 되묻기 연속성 자신의 확인뿐이다.
      label: "서버가 W0으로 기록하지 않은 턴(기록 확인만이 막는다)",
      priorText: "10월 17일 오후 2시에 드레스 투어 일정 넣어줘",
      assistantText: "어느 쪽으로 잡아드릴까요?",
      assistantScope: "W1_wedding_adjacent",
    },
  ])(
    "안전·관계 맥락의 되묻기 뒤에는 짧은 확인이 도구를 얻지 못한다: $label",
    async ({ priorText, assistantText, assistantScope }) => {
      seedClarificationExchange({
        priorText,
        assistantText,
        assistantScope,
        currentText: "응 넣어줘",
      });
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: "무엇을 도와드릴까요?",
        usage: { input_tokens: 10, output_tokens: 3 },
      }));

      const response = await POST(request({
        messages: [{ role: "user", content: "응 넣어줘" }],
      }));
      await response.text();

      const providerArgs = mocks.provider.mock.calls[0]?.[0];
      expect(providerArgs?.systemPrompt).not.toContain(
        "question_scope: W0_wedding_core",
      );
      expect(providerArgs?.tools ?? []).toEqual([]);
      expect(providerArgs?.systemPrompt).not.toContain("[서버 발급 후속 확인 계약]");
      expect(mocks.executeTool).not.toHaveBeenCalled();
    },
  );

  it("현재 발화가 새 고위험 질문을 들고 오면 연속성이 무효가 된다", async () => {
    const currentText = "응 넣어줘 그리고 계약금 환불되는지 알려줘";
    seedClarificationExchange({ ...SCHEDULE_CLARIFICATION, currentText });
    mocks.provider.mockResolvedValueOnce(providerResult({
      fullText: "확인된 사실만 정리해 드릴게요.",
      usage: { input_tokens: 10, output_tokens: 3 },
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain(
      "question_scope: W2_high_risk_adjacent",
    );
    expect(providerArgs?.tools ?? []).toEqual([]);
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
    {
      expectedScope: "W2_high_risk_adjacent",
      currentText: "그거 법적으로 판단해줘",
      // 안전 축은 그대로다 — 권한도 이력도 붙지 않는다.
      carriesTrustedHistory: false,
    },
    {
      // 2026-09-03: W4 는 **이력만** 받는다. 권한(도구·저장 문맥·장기 기억)은
      // 여전히 0 이고, 그것이 이 테스트가 지키는 계약이다. 이력을 막던 예전
      // 규칙 때문에 "앞에서 만든 배분표 그대로 반영해줘" 가 자기 대화를 한 줄도
      // 못 본 채 답했다(스테이징 실측).
      expectedScope: "W4_out_of_scope",
      currentText: "그걸로 삼성전자 주식 사줘",
      carriesTrustedHistory: true,
    },
  ])("never launders current $expectedScope authority through an exact prior wedding exchange", async ({
    expectedScope,
    currentText,
    carriesTrustedHistory,
  }) => {
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
    if (carriesTrustedHistory) {
      // 이력은 실린다. **권한은 아니다** — 아래 도구·기억·도구실행 단언이 그것을 든다.
      expect(providerArgs?.input).toEqual([
        { role: "user", content: `[신부] ${priorText}` },
        { role: "assistant", content: "PRIOR_ASSISTANT_MUST_NOT_CROSS_SCOPE" },
        { role: "user", content: `[신부] ${currentText}` },
      ]);
    } else {
      expect(providerArgs?.input).toEqual([
        { role: "user", content: currentText },
      ]);
      expect(JSON.stringify(providerArgs))
        .not.toContain("PRIOR_ASSISTANT_MUST_NOT_CROSS_SCOPE");
    }
    expect(providerArgs?.tools).toEqual([]);
    expect(mocks.requestFrom).not.toHaveBeenCalledWith("conversation_segments");
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  /**
   * 2026-09-03 스테이징 실측 회귀. "앞에서 만든 배분표 그대로 실제 예산에 반영해줘"
   * 가 그 문장에 결혼 낱말이 없어 `W4_out_of_scope` 로 분류되자 provider 가 **그 한
   * 문장만** 받았고, 표가 DB 에 있는데도 아모라가 "대화에 보이지 않아요" 라고 답했다.
   *
   * 현재 발화는 그 문장 대신 **의문형**을 쓴다. 보고된 문장은 되묻기 답 모양
   * (`isAmoraClarificationAnswerShaped`)이라 바로 앞 턴이 결혼 대화면 기존 구제가
   * W0 으로 올려 버려, 정작 이력 결함을 재지 못한다. 표가 몇 턴 앞에 있어 그 구제가
   * 닿지 않을 때가 보고된 실패이고, 의문형이 그 상태를 결정적으로 만든다.
   *
   * 여기서 잠그는 것은 두 가지다 — W4 턴이 **이력은 받고**, **저장 문맥과 도구는 못
   * 받는다**. 둘 중 하나만 있는 초록불은 이 결함을 다시 통과시킨다.
   */
  const W4_HISTORY_FIXTURE_PRIOR_ID = "30000000-0000-4000-8000-000000000010";
  const W4_HISTORY_PRIOR_TEXT = "예식장 대관료랑 식대 배분표를 만들어줘 W4_PRIOR_USER_KEPT";
  const W4_HISTORY_ASSISTANT_TEXT = "배분표를 이렇게 정리했어요. W4_PRIOR_ASSISTANT_KEPT";

  function setTrustedPriorWeddingExchange(currentText: string) {
    setSensitiveStoredProviderContext(currentText);
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
        id: "20000000-0000-4000-8000-000000000010",
        sender_id: null,
        sender_type: "ai",
        role: "assistant",
        content: W4_HISTORY_ASSISTANT_TEXT,
        metadata: {
          in_reply_to_user_message_id: W4_HISTORY_FIXTURE_PRIOR_ID,
          question_scope: "W0_wedding_core",
        },
        visibility: "shared",
        created_at: "2026-07-15T00:01:00.000Z",
      },
      {
        id: W4_HISTORY_FIXTURE_PRIOR_ID,
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: W4_HISTORY_PRIOR_TEXT,
        metadata: null,
        visibility: "shared",
        created_at: "2026-07-15T00:00:00.000Z",
      },
    );
  }

  const STORED_COUPLE_CONTEXT_SENTINELS = [
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
    // 저장된 총예산 44,444,444
    "44444444",
  ];

  it("carries the trusted history into a W4 turn while stored couple context and tools stay closed", async () => {
    const currentText = "앞에서 만든 배분표에 있던 금액 그대로 가도 될까?";
    setTrustedPriorWeddingExchange(currentText);
    providerAfterPreGeneration(providerResult({
      fullText: "앞에서 정리한 배분표를 다시 짚어볼게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt).toContain("question_scope: W4_out_of_scope");
    // 이력은 실린다.
    expect(providerArgs?.input).toEqual([
      { role: "user", content: `[신부] ${W4_HISTORY_PRIOR_TEXT}` },
      { role: "assistant", content: W4_HISTORY_ASSISTANT_TEXT },
      { role: "user", content: `[신부] ${currentText}` },
    ]);
    // 저장 문맥과 도구는 그대로 닫혀 있다.
    expect(providerArgs?.tools).toEqual([]);
    const envelope = JSON.stringify({
      systemPrompt: providerArgs?.systemPrompt,
      input: providerArgs?.input,
    });
    for (const sentinel of STORED_COUPLE_CONTEXT_SENTINELS) {
      expect(envelope).not.toContain(sentinel);
    }
    expect(mocks.enqueueMemory).not.toHaveBeenCalled();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("keeps a W2 safety turn on the current message even when the same trusted history exists", async () => {
    // 대조군. 같은 이력·같은 커플인데 현재 턴이 안전 축이면 아무것도 붙지 않는다.
    const currentText = "예식장 계약이 법적으로 무효인지 판정해줘";
    setTrustedPriorWeddingExchange(currentText);
    providerAfterPreGeneration(providerResult({
      fullText: "지금 요청에 맞는 안전한 범위에서 답할게요.",
    }));

    const response = await POST(request({
      messages: [{ role: "user", content: currentText }],
    }));
    expect(response.status).toBe(200);
    await response.text();

    const providerArgs = mocks.provider.mock.calls[0]?.[0];
    expect(providerArgs?.systemPrompt)
      .toContain("question_scope: W2_high_risk_adjacent");
    expect(providerArgs?.input).toEqual([
      { role: "user", content: currentText },
    ]);
    const envelope = JSON.stringify({
      systemPrompt: providerArgs?.systemPrompt,
      input: providerArgs?.input,
    });
    expect(envelope).not.toContain("W4_PRIOR_USER_KEPT");
    expect(envelope).not.toContain("W4_PRIOR_ASSISTANT_KEPT");
    expect(providerArgs?.tools).toEqual([]);
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

  it("checks the terminal privacy epoch even for a current-only W4 turn", async () => {
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
    // fence, then the display boundary: every authenticated turn can be reset.
    expect(mocks.getPrivacyEpoch).toHaveBeenCalledTimes(6);
  });

  it.each(["chat", "initial_greeting"])("rejects mixed cursor/epoch snapshots before provider work for %s", async (requestKind) => {
    mocks.chatViewPrivacyEpoch = 6;
    const response = await POST(request({
      requestKind,
      ...(requestKind === "initial_greeting" ? { userMessageId: undefined } : {}),
    }));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ code: "AMORA_PRIVACY_CONTEXT_CHANGED", retryable: true });
    expect(mocks.provider).not.toHaveBeenCalled();
    expect(mocks.reserve).not.toHaveBeenCalled();
    expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "AMORA_PRIVACY_CONTEXT_CHANGED" }));
  });

  it.each(["chat", "initial_greeting"])("withholds %s preview when a view reset wins atomic finalization", async (requestKind) => {
    const marker = "SYNTHETIC_RESET_PRIVATE_DRAFT";
    const text = "아까 말한 내용 다시 정리해줘";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
    mocks.atomicOutcome = "privacy_context_changed";
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      options.onTextDelta?.(marker);
      return providerResult({ fullText: marker });
    });
    const response = await POST(request({
      requestKind, messages: [{ role: "user", content: text }],
      ...(requestKind === "initial_greeting" ? { userMessageId: undefined } : {}),
    }));
    const body = await response.text();
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(body).not.toContain(marker);
    expect(body).not.toContain('"type":"text_delta"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicFinalizations).toEqual([expect.objectContaining({ outcome: "privacy_context_changed" })]);
  });

  it.each(["chat", "initial_greeting"])("withholds %s when reset follows persistence but precedes terminal release", async (requestKind) => {
    const marker = "SYNTHETIC_RESET_AFTER_PERSISTENCE";
    const text = "아까 말한 내용 다시 정리해줘";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
    providerAfterPreGeneration(providerResult({ fullText: marker }));
    mocks.afterAtomicFinalize.mockImplementationOnce(() => {
      mocks.getPrivacyEpoch.mockResolvedValue(8);
    });
    const response = await POST(request({
      requestKind, messages: [{ role: "user", content: text }],
      ...(requestKind === "initial_greeting" ? { userMessageId: undefined } : {}),
    }));
    const body = await response.text();
    expect(body).toContain("AMORA_PRIVACY_CONTEXT_CHANGED");
    expect(body).not.toContain(marker);
    expect(body).not.toContain('"type":"done"');
    expect(mocks.atomicFinalizations).toEqual([expect.objectContaining({ outcome: "persisted" })]);
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
      messages: [{ role: "user", content: userText }],
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
    // 여기서 예전에는 아모라 응답 metadata 에 `confirmed_amora_action_id` 가
    // **있어야 한다**고 단언했다. 정반대였다.
    //
    // 그 키는 **사용자 확인 행의 표식**이고, DB 트리거는 그 키를 가진 행을 확인 행으로
    // 보고 `role <> 'user'` 이면 거부한다(AMORA_SHARED_ACTION_CONFIRMATION_INVALID,
    // 22023). 이 테스트는 DB 를 모킹하므로 트리거가 돌지 않았고, 그래서
    // **운영에서 확정 실행 턴의 응답이 한 번도 커밋되지 못하는 동안 초록불이었다**
    // (2026-08-22 스테이징에서 4/4 재현: 예산은 바뀌는데 아모라는 말이 없다).
    expect(mocks.atomicResponses.length).toBeGreaterThan(0);
    for (const response of mocks.atomicResponses) {
      expect(
        (response as { metadata?: Record<string, unknown> }).metadata ?? {},
      ).not.toHaveProperty("confirmed_amora_action_id");
    }
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

  it.each([
    { tool: "apply_budget_plan", input: { total_budget: 30_000_000, intake_summary: "사용자가 확인한 예식장과 예비비 금액", allocations: [{ category: "venue", budget: 20_000_000 }, { category: "reserve", budget: 10_000_000 }] }, text: "결혼 예산 총 3천만원 중 예식장 2천만원과 예비비 1천만원으로 반영해줘" },
    { tool: "add_amora_action", input: { title: "예식장 상담 질문 준비" }, text: "예식장 상담 질문 준비를 할 일로 추가해줘" },
    { tool: "add_schedule_event", input: { title: "예식장 상담", date: "2026-10-10" }, text: "2026년 10월 10일 예식장 상담 일정을 추가해줘" },
  ])("persists and executes the same $tool proposal only after its explicit approval", async ({ tool, input, text }) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === tool);
    if (!definition) throw new Error("Missing real proposal tool definition");
    const added = !mocks.safeTools.some(candidate => candidate.name === tool);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: `[pending_action]${JSON.stringify({ tool, input })}[/pending_action]`,
        usage: { input_tokens: 10, output_tokens: 3 },
      }));
      const proposalResponse = await POST(request({ messages: [{ role: "user", content: text }] }));
      expect(proposalResponse.status).toBe(200);
      await proposalResponse.text();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      const proposal = mocks.atomicResponses[0];
      expect(proposal?.metadata).toMatchObject({ pending_amora_action: { tool, input } });
      const pending = proposal!.metadata.pending_amora_action as { actionId: string };
      expect(pending.actionId).toMatch(/^[0-9a-f-]{36}$/);
      mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
        { ...mocks.canonicalRows[0], content: "확인했어. 반영해줘", created_at: "2026-07-15T00:01:00.000Z" },
        { id: "20000000-0000-4000-8000-000000000001", sender_id: null, sender_type: "ai", role: "assistant", content: proposal!.content, metadata: proposal!.metadata, visibility: "shared", created_at: "2026-07-15T00:00:30.000Z" },
      );
      mocks.executeTool.mockResolvedValueOnce({ toolName: tool, toolInput: input,
        toolOutput: { success: true, display_text: "합성 서버 영수증: 반영했어요." }, success: true });
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText: "합성 제공자 응답", usage: { input_tokens: 10, output_tokens: 3 } }));
      const confirmed = await POST(request({ messages: [{ role: "user", content: "확인했어. 반영해줘" }], confirmedActionId: pending.actionId }));
      expect(confirmed.status).toBe(200);
      const body = await confirmed.text();
      expect(mocks.executeTool).toHaveBeenCalledExactlyOnceWith(tool, input, expect.objectContaining({ pendingActionId: pending.actionId }));
      expect(mocks.adminRpc).toHaveBeenCalledWith("authorize_amora_shared_action_execution", expect.objectContaining({ p_action_id: pending.actionId, p_couple_id: COUPLE_ID }));
      expect(body).toContain("합성 서버 영수증");
      expect(body).not.toContain("합성 제공자 응답");
    } finally {
      if (added) mocks.safeTools.pop();
    }
  });

  it.each(["반영할까요?", '[pending_action]{"tool":"update_budget","input":{"total_budget":35000000}}[/pending_action]'])("turns the complete original named budget list into an exact approval even when the provider says %s", async (fullText) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "apply_budget_plan")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const text = "항목별 금액을 다시 줄게. 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 150, 예비비 200만 원이야. 이대로 실제 예산에 반영해줘.";
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText }));
      await (await POST(request({ messages: [{ role: "user", content: text }] }))).text();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      const saved = mocks.atomicResponses.at(-1)!;
      expect(saved.metadata.pending_amora_action).toMatchObject({ tool: "apply_budget_plan", input: { total_budget: 35000000, allocations: [
        { category: "custom", label: "결혼식장·식사", budget: 9000000 },
        { category: "honeymoon", budget: 10000000 },
        { category: "custom", label: "사진", budget: 5000000 },
        { category: "custom", label: "드레스·정장", budget: 3000000 },
        { category: "makeup", budget: 2000000 },
        { category: "custom", label: "반지·선물", budget: 2500000 },
        { category: "custom", label: "초대장·꽃·하객선물", budget: 1500000 },
        { category: "reserve", budget: 2000000 },
      ] } });
      expect(saved.metadata.pending_amora_action_impact_preview).toMatchObject({ proposed: { totalBudget: 35000000 } });
      expect(saved.content).toContain("초대장·꽃·하객선물");
      expect(saved.content).not.toContain("반영했어요");
    } finally { if (added) mocks.safeTools.pop(); }
  });

  it.each([
    { fullText: "반영할까요?", totalBudget: 35000000, expectedPlan: true },
    { fullText: '[pending_action]{"tool":"update_budget","input":{"total_budget":35000000}}[/pending_action]', totalBudget: 35000000, expectedPlan: true },
    { fullText: "반영할까요?", totalBudget: 36000000, expectedPlan: false },
  ])("recovers the complete existing budget update only with canonical total $totalBudget and model output $fullText", async ({ fullText, totalBudget, expectedPlan }) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "apply_budget_plan")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const text = "기존 예산의 초대장·꽃·하객선물은 새 항목을 만들지 말고 같은 이름의 금액을 150만 원에서 160만 원으로 바꿔줘. 총액은 3500만원으로 유지하고 예비비만 200만원에서 190만원으로 줄일게. 최종 배분은 결혼식장·식사 900, 신혼여행 1000, 사진 500, 드레스·정장 300, 헤어·메이크업 200, 반지·선물 250, 초대장·꽃·하객선물 160, 예비비 190만 원이야. 이대로 실제 예산에 반영해줘.";
    const allocations = [
      { category: "custom", label: "결혼식장·식사", budget: 9000000 },
      { category: "honeymoon", budget: 10000000 },
      { category: "custom", label: "사진", budget: 5000000 },
      { category: "custom", label: "드레스·정장", budget: 3000000 },
      { category: "makeup", budget: 2000000 },
      { category: "custom", label: "반지·선물", budget: 2500000 },
      { category: "custom", label: "초대장·꽃·하객선물", budget: 1600000 },
      { category: "reserve", budget: 1900000 },
    ];
    mocks.journeyRow.total_budget = totalBudget;
    mocks.journeyStateRevision = 1;
    mocks.journeyRow.progress = Object.fromEntries(allocations.map((row, index) => {
      const key = row.category === "custom" ? `custom_fixture${index}` : row.category;
      return [key, { ...row, category: key, status: "not_started", spent: 0,
        budget: row.label === "초대장·꽃·하객선물" ? 1500000 : row.category === "reserve" ? 2000000 : row.budget }];
    }));
    const before = structuredClone(mocks.journeyRow);
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText }));
      const response = await POST(request({ messages: [{ role: "user", content: text }], weddingContext: { budget: expectedPlan ? 1 : 35000000, progress: {} } }));
      expect(response.status).toBe(200);
      await response.text();
      const saved = mocks.atomicResponses.at(-1)!;
      if (expectedPlan) {
        expect(saved.metadata.pending_amora_action).toMatchObject({ tool: "apply_budget_plan", input: { total_budget: 35000000, allocations } });
        expect(saved.metadata.pending_amora_action_journey_revision).toBe(1);
        expect(saved.metadata.pending_amora_action_impact_preview).toMatchObject({ sourceRevision: 1, current: { totalBudget: 35000000 }, proposed: { totalBudget: 35000000, allocatedBudget: 35000000 } });
      } else {
        expect(saved.metadata.pending_amora_action).toBeUndefined();
        expect(saved.metadata.pending_amora_action_impact_preview).toBeUndefined();
      }
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.journeyRow).toEqual(before);
    } finally { if (added) mocks.safeTools.pop(); }
  });

  it.each([true, false])("uses canonical current journey custom labels, ignoring contradictory client context (existing=%s)", async (existing) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "apply_budget_plan")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const text = "헤어·메이크업 200, 예비비 20만 원이야. 이대로 예산에 반영해줘.";
    const progress = { custom_existing: { label: "헤어·메이크업", category: "custom_existing", budget: 1000000, spent: 700000, payer: "bride", status: "completed" } };
    mocks.journeyRow.progress = existing ? progress : {};
    const before = structuredClone(mocks.journeyRow);
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText: "반영할까요?" }));
      const response = await POST(request({ messages: [{ role: "user", content: text }], weddingContext: { budget: 0, progress: existing ? {} : progress } }));
      expect(response.status).toBe(200);
      await response.text();
      const saved = mocks.atomicResponses.at(-1)!;
      expect(saved.metadata.pending_amora_action).toMatchObject({ tool: "apply_budget_plan", input: { total_budget: 2200000, allocations: [
        existing ? { category: "custom", label: "헤어·메이크업", budget: 2000000 } : { category: "makeup", budget: 2000000 },
        { category: "reserve", budget: 200000 },
      ] } });
      expect(saved.metadata.pending_amora_action_impact_preview).toMatchObject({ proposed: { totalBudget: 2200000 } });
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.journeyRow).toEqual(before);
    } finally { if (added) mocks.safeTools.pop(); }
  });

  it.each([0, 1])("recovers the three explicit current-turn schedules when the provider emits %i markers and confirms each once", async (markerCount) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "add_schedule_event")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const text = "다음 일정 3건을 모두 추가할 수 있게 순서대로 확인 카드를 만들어줘. 2026년 10월 10일 예식장 견적 상담, 2026년 10월 11일 드레스 투어 상담, 2026년 10월 12일 신혼여행 후보 비교. 시간과 메모는 지정하지 않을게. 한 건씩 확인할게.";
    const inputs = [
      { date: "2026-10-10", title: "예식장 견적 상담", ...(markerCount ? { category_key: "venue", schedule_scope: "external_commitment" } : {}) },
      { date: "2026-10-11", title: "드레스 투어 상담" },
      { date: "2026-10-12", title: "신혼여행 후보 비교" },
    ];
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText: markerCount
        ? `[pending_action]${JSON.stringify({ tool: definition.name, input: inputs[0] })}[/pending_action]`
        : "일정 세 건을 확인할까요?" }));
      const initial = await POST(request({ messages: [{ role: "user", content: text }] }));
      expect(initial.status).toBe(200);
      await initial.text();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      let proposal = mocks.atomicResponses.at(-1)!;
      expect(proposal.metadata).toMatchObject({ pending_amora_action: { input: inputs[0] }, pending_amora_action_queue: {
        totalCount: 3, completedCount: 0, remainingActions: inputs.slice(1).map(input => ({ tool: definition.name, input })),
      } });
      const actionIds = new Set<string>();
      for (let index = 0; index < inputs.length; index += 1) {
        const pending = proposal.metadata.pending_amora_action as { actionId: string; input: unknown };
        expect(pending.input).toEqual(inputs[index]);
        expect(actionIds.has(pending.actionId)).toBe(false);
        actionIds.add(pending.actionId);
        mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
          { ...mocks.canonicalRows[0], content: "확인했어. 반영해줘", created_at: "2026-07-15T00:01:00.000Z" },
          { id: "20000000-0000-4000-8000-000000000001", sender_id: null, sender_type: "ai", role: "assistant", content: proposal.content, metadata: proposal.metadata, visibility: "shared", created_at: "2026-07-15T00:00:30.000Z" },
        );
        mocks.executeTool.mockImplementationOnce(async () => {
          mocks.journeyStateRevision = index + 1;
          return { toolName: definition.name, toolInput: inputs[index], toolOutput: { success: true, display_text: `일정 ${index + 1}건 반영했어요.` }, success: true };
        });
        mocks.provider.mockResolvedValueOnce(providerResult({ fullText: "전부 반영했어요." }));
        await (await POST(request({ messages: [{ role: "user", content: "확인했어. 반영해줘" }], confirmedActionId: pending.actionId }))).text();
        expect(mocks.executeTool).toHaveBeenCalledTimes(index + 1);
        expect(mocks.executeTool).toHaveBeenLastCalledWith(definition.name, inputs[index], expect.objectContaining({ pendingActionId: pending.actionId }));
        proposal = mocks.atomicResponses.at(-1)!;
        if (index < 2) {
          expect(proposal.metadata).toMatchObject({ pending_amora_action: { input: inputs[index + 1] }, pending_amora_action_journey_revision: index + 1,
            pending_amora_action_queue: { totalCount: 3, completedCount: index + 1 } });
        } else {
          expect(proposal.metadata.pending_amora_action).toBeUndefined();
          expect(proposal.metadata.completed_amora_action_queue).toMatchObject({ totalCount: 3, completedCount: 3 });
        }
      }
    } finally { if (added) mocks.safeTools.pop(); }
  });

  it.each(["private", "demo", "initial_greeting", "unbound"])("does not recover explicit schedules outside a durable shared chat: %s", async (mode) => {
    const text = "다음 일정 2건을 모두 추가해줘. 2026-10-10 예식장 견적 상담, 2026-10-11 드레스 투어 상담.";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text, visibility: mode === "private" ? "bride_private" : "shared" };
    if (mode === "demo") { mocks.authenticatedUser = null; mocks.signedDemo = true; }
    providerAfterPreGeneration(providerResult({ fullText: "내용을 확인했어요." }));
    const response = await POST(request({
      messages: [{ role: "user", content: text }],
      ...(mode === "private" ? { visibility: "bride_private" } : {}),
      ...(mode === "demo" ? { isDemo: true, coupleId: "demo-couple", userMessageId: undefined } : {}),
      ...(mode === "initial_greeting" ? { requestKind: "initial_greeting", userMessageId: undefined } : {}),
      ...(mode === "unbound" ? { userMessageId: undefined } : {}),
    }));
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toContain('"pending_amora_action"');
    expect(body).not.toContain('"pending_amora_action_queue"');
    expect(mocks.executeTool).not.toHaveBeenCalled();
    for (const saved of mocks.atomicResponses) {
      expect(saved.metadata.pending_amora_action).toBeUndefined();
      expect(saved.metadata.pending_amora_action_queue).toBeUndefined();
    }
  });

  it("does not start a new explicit schedule queue while executing an already confirmed action", async () => {
    const text = "다음 일정 2건을 모두 추가해줘. 2026-10-10 예식장 견적 상담, 2026-10-11 드레스 투어 상담.";
    const actionId = "11111111-1111-4111-8111-111111111111";
    setCanonicalConfirmedBudgetAction(actionId, text);
    providerAfterPreGeneration(providerResult({ fullText: "일정도 확인할까요?" }));
    const response = await POST(request({ messages: [{ role: "user", content: text }], confirmedActionId: actionId }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.executeTool).toHaveBeenCalledTimes(1);
    expect(mocks.executeTool).toHaveBeenCalledWith("update_budget", { total_budget: 30000000 }, expect.anything());
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action).toBeUndefined();
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action_queue).toBeUndefined();
  });

  it("leaves meaningful model time information intact without expanding an unsupported partial schedule proposal", async () => {
    const text = "다음 일정 2건을 모두 추가해줘. 2026-10-10 예식장 견적 상담, 2026-10-11 드레스 투어 상담.";
    const input = { date: "2026-10-10", title: "예식장 견적 상담", time: "14:30", memo: "견적서 지참" };
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
    providerAfterPreGeneration(providerResult({ fullText: `[pending_action]${JSON.stringify({ tool: "add_schedule_event", input })}[/pending_action]` }));
    const response = await POST(request({ messages: [{ role: "user", content: text }] }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action).toMatchObject({ input });
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action_queue).toBeUndefined();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each([{ location: "강남" }, { category_key: "unknown" }])("does not expand a model schedule whose raw information the existing extractor would discard: %j", async (extra) => {
    const text = "다음 일정 2건을 모두 추가해줘. 2026-10-10 예식장 견적 상담, 2026-10-11 드레스 투어 상담.";
    const input = { date: "2026-10-10", title: "예식장 견적 상담", ...extra };
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
    providerAfterPreGeneration(providerResult({ fullText: `[pending_action]${JSON.stringify({ tool: "add_schedule_event", input })}[/pending_action]` }));
    const response = await POST(request({ messages: [{ role: "user", content: text }] }));
    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action).toMatchObject({ tool: "add_schedule_event" });
    expect(mocks.atomicResponses.at(-1)?.metadata.pending_amora_action_queue).toBeUndefined();
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each([3, 5])("retains all %i schedule requests and advances only the explicitly confirmed item", async (count) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "add_schedule_event")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const inputs = Array.from({ length: count }, (_, index) => ({ title: `예식장 ${index + 1} 상담`, date: `2026-10-${10 + index}` }));
    const text = "예식장 상담 일정을 모두 추가해줘";
    try {
      mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: inputs.map(input => `[pending_action]${JSON.stringify({ tool: definition.name, input })}[/pending_action]`).join("\n"),
      }));
      await (await POST(request({ messages: [{ role: "user", content: text }] }))).text();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      let proposal = mocks.atomicResponses.at(-1)!;
      expect(proposal.metadata.pending_amora_action_queue).toMatchObject({ totalCount: count, completedCount: 0, remainingActions: inputs.slice(1).map(input => ({ tool: definition.name, input })) });
      const actionIds = new Set<string>();
      for (let index = 0; index < count; index += 1) {
        const pending = proposal.metadata.pending_amora_action as { actionId: string; input: unknown };
        expect(pending.input).toEqual(inputs[index]);
        expect(actionIds.has(pending.actionId)).toBe(false);
        actionIds.add(pending.actionId);
        mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
          { ...mocks.canonicalRows[0], content: "확인했어. 반영해줘", created_at: "2026-07-15T00:01:00.000Z" },
          { id: "20000000-0000-4000-8000-000000000001", sender_id: null, sender_type: "ai", role: "assistant", content: proposal.content, metadata: proposal.metadata, visibility: "shared", created_at: "2026-07-15T00:00:30.000Z" },
        );
        mocks.executeTool.mockImplementationOnce(async () => {
          mocks.journeyStateRevision = index + 1;
          return { toolName: definition.name, toolInput: inputs[index], toolOutput: { success: true, display_text: `일정 ${index + 1}건 반영했어요.` }, success: true };
        });
        mocks.provider.mockResolvedValueOnce(providerResult({ fullText: "전부 반영했어요." }));
        const response = await POST(request({ messages: [{ role: "user", content: "확인했어. 반영해줘" }], confirmedActionId: pending.actionId }));
        await response.text();
        expect(mocks.executeTool).toHaveBeenCalledTimes(index + 1);
        expect(mocks.executeTool).toHaveBeenLastCalledWith(definition.name, inputs[index], expect.objectContaining({ pendingActionId: pending.actionId }));
        proposal = mocks.atomicResponses.at(-1)!;
        if (index < count - 1) {
          expect(proposal.metadata).toMatchObject({ pending_amora_action: { input: inputs[index + 1] }, pending_amora_action_journey_revision: index + 1,
            pending_amora_action_queue: { totalCount: count, completedCount: index + 1 } });
          expect(proposal.content).not.toContain("전부 반영했어요");
          expect(proposal.content).toContain(inputs[index + 1].title);
        } else {
          expect(proposal.metadata.pending_amora_action).toBeUndefined();
          expect(proposal.metadata.completed_amora_action_queue).toMatchObject({ totalCount: count, completedCount: count });
        }
      }
    } finally {
      if (added) mocks.safeTools.pop();
    }
  });

  it.each(["failed", "uncertain", "in_progress", "invalid_receipt", "unreadable", "invalidqueue"])("keeps a queued confirmation safe when %s", async (scenario) => {
    const actual = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const { extractAmoraPendingAction } = await import("@/lib/ai/amoraPendingAction");
    const { createAmoraActionQueue } = await import("@/lib/ai/amoraActionQueue");
    const definition = actual.WEDDING_TOOLS.find(candidate => candidate.name === "add_schedule_event")!;
    const added = !mocks.safeTools.some(candidate => candidate.name === definition.name);
    if (added) (mocks.safeTools as AiToolDefinition[]).push(definition);
    const inputs = [{ title: "예식장 상담", date: "2026-10-10" }, { title: "드레스 투어", date: "2026-10-11" }];
    const extracted = extractAmoraPendingAction({ text: inputs.map(input => `[pending_action]${JSON.stringify({ tool: definition.name, input })}[/pending_action]`).join("\n"), allowedTools: [definition], now: Date.now(), createActionId: () => "11111111-1111-4111-8111-111111111111" });
    const pending = extracted.pendingAction!;
    const queue = createAmoraActionQueue(pending, extracted.remainingActions)!;
    try {
      mocks.canonicalRows.splice(0, mocks.canonicalRows.length,
        { ...mocks.canonicalRows[0], content: "확인했어. 반영해줘", created_at: "2026-07-15T00:01:00.000Z" },
        { id: "20000000-0000-4000-8000-000000000001", sender_id: null, sender_type: "ai", role: "assistant", content: extracted.cleanText, metadata: { pending_amora_action: pending, pending_amora_action_journey_revision: 0, pending_amora_action_queue: scenario === "invalidqueue" ? { ...queue, currentActionId: "different" } : queue }, visibility: "shared", created_at: "2026-07-15T00:00:30.000Z" },
      );
      mocks.executeTool.mockImplementationOnce(async () => {
        if (scenario === "unreadable") mocks.journeyError = { code: "503", message: "unavailable" };
        const success = scenario === "unreadable";
        const errors: Record<string, string> = { failed: "SCHEDULE_DATE_INVALID", uncertain: "TOOL_EXECUTION_UNCERTAIN", in_progress: "TOOL_EXECUTION_IN_PROGRESS", invalid_receipt: "TOOL_LEDGER_RESULT_INVALID" };
        return { toolName: definition.name, toolInput: inputs[0], toolOutput: { success, error: errors[scenario], requires_state_review: scenario === "uncertain", display_text: success ? "예식장 상담을 반영했어요." : "현재 처리 상태를 확인해 주세요." }, success };
      });
      mocks.provider.mockResolvedValueOnce(providerResult({ fullText: "전부 반영했어요." }));
      const response = await POST(request({ messages: [{ role: "user", content: "확인했어. 반영해줘" }], confirmedActionId: pending.actionId }));
      if (scenario === "invalidqueue") {
        expect(response.status).toBe(409);
        expect(await response.json()).toMatchObject({ code: "AMORA_PENDING_ACTION_QUEUE_INVALID" });
        expect(mocks.executeTool).not.toHaveBeenCalled();
      } else {
        await response.text();
        expect(mocks.executeTool).toHaveBeenCalledTimes(1);
        const saved = mocks.atomicResponses.at(-1)!;
        expect(saved.content).not.toContain("전부 반영했어요");
        if (scenario !== "unreadable") {
          expect(saved.metadata.pending_amora_action).toBeUndefined();
          expect(saved.metadata.deferred_amora_action_queue).toMatchObject({ completedCount: 0, remainingActions: inputs.map(input => ({ tool: definition.name, input })) });
          expect(saved.content).toContain("처리 결과를 먼저 확인");
          expect(saved.content).not.toContain("반영되지 않아 다시 확인");
        } else {
          expect(saved.metadata.pending_amora_action).toBeUndefined();
          expect(saved.metadata.deferred_amora_action_queue).toMatchObject({ completedCount: 1, remainingActions: [{ tool: definition.name, input: inputs[1] }] });
          expect(saved.content).toContain("다음 확인을 준비할 최신 정보를 읽지 못했어요");
          expect(saved.content).toContain("드레스 투어");
          expect(saved.content).toContain("2026년 10월 11일");
        }
      }
    } finally {
      if (added) mocks.safeTools.pop();
    }
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
      expect.objectContaining({ stageTag: null }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.atomicFinalizations[0]).toMatchObject({
      message: { stageTag: null },
    });
    // 계약 개입 금지(2026-08-18): 첨부가 계약 검토 전문분야를 만들지 않는다.
    expect(mocks.providerLedger).not.toHaveBeenCalledWith(
      expect.objectContaining({ specialistType: "contract_reviewer" }),
      expect.any(Function),
      expect.any(Object),
    );
    expect(mocks.atomicFinalizations[0]).not.toMatchObject({
      message: { specialistType: "contract_reviewer" },
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
    // 견적서를 같이 보는 경로는 유지된다.
    expect(toolNames).toContain("analyze_quote");
    // 계약 개입 금지(2026-08-18): 계약 검토 도구·전문분야는 도달할 수 없다.
    expect(toolNames).not.toContain("analyze_contract_readiness");
    expect(mocks.providerLedger).not.toHaveBeenCalledWith(
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
      const result = await call(async () => undefined, async () => undefined);
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

  it.each([
    ["response_invalid", "empty_response"],
    ["incomplete_max_output", "max_output_tokens"],
    ["rate_limit", "rate_limit_exceeded"],
    ["provider_5xx", "server_error"],
    ["invalid_request", "input_token_limit"],
    ["refusal", "model_refusal"],
    ["auth_config", "openai_not_enabled"],
    ["transport", "stream_error"],
    ["timeout", null],
    ["aborted", null],
  ] as const)("logs only safe provider classification from an actual POST failure: %s/%s", async (category, providerCode) => {
    const secret = "SYNTHETIC_PRIVATE_CUSTOMER_MESSAGE";
    const original = Object.assign(new OpenAIProviderError(secret, {
      category,
      providerCode,
      model: "SYNTHETIC_PRIVATE_MODEL_VALUE",
      requestId: "SYNTHETIC_PRIVATE_REQUEST_ID",
      responseId: "SYNTHETIC_PRIVATE_RESPONSE_ID",
      usage: { input_tokens: 987654, output_tokens: 123456 },
    }), {
      cause: new Error("SYNTHETIC_PRIVATE_CAUSE"),
      privatePayload: { customer: secret },
    });
    original.stack = "SYNTHETIC_PRIVATE_STACK";
    const errorSpy = vi.spyOn(operationalLog, "error").mockImplementation(() => undefined);
    try {
      mocks.provider.mockImplementationOnce(async (options: { beforeGeneration?: () => Promise<void> }) => {
        await options.beforeGeneration?.();
        throw original;
      });
      const response = await POST(request());
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(body).toContain('"type":"text_clear"');
      expect(body).toContain('"type":"error"');
      expect(body).toContain('"retryPolicy":"new_message"');
      expect(body).not.toContain('"type":"done"');
      expect(body).not.toContain("SYNTHETIC_PRIVATE");
      expect(body).not.toContain("provider_code");
      expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({
        failureCode: providerCode === "input_token_limit" ? "AMORA_INPUT_TOO_LARGE" : "CHAT_TURN_FAILED",
      }));
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toHaveLength(0);
      expect(mocks.completeClaim).not.toHaveBeenCalled();
      expect(mocks.reserve).toHaveBeenCalledTimes(1);
      const call = errorSpy.mock.calls.find(([scope]) => scope === "채팅 API 에러:");
      expect(call).toHaveLength(2);
      const captured = call?.[1];
      expect(captured).toBeInstanceOf(Error);
      if (!(captured instanceof Error)) throw new Error("Safe log error was not captured");
      expect(captured).not.toBe(original);
      expect(captured.message).toBe(`[chat] failure source=openai_boundary category=${category} provider_code=${providerCode ?? "unknown"}`);
      expect(Object.getOwnPropertyNames(captured).sort()).toEqual(["message", "stack"]);
      expect(`${captured.message} ${captured.stack}`).not.toContain("SYNTHETIC_PRIVATE");
      expect(captured).not.toHaveProperty("cause");
      expect(captured).not.toHaveProperty("usage");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    "arbitrary_identifier_ABC123",
    "sk-synthetic-private-token",
    "person@example.com",
    "https://example.invalid/private",
    "비공개 가족 예산",
    "empty_response_private_suffix",
    " empty_response",
    "EMPTY_RESPONSE",
  ])("does not log an unknown provider code on POST failure: %s", async (providerCode) => {
    const errorSpy = vi.spyOn(operationalLog, "error").mockImplementation(() => undefined);
    try {
      mocks.provider.mockRejectedValueOnce(new OpenAIProviderError("SYNTHETIC_PRIVATE", { category: "response_invalid", providerCode }));
      const response = await POST(request());
      const body = await response.text();
      expect(body).toContain('"retryPolicy":"same_request"');
      expect(mocks.reserve).not.toHaveBeenCalled();
      const captured = errorSpy.mock.calls.find(([scope]) => scope === "채팅 API 에러:")?.[1];
      expect(captured).toBeInstanceOf(Error);
      if (!(captured instanceof Error)) throw new Error("Safe log error was not captured");
      expect(captured.message).toBe("[chat] failure source=openai_boundary category=response_invalid provider_code=unknown");
      expect(`${captured.message} ${captured.stack}`).not.toContain(providerCode);
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("rejects an unknown runtime provider category in the POST error log", async () => {
    const original = new OpenAIProviderError("SYNTHETIC_PRIVATE", { category: "transport", providerCode: "stream_error" });
    Object.defineProperty(original, "category", { value: "SYNTHETIC_PRIVATE_CATEGORY" });
    const errorSpy = vi.spyOn(operationalLog, "error").mockImplementation(() => undefined);
    try {
      mocks.provider.mockRejectedValueOnce(original);
      await (await POST(request())).text();
      const captured = errorSpy.mock.calls.find(([scope]) => scope === "채팅 API 에러:")?.[1];
      expect(captured).toBeInstanceOf(Error);
      if (!(captured instanceof Error)) throw new Error("Safe log error was not captured");
      expect(captured.message).toBe("[chat] failure source=openai_boundary category=unknown provider_code=stream_error");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each(["category", "providerCode"] as const)("snapshots provider diagnostic fields before checking and logging: %s", async (field) => {
    const original = new OpenAIProviderError("SYNTHETIC_PRIVATE", { category: "response_invalid", providerCode: "empty_response" });
    let reads = 0;
    Object.defineProperty(original, field, {
      get: () => ++reads >= 4 ? "SYNTHETIC_PRIVATE_CHANGED_VALUE" : field === "category" ? "response_invalid" : "empty_response",
    });
    const errorSpy = vi.spyOn(operationalLog, "error").mockImplementation(() => undefined);
    try {
      mocks.provider.mockRejectedValueOnce(original);
      await (await POST(request())).text();
      const captured = errorSpy.mock.calls.find(([scope]) => scope === "채팅 API 에러:")?.[1];
      expect(captured).toBeInstanceOf(Error);
      if (!(captured instanceof Error)) throw new Error("Safe log error was not captured");
      expect(captured.message).toBe("[chat] failure source=openai_boundary category=response_invalid provider_code=empty_response");
      expect(`${captured.message} ${captured.stack}`).not.toContain("SYNTHETIC_PRIVATE");
    } finally {
      errorSpy.mockRestore();
    }
  });

  it.each([
    ["ordinary error", (): unknown => new Error("SYNTHETIC_PRIVATE"), "CHAT_TURN_FAILED"],
    ["syntax error", (): unknown => new SyntaxError("SYNTHETIC_PRIVATE"), "CHAT_TURN_FAILED"],
    ["string", (): unknown => "SYNTHETIC_PRIVATE", "CHAT_TURN_FAILED"],
    ["provider-shaped object", (): unknown => ({ name: "OpenAIProviderError", category: "transport", providerCode: "stream_error", message: "SYNTHETIC_PRIVATE" }), "CHAT_TURN_FAILED"],
    ["privacy guard", (): unknown => new mocks.PrivacyContextError("AMORA_PRIVACY_CONTEXT_CHANGED"), "AMORA_PRIVACY_CONTEXT_CHANGED"],
    ["cost guard", (): unknown => new mocks.CostGuardError({ allowed: false, reason: "global_budget", message: "사용량 확인을 완료하지 못했어요." }), "COST_GUARD_GLOBAL_BUDGET"],
    ["persistence", (): unknown => new mocks.PersistenceError("SYNTHETIC_PRIVATE"), "AI_MESSAGE_PERSISTENCE_FAILED"],
    ["request claim", (): unknown => new mocks.ClaimError("SYNTHETIC_PRIVATE"), "CHAT_REQUEST_CLAIM_FAILED"],
  ] as const)("keeps non-provider POST failures out of provider diagnostics: %s", async (_label, createError, failureCode) => {
    const errorSpy = vi.spyOn(operationalLog, "error").mockImplementation(() => undefined);
    try {
      mocks.provider.mockRejectedValueOnce(createError());
      const body = await (await POST(request())).text();
      const captured = errorSpy.mock.calls.find(([scope]) => scope === "채팅 API 에러:")?.[1];
      expect(captured).toBeInstanceOf(Error);
      if (!(captured instanceof Error)) throw new Error("Safe log error was not captured");
      expect(captured.message).toBe("[chat] failure source=non_provider_or_unknown");
      expect(`${captured.message} ${captured.stack}`).not.toContain("SYNTHETIC_PRIVATE");
      expect(body).toContain('"type":"error"');
      expect(body).toContain('"retryPolicy":"same_request"');
      expect(body).not.toContain('"type":"done"');
      expect(body).not.toContain("SYNTHETIC_PRIVATE");
      expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({ failureCode }));
      if (failureCode === "COST_GUARD_GLOBAL_BUDGET") expect(body).toContain("사용량 확인을 완료하지 못했어요.");
      expect(mocks.reserve).not.toHaveBeenCalled();
      expect(mocks.executeTool).not.toHaveBeenCalled();
      expect(mocks.atomicResponses).toHaveLength(0);
    } finally {
      errorSpy.mockRestore();
    }
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


  // 2026-09-03: 생성이 시작된 뒤 실패하면 재시도 허용 판정이 늘 false 라, 원인이
  // 무엇이든 "같은 식별자로 다시 이어갈 수 없어요" 한 문장만 나갔다. 재시도 규약은
  // 그대로 두고 원인이 시간 초과·중단일 때만 그 사실을 먼저 말한다.
  it.each([
    [
      "a provider timeout",
      () => Object.assign(new Error("[openai] provider request failed"), {
        name: "TimeoutError",
      }),
      "응답 시간이 초과되었습니다. 다시 시도해주세요.",
      "이 요청은 같은 식별자로 다시 이어갈 수 없어요. 새 메시지로 다시 보내주세요.",
    ],
    [
      "a provider transport failure",
      () => new Error("[openai] provider request failed"),
      "이 요청은 같은 식별자로 다시 이어갈 수 없어요. 새 메시지로 다시 보내주세요.",
      "응답 시간이 초과되었습니다. 다시 시도해주세요.",
    ],
  ] as const)(
    "explains %s with its own cause after generation started",
    async (_label, makeError, expectedMessage, unexpectedMessage) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      mocks.provider.mockImplementationOnce(async (options: {
        beforeGeneration?: () => Promise<void>;
      }) => {
        await options.beforeGeneration?.();
        throw makeError();
      });

      const response = await POST(request());
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(body).toContain('"type":"error"');
      // 재시도 허용 판정은 이 수정의 대상이 아니다 — 유료 경계를 넘었으므로 그대로 new_message.
      expect(body).toContain('"retryPolicy":"new_message"');
      expect(body).toContain(expectedMessage);
      expect(body).not.toContain(unexpectedMessage);
      errorSpy.mockRestore();
    },
  );


  // 2026-09-03: 단계 기본 전문분야로 떨어진 턴에서 확인 카드 관문이 살아 있으려면
  // 라우트가 "키워드로 매칭한 것인가"를 정책에 넘겨야 한다. 정책만 시험하면 이
  // 배선이 빠져도 초록불이라, 같은 문장을 두 라우팅으로 태워 결과를 대조한다.
  it.each([
    ["a stage default", false, false],
    ["a keyword match", true, true],
  ] as const)(
    "hands %s to the pending-offer gate",
    async (_label, matchedByKeyword, expectsOffer) => {
      vi.mocked(routeSpecialist).mockReturnValueOnce("budget_optimizer");
      vi.mocked(matchedSpecialistByKeyword).mockReturnValueOnce(matchedByKeyword);
      mocks.canonicalRows[0] = {
        ...mocks.canonicalRows[0],
        content: "드레스 투어 언제 하는 게 좋을까",
      };
      mocks.provider.mockResolvedValueOnce(providerResult({
        fullText: "언제가 좋을지 같이 볼게요.",
        usage: { input_tokens: 10, output_tokens: 3 },
      }));

      const response = await POST(request({
        messages: [{ role: "user", content: "드레스 투어 언제 하는 게 좋을까" }],
      }));
      expect(response.status).toBe(200);
      await response.text();

      const systemPrompt = String(mocks.provider.mock.calls[0]?.[0]?.systemPrompt);
      expect(systemPrompt.includes("[서버 발급 후속 확인 계약]")).toBe(expectsOffer);
    },
  );

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


  // 2026-09-03: 스트림 이전 실패는 클레임을 풀고 부작용 이전이라 같은 requestKey
  // 재시도가 실제로 가능한데, 본문이 그 규약을 안 실어 클라이언트가 "영구 실패"로
  // 읽고 재시도 버튼을 지웠다. 서버 문구("잠시 후 다시 시도")와 화면이 갈렸다.
  it.each([
    [
      "the active conversation segment is unreadable",
      () => {
        vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
        mocks.activeSegment = null;
      },
      "CONVERSATION_SEGMENT_UNAVAILABLE",
    ],
    [
      "canonical wedding context is unavailable",
      () => {
        mocks.journeyError = { code: "PGRST500", message: "database unavailable" };
      },
      "WEDDING_CONTEXT_UNAVAILABLE",
    ],
    [
      "canonical decisions are unavailable",
      () => {
        mocks.decisionsError = { code: "PGRST500", message: "database unavailable" };
      },
      "DECISIONS_CONTEXT_UNAVAILABLE",
    ],
  ] as const)(
    "offers a same-request retry when %s before the stream starts",
    async (_label, arrange, expectedCode) => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
      arrange();

      const response = await POST(request());

      await expect(response.json()).resolves.toMatchObject({
        code: expectedCode,
        retryable: true,
        retryPolicy: "same_request",
      });
      // 재시도를 권하려면 클레임이 실제로 풀려 있어야 한다.
      expect(mocks.failClaim).toHaveBeenCalled();
      expect(mocks.provider).not.toHaveBeenCalled();
      errorSpy.mockRestore();
    },
  );

  // 대조군: 세그먼트 불일치는 일시 장애가 아니라 결정적 일관성 검사라 같은 요청을
  // 다시 보내도 같은 결과다. 위 규약을 여기까지 넓히면 무한 재시도가 되므로
  // 일부러 남겨 둔다(어떻게 안내할지는 파운더 결정 대기).
  it("does not offer a same-request retry for a deterministic segment mismatch", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubEnv("AMORA_CONVERSATION_SEGMENT_READ_ENABLED", "true");
    mocks.activeSegment = { id: "60000000-0000-4000-8000-000000000001" };

    const response = await POST(request());
    const body = await response.json();

    expect(body).toMatchObject({ code: "CONVERSATION_SEGMENT_CONTEXT_UNAVAILABLE" });
    expect(body.retryPolicy).toBeUndefined();
    errorSpy.mockRestore();
  });

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
        maxCostMicrousd: 17_680,
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
    });
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

  // ---------------------------------------------------------------------------
  // 2026-09-03 T1. 화면 정리 누출 · 대화 창 크기 · 답변 위생 · 빈 본문 그물.
  // ---------------------------------------------------------------------------

  /**
   * 신뢰 이력에 실제로 들어가는 한 쌍을 만든다.
   *
   * `selectAmoraTrustedHistoryRows` 는 (사용자 행, 그 행에 답한 서버 작성 assistant
   * 행) 쌍만 통과시킨다. 아무 행이나 심으면 창 크기·커서와 무관하게 어차피
   * 빠지므로 "안 실렸다"가 아무것도 증명하지 못한다.
   *
   * `mocks.canonicalRows` 는 DB와 같은 **최신 우선** 순서다(라우트가 뒤집는다).
   * 그래서 오래된 쌍일수록 배열 뒤에 붙인다.
   */
  function pushTrustedHistoryPair(options: {
    index: number;
    userText: string;
    assistantText: string;
    createdAt: string;
    visibility?: "shared" | "bride_private" | "groom_private";
  }): void {
    const suffix = String(options.index).padStart(4, "0");
    const userId = `30000000-0000-4000-8000-0000000${suffix}`;
    const visibility = options.visibility ?? "shared";
    // 최신 우선 배열이므로 assistant(뒤에 일어난 일)를 먼저 넣는다.
    mocks.canonicalRows.push({
      id: `20000000-0000-4000-8000-0000000${suffix}`,
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: options.assistantText,
      metadata: {
        in_reply_to_user_message_id: userId,
        question_scope: "W0_wedding_core",
        memory_eligible: true,
      },
      visibility,
      created_at: options.createdAt,
    });
    mocks.canonicalRows.push({
      id: userId,
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: options.userText,
      metadata: null,
      visibility,
      created_at: options.createdAt,
    });
  }

  it.each(["e8 private follow-up", "87e direct item scope"] as const)("delivers status evidence protection for %s without rewriting the mock reply", async (scenario) => {
    // e8 후속 요약과 87e 첫 상태 표의 공개 합성 입력이다. 모의 출력은 모델 품질 검사가 아니다.
    const firstUser = "작은 공간에서 정말 가까운 사람들만 만나고, 짧게 인사하고 사진도 남기는 정도가 좋아. 큰 홀 입장·축가·긴 인사는 원하지 않아. 하객 수·예산·부모님 기대는 미정이야. 그런데 ‘짧은 축하 자리’가 또 예식처럼 느껴질까 봐 걱정돼. 파트너에게 어떻게 처음 꺼내면 좋을까? 오늘 결론을 내자고 몰아붙이고 싶진 않아.";
    const firstAssistant = "처음부터 형식을 정하려 하기보다, **내가 원하는 장면과 걱정**을 전해보면 좋아요.\n\n> “나는 큰 예식보다는 가까운 사람들과 짧게 인사하고 사진을 남기는 시간이 더 편하고 좋아 보여. 다만 작은 축하 자리도 결국 예식처럼 느껴질까 봐 걱정돼. 오늘 결론 내리자는 건 아니고, 우리에게 어떤 시간이 좋을지 각자 생각을 나눠보고 싶어.”\n\n마지막에 이렇게 덧붙여도 좋아요.\n\n> “당신이 중요하게 생각하는 장면도 먼저 듣고 싶어.”\n\n지금은 하객 수나 예산을 정하기보다, **서로 원하는 분위기를 확인하는 첫 대화**로만 열면 충분해요.";
    const withHistory = scenario === "e8 private follow-up";
    const currentUser = withHistory
      ? "지금까지 내 입장에서 확정한 것, 아직 가설인 것, 파트너에게 아직 말하지 않은 것을 섞지 말고 표로 요약해줘. 그리고 다음에 나에게 물어볼 자연스러운 질문을 정확히 네 개만 써줘."
      : "결혼 준비 이야기를 정리하고 싶어. 어제 파트너에게 “사진은 꼭 남기고 싶어”라고 직접 말했어. 예산에 대해서는 아직 파트너에게 말 안 했어. 사진 촬영 방식과 예산 금액은 미정이고, 둘이 합의한 내용도 아직 없어. 지금은 내 개인 상담이야. 항목별로 내가 말한 선호, 전달 여부, 합의 여부를 구분해서 표로 정리해줘. 저장하거나 공유하지 마.";
    const mockReply = "| 구분 | 내용 |\n|---|---|\n| 파트너에게 전달 여부 | 미확인 |";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: currentUser,
      visibility: "bride_private",
      created_at: "2026-09-09T03:07:17.088Z",
    };
    if (withHistory) pushTrustedHistoryPair({
      index: 903,
      userText: firstUser,
      assistantText: firstAssistant,
      createdAt: "2026-09-09T03:07:17.087Z",
      visibility: "bride_private",
    });
    const journeyBefore = structuredClone(mocks.journeyRow);
    const revisionBefore = mocks.journeyStateRevision;
    const modelConfig = await import("@/lib/ai/modelConfig");
    const actualModelConfig = await vi.importActual<typeof import("@/lib/ai/modelConfig")>("@/lib/ai/modelConfig");
    const prompts = await import("@/lib/ai/prompts");
    const actualPrompts = await vi.importActual<typeof import("@/lib/ai/prompts")>("@/lib/ai/prompts");
    providerAfterPreGeneration(providerResult({ fullText: mockReply }));

    // 운영의 조회 도구를 생략한 축약 catalog는 실제 역할 선택 실패를 숨긴다.
    const actualTools = await vi.importActual<typeof import("@/lib/ai/tools")>("@/lib/ai/tools");
    const stage = await import("@/lib/ai/stage-router");
    const actualStage = await vi.importActual<typeof import("@/lib/ai/stage-router")>("@/lib/ai/stage-router");
    const originalStage = {
      determine: vi.mocked(stage.determineStage).getMockImplementation()!,
      route: vi.mocked(stage.routeSpecialist).getMockImplementation()!,
      keyword: vi.mocked(stage.matchedSpecialistByKeyword).getMockImplementation()!,
      prompt: vi.mocked(stage.getSpecialistPromptAddon).getMockImplementation()!,
    };
    const originalTools = [...mocks.safeTools];
    (mocks.safeTools as AiToolDefinition[]).splice(0, mocks.safeTools.length, ...actualTools.BETA_SAFE_TOOLS);
    try {
      vi.mocked(stage.determineStage).mockImplementation(actualStage.determineStage);
      vi.mocked(stage.routeSpecialist).mockImplementation(actualStage.routeSpecialist);
      vi.mocked(stage.matchedSpecialistByKeyword).mockImplementation(actualStage.matchedSpecialistByKeyword);
      vi.mocked(stage.getSpecialistPromptAddon).mockImplementation(actualStage.getSpecialistPromptAddon);
      await vi.mocked(modelConfig.chooseAmoraChatModelRole).withImplementation(
      actualModelConfig.chooseAmoraChatModelRole,
      async () => vi.mocked(prompts.getWeddingPlannerSystemPrompt).withImplementation(
        actualPrompts.getWeddingPlannerSystemPrompt,
        async () => {
          const response = await POST(request({
            requestKind: "chat",
            visibility: "bride_private",
            messages: [{ role: "user", content: currentUser }],
          }));
          expect(response.status).toBe(200);
          const body = await response.text();
          expect(mocks.provider).toHaveBeenCalledTimes(1);
          const providerArgs = mocks.provider.mock.calls[0]?.[0];
          expect(providerArgs?.input).toEqual([
            ...(withHistory ? [
              { role: "user", content: `[신부] ${firstUser}` },
              { role: "assistant", content: firstAssistant },
            ] : []),
            { role: "user", content: `[신부] ${currentUser}` },
          ]);
          expect(modelConfig.chooseAmoraChatModelRole).toHaveBeenCalledWith(expect.objectContaining({ userText: currentUser }));
          expect(providerArgs?.modelRole).toBe("primary");
          const toolNames = providerArgs?.tools?.map((tool: { name: string }) => tool.name) ?? [];
          expect(toolNames).toEqual(expect.arrayContaining(["get_wedding_info", "get_budget_summary", "get_schedule_summary", "get_amora_actions"]));
          if (!withHistory) expect([...toolNames].sort()).toEqual([
            "analyze_quote", "get_amora_actions", "get_budget_summary", "get_market_price", "get_schedule_events",
            "get_schedule_summary", "get_wedding_info", "simulate_guest_guarantee",
          ]);
          expect(modelConfig.chooseAmoraChatModelRole).toHaveBeenCalledWith(expect.objectContaining({
            evidenceSummaryContext: {
              requestKind: "chat", durable: true, isDemo: false,
              hasPriorityAction: false, hasPersonalTools: false, hasAttachments: false,
              offersPlaceSearch: false, toolNames,
            },
          }));
          expect(mocks.chatHistoryEq).toHaveBeenCalledWith("visibility", "bride_private");
          expect(mocks.chatHistoryEq).not.toHaveBeenCalledWith("visibility", "shared");
          const systemPrompt: string = providerArgs?.systemPrompt;
          expect(systemPrompt).toContain("[PRIVATE_MODE]");
          expect(systemPrompt).toContain("question_scope: W0_wedding_core");
          expect(systemPrompt.length).toBeLessThanOrEqual(48_000);
          expect(systemPrompt.match(/\[준비 상태의 근거\]/gu)).toHaveLength(1);
          const statusStart = systemPrompt.indexOf("[준비 상태의 근거]");
          const priorityStart = systemPrompt.indexOf("[이번 답변의 대화 우선순위]");
          const attributionStart = systemPrompt.indexOf("[준비 의견의 근거 확인]");
          expect(priorityStart).toBeGreaterThan(-1);
          expect(statusStart).toBeGreaterThan(priorityStart);
          expect(statusStart).toBeLessThan(attributionStart);
          const statusBlock = systemPrompt.slice(statusStart, attributionStart);
          for (const requiredEvidenceRule of [
            "명시한 선호와 거부 조건을 함께 남기고",
            "확정·가설·미정과 상대에게 전달했는지는 따로 구분하세요",
            "미정은 미전달의 증거가 아닙니다",
            "전달 여부나 공동 합의가 확인되지 않으면 미확인으로 쓰세요",
            "전달·미전달은 항목별 직접 진술만 쓰세요",
            "질문·분류 요청·AI가 제안한 문구로 확정하지 말되",
            "질문 안에 포함된 직접 진술은 유지하세요",
            "요약해도 대상·범위는 유지하세요",
          ]) expect(statusBlock).toContain(requiredEvidenceRule);
          const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
          expect(events.some(event => event.type === "error")).toBe(false);
          expect(events.find(event => event.type === "done")?.fullContent).toBe(mockReply);
          expect(mocks.atomicResponses).toHaveLength(1);
          expect(mocks.atomicResponses[0]?.content).toBe(mockReply);
          expect(mocks.atomicFinalizations[0]).toMatchObject({ message: { visibility: "bride_private" } });
          expect(mocks.atomicResponses[0]?.metadata).toMatchObject({ question_scope: "W0_wedding_core", toolResults: [] });
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action_queue");
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("confirmed_amora_action_id");
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("completed_amora_action");
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("personal_action_draft");
          expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("output_hygiene");
          expect(mocks.executeTool).not.toHaveBeenCalled();
          expect(mocks.journeyRow).toEqual(journeyBefore);
          expect(mocks.journeyStateRevision).toBe(revisionBefore);
        },
      ),
      );
    } finally {
      mocks.safeTools.splice(0, mocks.safeTools.length, ...originalTools);
      vi.mocked(stage.determineStage).mockImplementation(originalStage.determine);
      vi.mocked(stage.routeSpecialist).mockImplementation(originalStage.route);
      vi.mocked(stage.matchedSpecialistByKeyword).mockImplementation(originalStage.keyword);
      vi.mocked(stage.getSpecialistPromptAddon).mockImplementation(originalStage.prompt);
    }
  });

  it.each(["legacy", "attachment", "proposal", "mixed-write", "awaiting-card"] as const)("keeps status summaries on the existing route at the %s boundary", async boundary => {
    const baseText = "결혼 준비에서 확정한 것과 미정인 내용을 표로 요약해줘.";
    const text = boundary === "proposal" ? "총예산을 3500만 원으로 저장해줘."
      : boundary === "mixed-write" ? `${baseText} 총예산을 3500만 원으로 저장해줘.` : baseText;
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text };
    if (boundary === "awaiting-card") {
      setCanonicalConfirmedBudgetAction("11111111-1111-4111-8111-111111111111", text);
    }
    const attachment = { mediaType: "image/png", base64: "aGVsbG8=" };
    if (boundary === "attachment") await bindCanonicalProviderAttachments([attachment]);
    providerAfterPreGeneration(providerResult({ fullText: "확정 여부를 먼저 확인할게요." }));
    const modelConfig = await import("@/lib/ai/modelConfig");
    const actualModelConfig = await vi.importActual<typeof import("@/lib/ai/modelConfig")>("@/lib/ai/modelConfig");
    await vi.mocked(modelConfig.chooseAmoraChatModelRole).withImplementation(actualModelConfig.chooseAmoraChatModelRole, async () => {
      const response = await POST(request({
        messages: [{ role: "user", content: text }],
        ...(boundary === "legacy" ? { userMessageId: undefined } : {}),
        ...(boundary === "attachment" ? { attachments: [attachment] } : {}),
      }));
      expect(response.status).toBe(200);
      await response.text();
      expect(mocks.provider).toHaveBeenCalled();
      expect(mocks.provider.mock.calls.every(call => call[0]?.modelRole === "fast")).toBe(true);
      expect(modelConfig.chooseAmoraChatModelRole).toHaveBeenCalledTimes(1);
      expect(modelConfig.chooseAmoraChatModelRole).toHaveBeenCalledWith(expect.objectContaining({
        userText: text,
        evidenceSummaryContext: expect.objectContaining(
          boundary === "legacy" ? { durable: false }
            : boundary === "attachment" ? { hasAttachments: true }
              : boundary === "mixed-write" ? { hasPriorityAction: false }
              : { hasPriorityAction: true },
        ),
      }));
      expect(mocks.executeTool).not.toHaveBeenCalled();
    });
  });

  it.each([
    {
      candidate: "b384",
      firstAssistant: "서울·경기에서 하객 약 180명, **2027년 가을** 예식을 생각 중이고 정확한 날짜와 총예산은 아직 미정이군요. 신혼집을 최우선으로 두고, 웨딩 사진 촬영은 중요하게 보며 **예단과 폐백은 생략하기로 한 것**으로 이해했어요.\n\n신혼집을 제외한 결혼 준비 범위를 먼저 정해볼까요, 아니면 신혼집까지 포함한 전체 예산을 생각하고 계신가요?",
      secondAssistant: "40명 가족식으로 바꾸신 이유를 먼저 여쭤봐도 될까요? 이유를 알아야 기존에 유지할 기준과 다시 확인할 항목을 정확히 나눌 수 있어요.",
    },
    {
      candidate: "5584",
      firstAssistant: "서울·경기에서 하객 약 180명, **2027년 가을** 예식으로 생각 중이군요. 정확한 날짜와 총예산이 아직 미정이라, 지금은 결혼식장 후보를 고르기보다 **신혼집을 제외하고 결혼 준비에 쓸 수 있는 상한**부터 정하는 게 다음 단계예요.",
      secondAssistant: "가족식으로 방향을 바꾸신 이유를 한 가지만 여쭤봐도 될까요? 이유를 알면 예단·폐백 생략과 사진을 중요하게 보는 기준은 유지하면서, 장소와 식사 구성을 다시 맞춰볼 수 있어요.",
    },
  ])("diagnoses the $candidate pivot turn input, real model role, and terminal preservation without generating a reply", async ({ firstAssistant, secondAssistant }) => {
    // 공개 합성 사례의 실제 T1/T2 원문이다. 모의 T3는 생성 품질이 아니라 출력 보존만 검사한다.
    const firstUser = "서울이나 경기에서 180명 정도 일반 웨딩을 생각 중이야. 내년 가을이고 정확한 날짜와 총예산은 미정이야. 신혼집이 최우선이고 사진은 중요해. 예단과 폐백은 두 사람이 생략하기로 했어.";
    const secondUser = "생각이 바뀌었어. 180명 일반웨딩 말고 그냥 40명만 부르는 가족식으로 할래.";
    const currentUser = "비용도 부담되고 준비 과정도 너무 복잡하게 느껴져서 그래. 큰 결혼식이 우리 취향도 아닌 것 같아. 날짜 후보는 9월보다 10월이 더 좋아. 이건 그냥 선호가 바뀐 거야.";
    const validResponse = "비용 부담과 복잡한 준비를 줄이고 취향에 맞추려는 변화로 이해했어요. 신혼집 최우선, 사진 중요, 예단·폐백 생략은 유지하고 2027년 10월은 정확한 날짜가 정해지지 않은 후보로 둘게요. 40명 가족식에 맞춰 식사·장소·사진 구성과 견적은 다시 확인해보세요.";
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: currentUser,
      created_at: "2026-09-09T00:41:13.222Z",
    };
    pushTrustedHistoryPair({
      index: 902,
      userText: secondUser,
      assistantText: secondAssistant,
      createdAt: "2026-09-09T00:40:53.453Z",
    });
    pushTrustedHistoryPair({
      index: 901,
      userText: firstUser,
      assistantText: firstAssistant,
      createdAt: "2026-09-09T00:40:35.094Z",
    });

    const modelConfig = await import("@/lib/ai/modelConfig");
    const actualModelConfig = await vi.importActual<typeof import("@/lib/ai/modelConfig")>("@/lib/ai/modelConfig");
    const prompts = await import("@/lib/ai/prompts");
    const actualPrompts = await vi.importActual<typeof import("@/lib/ai/prompts")>("@/lib/ai/prompts");
    const planning = await import("@/lib/ai/amoraPlanningTurn");
    const planningSpy = vi.spyOn(planning, "getAmoraPlanningTurn");
    providerAfterPreGeneration(providerResult({ fullText: validResponse }));

    try {
      await vi.mocked(modelConfig.chooseAmoraChatModelRole).withImplementation(
        actualModelConfig.chooseAmoraChatModelRole,
        async () => vi.mocked(prompts.getWeddingPlannerSystemPrompt).withImplementation(
          actualPrompts.getWeddingPlannerSystemPrompt,
          async () => {
            const response = await POST(request({
              requestKind: "chat",
              messages: [{ role: "user", content: currentUser }],
            }));
            expect(response.status).toBe(200);
            const body = await response.text();
            const planningInput = planningSpy.mock.calls[0]?.[0];
            const planningResult = planningSpy.mock.results[0]?.value;
            expect(planningSpy).toHaveBeenCalledTimes(1);
            expect(planningInput).toEqual(expect.objectContaining({
              requestKind: "chat", durable: true, scope: "W0_wedding_core",
              allowsStoredProviderContext: true, preparationStatus: "preparing",
              hasPriorityAction: false, hasAttachments: false, currentUserText: currentUser,
            }));
            expect(planningResult).toBe("pivot_reason_followup");
            const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
            expect(mocks.provider).toHaveBeenCalledTimes(1);
            const providerArgs = mocks.provider.mock.calls[0]?.[0];
            const input = providerArgs?.input as Array<{ role: string; content: unknown }>;
            expect(input.map(message => message.role)).toEqual(["user", "assistant", "user", "assistant", "user"]);
            for (const [index, text] of [firstUser, firstAssistant, secondUser, secondAssistant, currentUser].entries()) {
              expect(JSON.stringify(input[index]?.content)).toContain(JSON.stringify(text).slice(1, -1));
            }
            expect(modelConfig.chooseAmoraChatModelRole).toHaveBeenCalledWith(expect.objectContaining({ userText: currentUser }));
            expect(providerArgs?.modelRole).toBe("fast");
            expect(providerArgs?.systemPrompt).toContain("[준비 방향 변경]");
            expect(providerArgs?.systemPrompt).toContain("[이번 턴: 방향 변경 이유에 대한 후속]");
            expect(providerArgs?.systemPrompt.match(/\[준비 방향 변경\]/gu)).toHaveLength(1);
            expect(providerArgs?.systemPrompt.indexOf("[준비 방향 변경]"))
              .toBeGreaterThan(providerArgs?.systemPrompt.indexOf("[준비 의견의 근거 확인]"));
            expect(providerArgs?.systemPrompt.indexOf("[준비 방향 변경]"))
              .toBeLessThan(providerArgs?.systemPrompt.indexOf("[추천 근거 확인]"));
            expect(providerArgs?.systemPrompt).toContain("유지와 재검토를 한 답변에서 함께 정리하세요");
            expect(providerArgs?.systemPrompt).toContain("바꾸지 않은 명시적 우선순위·중요 항목·생략·시기");
            expect(providerArgs?.systemPrompt).toContain("이번에 바꾼 선호·월 후보는 과거보다 우선하며, 후보를 확정으로 바꾸지 마세요");
            expect(providerArgs?.systemPrompt).toContain("규모·장소·식사·최소 인원·견적 중 이번 전환에 영향받는 것을 구분하세요");
            expect(providerArgs?.systemPrompt).toContain("이유를 다시 묻거나 새 취향 질문으로 넘기지 말고");
            expect(providerArgs?.systemPrompt).toContain("이 지침은 읽고 답할 과업이며 실행 권한이 아닙니다");
            expect(providerArgs?.systemPrompt.length).toBeLessThanOrEqual(48_000);
            expect(mocks.atomicResponses).toHaveLength(1);
            expect(mocks.atomicResponses[0]?.content).toBe(validResponse);
            expect(events.find(event => event.type === "done")?.fullContent).toBe(validResponse);
            expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("output_hygiene");
            expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
            expect(mocks.executeTool).not.toHaveBeenCalled();
          },
        ),
      );
    } finally {
      planningSpy.mockRestore();
    }
  });

  it.each([
    "intervening-raw-turn", "wrong-reply-binding", "other-actor-pivot", "private-history",
    "view-reset", "paused", "listening", "new-execution", "prior-execution", "awaiting-card",
  ] as const)("does not select a planning reason follow-up across %s", async boundary => {
    const reasonAnswer = "비용도 부담되고 준비 과정도 너무 복잡하게 느껴져서 그래. 큰 결혼식이 우리 취향도 아닌 것 같아. 날짜 후보는 9월보다 10월이 더 좋아. 이건 그냥 선호가 바뀐 거야.";
    const currentUser = boundary === "listening"
      ? `${reasonAnswer} 지금은 조언하지 말고 그냥 들어줘.`
      : boundary === "new-execution"
        ? `${reasonAnswer} 우리 결혼 총예산을 3천만원으로 변경해줘.`
        : reasonAnswer;
    mocks.canonicalRows[0] = {
      ...mocks.canonicalRows[0],
      content: currentUser,
      created_at: "2026-09-09T00:41:13.222Z",
    };
    pushTrustedHistoryPair({
      index: 902,
      userText: "생각이 바뀌었어. 180명 일반웨딩 말고 그냥 40명만 부르는 가족식으로 할래."
        + (boundary === "prior-execution" ? " 그리고 공유 일정에 가족식 장소 검토를 추가해줘." : ""),
      assistantText: "40명 가족식으로 바꾸신 이유를 먼저 여쭤봐도 될까요? 이유를 알아야 기존에 유지할 기준과 다시 확인할 항목을 정확히 나눌 수 있어요.",
      createdAt: "2026-09-09T00:40:53.453Z",
      visibility: boundary === "private-history" ? "groom_private" : "shared",
    });
    if (boundary === "intervening-raw-turn") {
      // 응답 없는 중간 행은 provider 이력에서 빠져도 실제 직전 대화임을 바꿀 수 없다.
      mocks.canonicalRows.splice(1, 0, {
        id: "30000000-0000-4000-8000-000000009099",
        sender_id: "00000000-0000-4000-8000-000000000001",
        sender_type: "bride",
        role: "user",
        content: "그 얘기는 잠시 멈추고 결혼 사진 촬영 준비물을 이야기할게요.",
        metadata: null,
        visibility: "shared",
        created_at: "2026-09-09T00:41:00.000Z",
      });
    } else if (boundary === "wrong-reply-binding") {
      mocks.canonicalRows[1] = {
        ...mocks.canonicalRows[1],
        metadata: { in_reply_to_user_message_id: "30000000-0000-4000-8000-000000009098", question_scope: "W0_wedding_core" },
      };
    } else if (boundary === "other-actor-pivot") {
      mocks.canonicalRows[2] = {
        ...mocks.canonicalRows[2],
        sender_id: "00000000-0000-4000-8000-000000000002",
        sender_type: "groom",
      };
    } else if (boundary === "view-reset") {
      mocks.chatViewClearedAt = { shared: "2026-09-09T00:41:00.000Z", private: null };
    } else if (boundary === "paused") {
      mocks.userProfile = { ...mocks.userProfile, preparation_status: "paused" };
    } else if (boundary === "awaiting-card") {
      const pendingAction = extractAmoraPendingAction({
        text: '[pending_action]{"tool":"add_schedule_event","input":{"date":"2027-10-01","title":"가족식 장소 검토"}}[/pending_action]',
        allowedTools: mocks.safeTools,
        now: Date.now(),
        createActionId: () => "11111111-1111-4111-8111-111111111111",
      }).pendingAction;
      expect(pendingAction).not.toBeNull();
      mocks.canonicalRows[1] = {
        ...mocks.canonicalRows[1],
        metadata: {
          in_reply_to_user_message_id: mocks.canonicalRows[2].id,
          question_scope: "W0_wedding_core",
          memory_eligible: true,
          pending_amora_action: pendingAction,
        },
      };
    }
    providerAfterPreGeneration(providerResult({ fullText: "지금 말씀해주신 내용을 먼저 확인할게요." }));

    const planning = await import("@/lib/ai/amoraPlanningTurn");
    const planningSpy = vi.spyOn(planning, "getAmoraPlanningTurn");
    try {
      const response = await POST(request({
        requestKind: "chat",
        messages: [{ role: "user", content: currentUser }],
      }));
      expect(response.status).toBe(200);
      await response.text();
      expect(mocks.provider).toHaveBeenCalledTimes(1);
      expect(mocks.provider.mock.calls[0]?.[0]?.systemPrompt)
        .not.toContain("[이번 턴: 방향 변경 이유에 대한 후속]");
      if (boundary === "prior-execution" || boundary === "awaiting-card") {
        expect(planningSpy.mock.calls[0]?.[0]?.hasPriorityAction).toBe(true);
        expect(planningSpy.mock.results[0]?.value).toBeNull();
      }
      if (boundary === "paused") {
        expect(planningSpy.mock.calls[0]?.[0]?.preparationStatus).toBe("paused");
        expect(planningSpy.mock.results[0]?.value).toBeNull();
      }
      expect(mocks.executeTool).not.toHaveBeenCalled();
    } finally {
      planningSpy.mockRestore();
    }
  });

  it("still prompts from a stored exchange when no view-reset cursor exists", async () => {
    pushTrustedHistoryPair({
      index: 900,
      userText: "결혼식 하객은 40명 정도 가족식으로 하려고 해요 BEFORE_VIEW_RESET",
      assistantText: "가족식 규모로 준비를 정리해볼게요.",
      createdAt: "2026-07-14T00:00:00.000Z",
    });
    providerAfterPreGeneration(providerResult({
      fullText: "네, 이어서 정리해볼게요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    // 대조군: 커서가 없으면 그 쌍은 오늘처럼 프롬프트에 실린다.
    expect(mocks.chatHistoryGt).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
      .toContain("BEFORE_VIEW_RESET");
  });

  it("never prompts from rows the shared view-reset cursor already cleared", async () => {
    mocks.chatViewClearedAt = {
      shared: "2026-07-14T12:00:00.000Z",
      private: null,
    };
    pushTrustedHistoryPair({
      index: 900,
      userText: "결혼식 하객은 40명 정도 가족식으로 하려고 해요 BEFORE_VIEW_RESET",
      assistantText: "가족식 규모로 준비를 정리해볼게요.",
      createdAt: "2026-07-14T00:00:00.000Z",
    });
    providerAfterPreGeneration(providerResult({
      fullText: "네, 이어서 정리해볼게요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    // DB에서 먼저 좁히고,
    expect(mocks.chatHistoryGt).toHaveBeenCalledWith(
      "created_at",
      "2026-07-14T12:00:00.000Z",
    );
    // PostgREST 필터가 회귀해도 provider 경계는 넘지 않는다.
    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).not.toContain("BEFORE_VIEW_RESET");
    expect(providerInput).toContain("CANONICAL_DB_USER");
  });

  it("keeps canonical history written microseconds after the view-reset boundary", async () => {
    mocks.chatViewClearedAt = {
      shared: "2026-07-14T12:00:00.123100Z",
      private: null,
    };
    pushTrustedHistoryPair({
      index: 900,
      userText: "결혼식은 가족 중심으로 준비해요 SYNTHETIC_AFTER_MICROSECOND_RESET",
      assistantText: "확인한 조건으로 준비를 이어가요.",
      createdAt: "2026-07-14T12:00:00.123900Z",
    });
    providerAfterPreGeneration(providerResult({ fullText: "준비 조건을 정리해볼게요." }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
      .toContain("SYNTHETIC_AFTER_MICROSECOND_RESET");
  });

  it.each(["query_error", "transport_failure", "malformed_cursor"])(
    "blocks provider context when the view-reset boundary has %s",
    async (failure) => {
      if (failure === "query_error") {
        mocks.chatViewClearedAtError = {
          code: "57014",
          message: "synthetic boundary lookup timeout",
        };
      } else if (failure === "transport_failure") {
        mocks.chatViewClearedAtThrows = true;
      } else {
        mocks.chatViewClearedAt.shared = "invalid synthetic cursor";
      }
      pushTrustedHistoryPair({
        index: 900,
        userText: "결혼 준비에서 이전 조건을 바꾸려고 해요 CLEARED_CONTEXT_FIXTURE",
        assistantText: "이전 조건을 확인했어요.",
        createdAt: "2026-07-14T00:00:00.000Z",
      });
      providerAfterPreGeneration(providerResult({ fullText: "synthetic response" }));

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        code: "CHAT_VIEW_BOUNDARY_UNAVAILABLE",
        retryable: true,
        retryPolicy: "same_request",
      });
      expect(mocks.provider).not.toHaveBeenCalled();
      expect(mocks.chatHistoryLimit).not.toHaveBeenCalledWith(120);
      expect(mocks.failClaim).toHaveBeenCalledWith(expect.objectContaining({
        failureCode: "CHAT_VIEW_BOUNDARY_UNAVAILABLE",
      }));
    },
  );

  it("keeps the private lane when only the shared view-reset cursor moved", async () => {
    // 화면에서도 그렇다 — `chatStore` 의 `isAfterClearedAt` 는 shared 행에만 shared
    // 커서를, 본인 private 행에만 private 커서를 적용한다. 서버도 같아야 한다.
    mocks.chatViewClearedAt = {
      shared: "2026-07-14T12:00:00.000Z",
      private: null,
    };
    const currentText = "개인 방에서 결혼 준비 예산을 이어서 정리해줘";
    mocks.canonicalRows.splice(0, mocks.canonicalRows.length, {
      id: "30000000-0000-4000-8000-000000000001",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: currentText,
      metadata: { client_request_id: REQUEST_ID },
      visibility: "bride_private",
      created_at: "2026-07-15T00:00:00.000Z",
    });
    pushTrustedHistoryPair({
      index: 901,
      userText: "혼자 보는 방에서 결혼 준비 예산을 정리하고 싶어요 PRIVATE_LANE_KEPT",
      assistantText: "개인 방에서 예산을 정리해볼게요.",
      createdAt: "2026-07-14T00:00:00.000Z",
      visibility: "bride_private",
    });
    providerAfterPreGeneration(providerResult({
      fullText: "네, 개인 방에서 이어가요.",
    }));

    const response = await POST(request({
      visibility: "bride_private",
      messages: [{ role: "user", content: currentText }],
    }));
    await response.text();
    expect(response.status).toBe(200);

    expect(JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input))
      .toContain("PRIVATE_LANE_KEPT");
  });

  it("drops memory summaries written before the view-reset cursor", async () => {
    mocks.memoryEnablement.shared = true;
    mocks.chatViewClearedAt = {
      shared: "2026-07-14T12:00:00.000Z",
      private: null,
    };
    mocks.summaryRows.splice(0, mocks.summaryRows.length,
      {
        summary: "CLEARED_SUMMARY 예단·폐백을 정리했다",
        summary_type: "factual",
        visibility: "shared",
        created_at: "2026-07-14T00:00:00.000Z",
        message_count: 10,
        to_message_id: null,
      },
      {
        summary: "KEPT_SUMMARY 새 대화에서 예산을 정리했다",
        summary_type: "factual",
        visibility: "shared",
        created_at: "2026-07-14T23:00:00.000Z",
        message_count: 4,
        to_message_id: null,
      },
    );
    providerAfterPreGeneration(providerResult({
      fullText: "네, 정리해볼게요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.summaryGt).toHaveBeenCalledWith(
      "created_at",
      "2026-07-14T12:00:00.000Z",
    );
    const systemPrompt = String(mocks.provider.mock.calls[0]?.[0]?.systemPrompt);
    expect(systemPrompt).not.toContain("CLEARED_SUMMARY");
    expect(systemPrompt).toContain("KEPT_SUMMARY");
  });

  it("reads a 120-row canonical window so a 22-turn-old table is still in reach", async () => {
    providerAfterPreGeneration(providerResult({
      fullText: "네, 정리해볼게요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    // 40행은 사용자·아모라를 합친 수라 약 20턴이었고, 22턴 전 표가 창 밖이었다.
    expect(mocks.chatHistoryLimit).toHaveBeenCalledWith(120);
  });

  it("adds no W2/W3/W5 row to the prompt when the window widens to 120", async () => {
    // 넓힌 창 안에 안전 판정 대상 행을 섞어 둔다. 창이 넓어져도 행마다 도는
    // 안전 필터가 그대로여서 한 건도 더 들어오면 안 된다.
    for (let index = 0; index < 24; index += 1) {
      pushTrustedHistoryPair({
        index: 800 + index,
        userText: `결혼 준비 예산을 정리하고 싶어요 SAFE_ROW_${index}`,
        assistantText: `예산을 함께 정리해볼게요 ${index}.`,
        createdAt: `2026-07-1${(index % 4) + 1}T0${index % 10}:00:00.000Z`,
      });
    }
    mocks.canonicalRows.push({
      id: "20000000-0000-4000-8000-000000000700",
      sender_id: null,
      sender_type: "ai",
      role: "assistant",
      content: "그 이야기는 함께 살펴볼게요.",
      metadata: {
        in_reply_to_user_message_id: "30000000-0000-4000-8000-000000000700",
        question_scope: "W0_wedding_core",
        memory_eligible: true,
      },
      visibility: "shared",
      created_at: "2026-07-10T00:00:30.000Z",
    });
    mocks.canonicalRows.push({
      id: "30000000-0000-4000-8000-000000000700",
      sender_id: "00000000-0000-4000-8000-000000000001",
      sender_type: "bride",
      role: "user",
      content: "남편이 어제 나를 밀쳐서 넘어졌어 UNSAFE_ROW_SENTINEL",
      metadata: null,
      visibility: "shared",
      created_at: "2026-07-10T00:00:00.000Z",
    });
    providerAfterPreGeneration(providerResult({
      fullText: "네, 정리해볼게요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    const providerInput = JSON.stringify(mocks.provider.mock.calls[0]?.[0]?.input);
    expect(providerInput).toContain("SAFE_ROW_0");
    expect(providerInput).not.toContain("UNSAFE_ROW_SENTINEL");
  });

  it("scrubs a broken foreign-script fragment out of the answer it persists", async () => {
    providerAfterPreGeneration(providerResult({
      // 2026-09-03 2차 감사 Turn 20 실제 답변 형태.
      fullText: "মাস행사 일정만으로는 날짜를 확정하기 어려워요.",
    }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.atomicResponses[0]?.content)
      .toBe("행사 일정만으로는 날짜를 확정하기 어려워요.");
    expect(mocks.atomicResponses[0]?.metadata).toMatchObject({
      output_hygiene: [
        {
          kind: "foreign_run_removed",
          runs: 1,
          removedChars: 3,
          blocks: ["Bengali"],
        },
      ],
    });
  });

  it.each(["MEDIATION_REQUEST", "INITIAL_GREETING"])("removes reserved %s wrappers from canonical and SSE answers without promoting a card", async marker => {
    const clean = "이어서 말해줘\n[예약 전] [A] 기준이에요.\n\n| 항목 | 예산 |\n|---|---|\n| 사진 | 300만 원 |";
    providerAfterPreGeneration(providerResult({
      fullText: `[${marker}]이어서 말해줘[/${marker}]\n[예약 전] [A] 기준이에요.\n\n| 항목 | 예산 |\n|---|---|\n| 사진 | 300만 원 |`,
    }));

    const response = await POST(request({ requestKind: "chat" }));
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toBe(clean);
    expect(events.find(event => event.type === "done")?.fullContent).toBe(clean);
    expect(events.filter(event => event.type === "text_delta").map(event => event.content).join("")).toBe(clean);
    expect(body).not.toContain(`[${marker}]`);
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("leaves a clean Korean answer byte-identical", async () => {
    const clean = "예식장 대관료는 지역마다 달라요 ㅋㅋ 예산은 3,000만 원으로 잡아볼까요?";
    providerAfterPreGeneration(providerResult({ fullText: clean }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    await response.text();

    expect(mocks.atomicResponses[0]?.content).toBe(clean);
    expect(mocks.atomicResponses[0]?.metadata)
      .not.toHaveProperty("output_hygiene");
  });

  it.each(["explicit-demotion", "direct-candidate-state", "confirmed"] as const)("keeps ranked recommendation canonical/SSE consistent with its own candidate status: %s", async mode => {
    const selfCandidate = mode !== "confirmed";
    const prefix = "**추천 1순위는 2안**이에요.";
    const suffix = mode === "direct-candidate-state"
      ? " B의 친척 초대 필요를 반영하면서 A가 원하는 대전 시내의 정식 예식도 유지할 수 있기 때문이에요. 다만 **3,500만 원 안에서 가능한지는 아직 확인되지 않은 후보안**이에요. 장소의 식사 금액, 최소 식사 인원, 대관료와 포함 범위를 같은 조건으로 받아본 뒤 판단해야 해요."
      : selfCandidate
      ? " 접근성 때문이에요. 다만 예산 범위가 확인되지 않아 현재로서는 확정 추천이 아니라 먼저 견적을 받아볼 후보예요."
      : " 제공한 가상 서면 견적에서 2안은 1,000만 원, 1안은 1,050만 원이고 두 안 모두 150명이 가능해요. 상한 1,200만 원 아래에서 2안이 50만 원 적어요. 다만 주류 포함 여부는 추가로 확인하세요.";
    const text = prefix + suffix;
    const expected = selfCandidate ? text.replace("추천 1순위", "우선 검토 후보") : text;
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      options.onTextDelta?.(prefix);
      options.onTextDelta?.(suffix);
      return providerResult({ fullText: text });
    });

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toBe(expected);
    expect(events.find(event => event.type === "done")?.fullContent).toBe(expected);
    expect(events.filter(event => event.type === "text_delta").map(event => event.content).join("")).toBe(expected);
    if (selfCandidate) expect(mocks.atomicResponses[0]?.metadata.output_hygiene).toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
    else expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("output_hygiene");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each(["two-parts", "per-character"] as const)("keeps the observed temporal reclassification canonical/SSE consistent without writes: %s", async split => {
    const text = "두 분의 기준을 한쪽이 포기하는 문제로만 보기는 어려워요.  \nA는 **가족이 오기 편하고 격식을 갖춘 예식**을, B는 **친척 관계를 빠뜨리지 않으면서 총예산을 지키는 것**을 중요하게 보고 있어요.\n\n절충안을 가르는 핵심은 **실제 초대 명단·참석 예상 인원·대전 시내 예식장 견적**입니다.\n\n1. **대전 시내 160명 기준**\n   - 두 분 모두의 기준을 중간에서 반영\n   - 정식 예식과 가족 접근성을 유지\n   - B의 친척 초대 범위는 일부 조정\n   - 3,500만 원 안에 들어오는지는 식대와 최소 식사 인원 확인 필요\n\n2. **대전 시내 180~200명 기준**\n   - B의 친척 초대 기준을 우선 반영\n   - A가 중요하게 본 이동 편의성과 정식 예식은 유지\n   - 식대·장식·사진 촬영 등 다른 항목의 실제 견적을 함께 확인해야 예산 가능 여부 판단 가능\n\n3. **대전 시내 120명 정식 예식 + 별도 친척 인사**\n   - A의 예식 규모와 장소 기준을 유지\n   - B가 걱정하는 친척 관계는 결혼식 초대 대신 별도 식사나 인사 자리로 나눌 수 있음\n   - 별도 자리 비용과 관계상 받아들일 수 있는 방식인지 확인 필요\n\n**현재 추천 1순위는 1안, 대전 시내 160명 기준이에요.** 두 분의 장소·형식 기준을 유지하면서 규모 차이를 줄이는 안이기 때문이에요. 다만 160명은 아직 두 분이 합의한 숫자가 아니므로, 추천이라기보다 먼저 견적을 받아볼 **검토 후보**로 두는 게 정확해요.\n\n다음에는 양가별 초대 명단을 실제로 세어 **“꼭 초대할 분”과 “초대 여부를 상의할 분”**을 나눠보세요.";
    const expected = text.replace("추천 1순위", "우선 검토 후보");
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      const boundary = text.indexOf("다만 160명은");
      expect(boundary).toBeGreaterThan(0);
      const pieces = split === "per-character" ? [...text] : [text.slice(0, boundary), text.slice(boundary)];
      pieces.forEach(piece => options.onTextDelta?.(piece));
      return providerResult({ fullText: text });
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toBe(expected);
    expect(events.find(event => event.type === "done")?.fullContent).toBe(expected);
    expect(events.filter(event => event.type === "text_delta").map(event => event.content).join("")).toBe(expected);
    expect(body).not.toContain("현재 추천 1순위");
    expect(mocks.atomicResponses[0]?.metadata.output_hygiene).toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("personal_action_draft");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each(["before-rank", "per-character"] as const)("aligns the selected option's unverified quote label in canonical and SSE: %s", async split => {
    // acbafb72 합성 3턴의 마지막 정본. 견적 단서는 선택한 안의 앞쪽 목록에 있다.
    const text = "두 의견 모두 중요한 기준이 분명해요. A는 **가족이 오가기 편한 격식 있는 예식**, B는 **친척을 충분히 초대하면서 총예산 3,500만 원을 지키는 것**을 중시하고 있어요. 한쪽이 단순히 양보할 문제가 아니라, 하객 수가 늘면 식사비와 장소 조건이 함께 달라져 세 가지를 묶어 봐야 해요.\n\n**절충안 1 — 대전 시내, 150명 안팎의 정식 예식**\n- A의 이동 편의와 격식을 유지하면서 B의 초대 범위도 일부 반영\n- 150명 기준으로 결혼식장 식대·대관료를 확인\n- 3,500만 원 안에서 가능한지는 실제 견적 확인 필요\n\n**절충안 2 — 대전 시내, 180~200명 규모의 정식 예식**\n- B의 친척 초대 기준을 유지\n- A가 중요하게 본 가족 접근성과 정식 예식도 유지\n- 장소는 대전 시내에서 180~200명을 수용하고, 총예산 3,500만 원에 맞는지 서면 견적 확인\n\n**절충안 3 — 대전 시내 인근, 180명 안팎의 정식 예식**\n- 하객 수는 B의 기준에 가깝게 유지\n- 시내 중심보다 이동 조건을 조금 넓혀 예산 선택지를 확인\n- 가족별 이동 시간과 교통편을 먼저 비교\n\n**추천 1순위는 절충안 1**이에요. 120명과 180~200명의 중간 규모라 두 사람의 조건을 함께 반영하기 쉽고, 대전 시내를 유지해 A의 접근성과 격식을 지킬 수 있기 때문이에요. 다만 3,500만 원이 예식만 포함하는지, 신혼여행·집·가전 등도 포함하는지에 따라 판단이 크게 달라져요. 먼저 **3,500만 원에 어디까지 포함할지** 두 사람이 확인해 주세요.";
    const expected = text.replace("추천 1순위", "우선 검토 후보");
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      const boundary = text.indexOf("**추천 1순위");
      expect(boundary).toBeGreaterThan(0);
      const pieces = split === "per-character" ? [...text] : [text.slice(0, boundary), text.slice(boundary)];
      pieces.forEach(piece => options.onTextDelta?.(piece));
      return providerResult({ fullText: text });
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();
    const events = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0]?.content).toBe(expected);
    expect(events.find(event => event.type === "done")?.fullContent).toBe(expected);
    expect(events.filter(event => event.type === "text_delta").map(event => event.content).join("")).toBe(expected);
    expect(body).not.toContain("추천 1순위");
    expect(mocks.atomicResponses[0]?.metadata.output_hygiene).toContainEqual({ kind: "recommendation_label_aligned", count: 1 });
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("pending_amora_action");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("personal_action_draft");
    expect(mocks.atomicResponses[0]?.metadata).not.toHaveProperty("mediation");
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it("does not flush a ranked preview or invent a successful terminal when generation fails", async () => {
    mocks.provider.mockImplementationOnce(async (options: {
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
      onTextDelta?: (value: string) => void;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      options.onTextDelta?.("추천 1순위는 2안이에요.");
      throw new Error("SYNTHETIC_GENERATION_INTERRUPTED");
    });
    const response = await POST(request());
    const body = await response.text();
    expect(body).not.toContain("추천 1순위");
    expect(body).not.toContain('"type":"done"');
    expect(body).toContain('"type":"error"');
    expect(mocks.atomicResponses).toHaveLength(0);
    expect(mocks.executeTool).not.toHaveBeenCalled();
  });

  it.each(["", "[MEDIATION_REQUEST]", " \n[INITIAL_GREETING][/INITIAL_GREETING]\t "])("never hands an empty terminal body to the durable ledger: %j", async fullText => {
    // 빈 본문이 원장으로 가면 사용자는 침묵만 본다. 오늘은 앞단
    // (`composeAmoraPersistenceTerminal`)이 먼저 서버 문장을 채우고,
    // `ensureNonEmptyTerminalText` 가 그 뒤에 서는 두 번째 그물이다.
    // 여기서 잠그는 것은 **원장이 받는 본문이 절대 비지 않는다**는 사실이다.
    providerAfterPreGeneration(providerResult({ fullText }));

    const response = await POST(request());
    expect(response.status).toBe(200);
    const body = await response.text();

    const persistedContent = mocks.atomicResponses[0]?.content;
    expect(typeof persistedContent).toBe("string");
    expect(String(persistedContent).trim().length).toBeGreaterThan(0);
    expect(persistedContent).toBe(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
    const done = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))
      .find(event => event.type === "done");
    expect(done?.fullContent).toBe(AMORA_EMPTY_TERMINAL_FALLBACK_TEXT);
    expect(body).not.toMatch(/\[\/?(?:MEDIATION_REQUEST|INITIAL_GREETING)\]/u);
  });
  it("requires the exact personal draft function before canonical/done delivery without saving", async () => {
    const text = '나만 볼 개인 할 일 초안을 하나 만들어줘. 제목은 "사진에서 꼭 남기고 싶은 장면 세 가지 정리"로 해줘. 설명에는 나만 볼 생각을 메모한다는 내용을 담아줘. 마감일은 정하지 않았어. 개인 할 일 저장 전에 내가 검토할 수 있게 초안을 보여줘.';
    const draft = { title: "사진에서 꼭 남기고 싶은 장면 세 가지 정리", description: "나만 볼 생각을 메모하며 사진에서 꼭 남기고 싶은 장면 세 가지를 정리한다.", dueDate: null };
    const reply = "개인 할 일 초안이에요. 아직 저장하지 않았으니 내용을 확인한 뒤 저장해 주세요.";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text, visibility: "bride_private" };
    const actual = await vi.importActual<typeof import("@/lib/ai/toolExecutor")>("@/lib/ai/toolExecutor");
    mocks.executeTool.mockImplementation(actual.executeTool);
    mocks.provider.mockImplementationOnce(async (options: {
      toolChoice?: { type: "function"; name: string };
      beforeProviderEgress?: () => Promise<void>;
      beforeGeneration?: () => Promise<void>;
    }) => {
      await options.beforeProviderEgress?.();
      await options.beforeGeneration?.();
      return options.toolChoice?.type === "function" && options.toolChoice.name === "prepare_personal_action"
        ? providerResult({ toolCalls: [{ callId: "personal_draft", name: "prepare_personal_action", input: draft }], outputItems: [{ type: "function_call", call_id: "personal_draft", name: "prepare_personal_action", arguments: JSON.stringify(draft) }] })
        : providerResult({ fullText: "개인 할 일 저장 전 초안이에요. 제목과 설명을 확인한 뒤 아래 저장 버튼에서 반영할 수 있어요." });
    });
    providerAfterPreGeneration(providerResult({ fullText: reply }));
    const response = await POST(request({ visibility: "bride_private", messages: [{ role: "user", content: text }] }));
    expect(response.status).toBe(200);
    const body = await response.text();
    const done = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))
      .find(event => event.type === "done");
    expect(mocks.provider.mock.calls[0][0].tools.map((tool: AiToolDefinition) => tool.name)).toContain("prepare_personal_action");
    expect(mocks.provider.mock.calls[0][0].toolChoice).toEqual({ type: "function", name: "prepare_personal_action" });
    expect(mocks.chooseModelRole).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      evidenceSummaryContext: expect.objectContaining({ hasPersonalTools: true }),
    }));
    expect(mocks.provider).toHaveBeenCalledTimes(2);
    expect(mocks.provider.mock.calls[1][0].toolChoice).toBeUndefined();
    expect(mocks.executeTool).toHaveBeenCalledExactlyOnceWith("prepare_personal_action", draft, expect.objectContaining({
      currentUserText: text, actorProfileId: "00000000-0000-4000-8000-000000000001",
      personalActions: expect.objectContaining({ visibility: "bride_private" }),
    }));
    const result = await mocks.executeTool.mock.results[0].value;
    expect(result.toolOutput).toEqual({ saved: false, requires_confirmation: true, draft });
    expect(mocks.personalReadCount).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(1);
    const canonical = mocks.atomicResponses[0];
    expect(canonical?.content).toBe(reply);
    expect(done?.fullContent).toBe(canonical?.content);
    expect(canonical?.metadata).toMatchObject({ personal_action_draft: draft, question_scope: "W0_wedding_core", memory_eligible: false, memory_enqueue_requested: false, toolResults: [] });
    expect(done?.metadata.personal_action_draft).toEqual(draft);
    expect(canonical?.metadata).not.toHaveProperty("pending_amora_action");
  });

  it.each([
    '나만 볼 개인 할 일 초안을 하나 만들어줘. 제목은 "사진에서 꼭 남기고 싶은 장면 세 가지 정리"로 해줘. 설명에는 나만 볼 생각을 메모한다는 내용을 담아줘. 마감일은 정하지 않았어. 개인 할 일 저장 전에 내가 검토할 수 있게 초안을 보여줘.',
    "내 개인 할 일 초안을 만들어줘",
  ])("does not turn a personal draft request in shared chat into a shared approval proposal: %s", async text => {
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text, visibility: "shared" };
    providerAfterPreGeneration(providerResult({ fullText: '초안을 확인해 주세요.\n[pending_action]{"tool":"add_amora_action","input":{"title":"사진에서 꼭 남기고 싶은 장면 세 가지 정리"}}[/pending_action]' }));
    const response = await POST(request({ messages: [{ role: "user", content: text }] }));
    expect(response.status).toBe(200);
    const body = await response.text();
    const done = body.split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)))
      .find(event => event.type === "done");
    const provider = mocks.provider.mock.calls[0]?.[0];
    expect(provider.systemPrompt).not.toContain("[서버 발급 후속 확인 계약]");
    expect(provider.tools.map((tool: AiToolDefinition) => tool.name)).not.toContain("prepare_personal_action");
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses).toHaveLength(1);
    expect(mocks.atomicResponses[0].metadata).toMatchObject({ question_scope: "W4_out_of_scope", memory_eligible: false });
    for (const metadata of [mocks.atomicResponses[0].metadata, done?.metadata]) {
      expect(metadata).not.toHaveProperty("pending_amora_action");
      expect(metadata).not.toHaveProperty("pending_amora_action_queue");
      expect(metadata).not.toHaveProperty("personal_action_draft");
    }
    expect(done?.fullContent).toBe(mocks.atomicResponses[0].content);
  });

  it.each(["get_personal_actions", "prepare_personal_action"])("connects a private %s through the real executor to canonical minimal metadata", async name => {
    const text = name === "get_personal_actions" ? "내 개인 할 일 목록 보여줘" : "내 개인 할 일로 예식 준비 질문을 정리하는 초안을 저장해줘";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text, visibility: "bride_private" };
    const actual = await vi.importActual<typeof import("@/lib/ai/toolExecutor")>("@/lib/ai/toolExecutor");
    mocks.executeTool.mockImplementation(actual.executeTool);
    const input = name === "get_personal_actions" ? { status: "open" } : { title: "예식 준비 질문 정리", description: "본인이 확인할 질문", dueDate: null };
    providerAfterPreGeneration(providerResult({ toolCalls: [{ callId: "private_tool", name, input }], outputItems: [{ type: "function_call", call_id: "private_tool", name, arguments: JSON.stringify(input) }] }));
    providerAfterPreGeneration(providerResult({ fullText: name === "get_personal_actions" ? "현재 건수를 확인했어요. 개인 목록에서 내용을 확인해 주세요." : "개인 할 일 초안이에요. 내용을 확인한 뒤 저장해 주세요." }));
    const response = await POST(request({ visibility: "bride_private", messages: [{ role: "user", content: text }] }));
    expect(response.status).toBe(200);
    const stream = await response.text();
    expect(mocks.executeTool).toHaveBeenCalledWith(name, input, expect.objectContaining({ actorProfileId: "00000000-0000-4000-8000-000000000001", personalActions: expect.objectContaining({ visibility: "bride_private" }) }));
    expect(mocks.provider.mock.calls[0][0].tools.map((tool: AiToolDefinition) => tool.name)).toContain(name);
    const metadata = mocks.atomicResponses.at(-1)?.metadata;
    expect(metadata?.toolResults).toEqual([]);
    expect(metadata?.memory_eligible).toBe(false);
    expect(metadata?.memory_enqueue_requested).toBe(false);
    if (name === "prepare_personal_action") {
      expect(metadata?.personal_action_draft).toEqual(input);
      expect(stream).toContain('"saved":false');
    } else {
      expect(metadata?.personal_actions_view).toEqual({ status: "open" });
      expect(mocks.personalReadCount).toHaveBeenCalledWith(expect.anything(), "00000000-0000-4000-8000-000000000001", COUPLE_ID, "bride_private", "open");
      expect(JSON.stringify(mocks.provider.mock.calls.at(-1)?.[0].input)).not.toContain("source_message_id");
    }
  });
  it.each(["shared", "bride_private"])("rejects a provider-forged personal tool in %s without current consent", async visibility => {
    const text = visibility === "shared" ? "내 개인 할 일 목록 보여줘" : "예식 준비 순서 알려줘";
    mocks.canonicalRows[0] = { ...mocks.canonicalRows[0], content: text, visibility };
    providerAfterPreGeneration(providerResult({ toolCalls: [{ callId: "forged_private", name: "get_personal_actions", input: { status: "all" } }], outputItems: [] }));
    providerAfterPreGeneration(providerResult({ fullText: "요청하신 준비 내용을 정리할게요." }));
    const response = await POST(request({ visibility, messages: [{ role: "user", content: text }] }));
    await response.text();
    expect(mocks.executeTool).not.toHaveBeenCalled();
    expect(mocks.atomicResponses.at(-1)?.metadata).not.toHaveProperty("personal_actions_view");
  });
});
