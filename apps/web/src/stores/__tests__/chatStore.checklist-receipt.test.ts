import { afterEach, describe, expect, it, vi } from "vitest";
import { CHECKLIST_MAP } from "@/constants/checklists";
import { buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import type { Profile, ToolExecutionResult, WeddingJourney } from "@/types/database.types";
import { resolveStatusByKey } from "@/utils/checklist";
import { useAuthStore } from "../authStore";
import { syncToolResult, useChatStore } from "../chatStore";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(() => { throw new Error("No network allowed in receipt regression"); }),
}));
vi.mock("@/lib/analytics", () => ({ captureEvent: vi.fn() }));

const originalAuth = useAuthStore.getState();
const originalChat = useChatStore.getState();
afterEach(() => {
  useAuthStore.setState(originalAuth);
  useChatStore.setState(originalChat);
  vi.unstubAllGlobals();
});

function canonicalReceipt() {
  const context: ToolExecutionContext = {
    coupleId: "10000000-0000-4000-8000-000000000001",
    weddingContext: { weddingDate: null, venue: null, budget: 30_000_000, progress: {} },
  };
  const journey: WeddingJourney = {
    id: "20000000-0000-4000-8000-000000000001", couple_id: context.coupleId,
    wedding_date: null, venue: null, total_budget: 30_000_000, progress: {},
    created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
  };
  const result = buildAmoraAtomicToolOperation("toggle_checklist_item", {
    category: "venue", item_id: CHECKLIST_MAP.venue.items[0].id, done: true,
  }, context).result;
  expect(result.success).toBe(true);
  useAuthStore.setState({ journey });
  return { result, journey };
}

describe("canonical checklist receipt projection", () => {
  it.each(["absent", "empty", "partial"] as const)(
    "shows the server-confirmed checked item when the local checklist is %s before a refresh",
    (shape) => {
      const template = CHECKLIST_MAP.venue.items;
      const target = template[0];
      const savedChecklist = shape === "empty" ? [] : shape === "partial"
        ? [{ ...template[1], done: true }] : undefined;
      const category = {
        category: "venue", status: "in_progress", budget: 12_000_000,
        ...(savedChecklist === undefined ? {} : { checklist: savedChecklist }),
      };
      const context: ToolExecutionContext = {
        coupleId: "10000000-0000-4000-8000-000000000001",
        weddingContext: {
          weddingDate: null, venue: null, budget: 30_000_000,
          progress: { venue: category },
        },
      };
      const journey: WeddingJourney = {
        id: "20000000-0000-4000-8000-000000000001", couple_id: context.coupleId,
        wedding_date: null, venue: null, total_budget: 30_000_000,
        progress: { venue: { ...category, status: "in_progress" } },
        created_at: "2026-09-28T00:00:00.000Z", updated_at: "2026-09-28T00:00:00.000Z",
      };
      useAuthStore.setState({ journey });
      const operation = buildAmoraAtomicToolOperation("toggle_checklist_item", {
        category: "venue", item_id: target.id, done: true,
      }, context);
      expect(operation.result.success).toBe(true);
      expect(operation.domainMutation.kind).toBe("journey_progress_entry_cas");

      syncToolResult(operation.result);

      const projected = useAuthStore.getState().journey?.progress.venue;
      expect(projected?.checklist?.find((item) => item.id === target.id)?.done).toBe(true);
      expect(projected).toEqual(operation.result.toolOutput.progress_value);
      expect(resolveStatusByKey("venue", projected)).toBe(operation.result.toolOutput.new_status);
      expect(projected?.budget).toBe(12_000_000);
    },
  );

  it("materializes a first category from its complete stored receipt", () => {
    const { result } = canonicalReceipt();
    syncToolResult(result);
    expect(useAuthStore.getState().journey?.progress.venue).toEqual(result.toolOutput.progress_value);
  });

  it("supports the exact legacy successful receipt without inventing unchecked item completions", () => {
    const { result } = canonicalReceipt();
    delete result.toolOutput.progress_key;
    delete result.toolOutput.progress_value;
    syncToolResult(result);
    const projected = useAuthStore.getState().journey?.progress.venue;
    expect(projected?.checklist).toHaveLength(CHECKLIST_MAP.venue.items.length);
    expect(projected?.checklist?.filter((item) => item.done).map((item) => item.id))
      .toEqual([result.toolInput.item_id]);
  });

  const corruptions: Array<[string, (result: ToolExecutionResult) => void]> = [
    ["failed operation", (result) => { result.success = false; }],
    ["missing receipt target", (result) => { delete result.toolOutput.item_id; }],
    ["different category", (result) => { result.toolOutput.progress_key = "dress"; }],
    ["null canonical value", (result) => { result.toolOutput.progress_value = null; }],
    ["non-boolean done", (result) => { result.toolOutput.done = "true"; }],
    ["different item label", (result) => { result.toolOutput.item_label = "다른 항목"; }],
    ["invalid derived status", (result) => { result.toolOutput.new_status = "completed"; }],
    ["malformed checklist", (result) => {
      result.toolOutput.progress_value = { category: "venue", status: "in_progress", checklist: [null] };
    }],
    ["duplicate checklist ids", (result) => {
      const item = { id: result.toolInput.item_id, label: result.toolOutput.item_label, done: true };
      result.toolOutput.progress_value = { category: "venue", status: "in_progress", checklist: [item, item] };
    }],
    ["target still unchecked", (result) => {
      result.toolOutput.progress_value = { category: "venue", status: "in_progress", checklist: [
        { id: result.toolInput.item_id, label: result.toolOutput.item_label, done: false },
      ] };
    }],
    ["legacy receipt with impossible status", (result) => {
      delete result.toolOutput.progress_key;
      delete result.toolOutput.progress_value;
      result.toolOutput.new_status = "completed";
    }],
  ];
  it.each(corruptions)("does not project a %s as a saved checklist", (_label, corrupt) => {
    const { result, journey } = canonicalReceipt();
    corrupt(result);
    syncToolResult(result);
    expect(useAuthStore.getState().journey).toBe(journey);
  });

  it.each(["refresh failure", "newer journey", "account switch"] as const)(
    "consumes an actual streamed receipt safely through %s",
    async (scenario) => {
      const { result, journey } = canonicalReceipt();
      const profile: Profile = {
        id: "30000000-0000-4000-8000-000000000001", couple_id: journey.couple_id,
        name: "합성 검증", role: "bride", avatar_url: null, onboarding_completed: true,
        onboarding_step: 5, is_admin: false, created_at: journey.created_at, updated_at: journey.updated_at,
      };
      const refreshJourney = vi.fn(async () => false);
      useAuthStore.setState({ user: { id: profile.id, email: "checklist@example.invalid" }, profile, isDemo: false, journey, refreshJourney });
      useChatStore.setState({ messages: [], isStreaming: false, isSending: false, isRetrying: false,
        failedRequest: {
          clientRequestId: "40000000-0000-4000-8000-000000000001", userMessageId: "confirmation",
          coupleId: journey.couple_id, content: "이대로 적용", visibility: "shared",
          confirmedActionId: "50000000-0000-4000-8000-000000000001", attachmentCount: 0,
          canRetry: true, unavailableReason: null, requestBody: "{}", isDemo: false,
        },
      });
      let resolveFetch!: (response: Response) => void;
      const pendingResponse = new Promise<Response>((resolve) => { resolveFetch = resolve; });
      const fetchMock = vi.fn<typeof fetch>(() => pendingResponse);
      vi.stubGlobal("fetch", fetchMock);
      const pending = useChatStore.getState().retryFailedMessage();
      const newerJourney: WeddingJourney = { ...journey, state_revision: 2,
        ...(scenario === "account switch" ? { couple_id: "60000000-0000-4000-8000-000000000001" } : {}),
        progress: { venue: { category: "venue", status: "not_started", budget: 15_000_000 } },
      };
      if (scenario === "newer journey") useAuthStore.setState({ journey: newerJourney });
      if (scenario === "account switch") useAuthStore.setState({
        user: { id: "70000000-0000-4000-8000-000000000001", email: "other@example.invalid" },
        profile: { ...profile, id: "70000000-0000-4000-8000-000000000001", couple_id: newerJourney.couple_id },
        journey: newerJourney,
      });
      resolveFetch(new Response([
        { type: "tool_result", result },
        { type: "done", fullContent: result.displayMessage,
          metadata: { serverMessageId: "80000000-0000-4000-8000-000000000001", toolResults: [result] } },
      ].map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
        status: 200, headers: { "Content-Type": "text/event-stream" },
      }));
      await pending;
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/chat");
      if (scenario === "refresh failure") {
        expect(useAuthStore.getState().journey?.progress.venue).toEqual(result.toolOutput.progress_value);
        expect(useChatStore.getState().error).toContain("최신 준비 정보를 불러오지 못했어요");
      } else expect(useAuthStore.getState().journey).toBe(newerJourney);
      expect(refreshJourney).toHaveBeenCalledTimes(scenario === "account switch" ? 0 : 1);
    },
  );
});
