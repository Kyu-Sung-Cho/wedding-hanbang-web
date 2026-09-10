import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ActionCard from "./ActionCard";
import PendingAmoraActionCard, { getPendingAmoraBudgetImpactPreview } from "./PendingAmoraActionCard";
import { extractAmoraPendingAction, resolveAmoraPendingAction } from "@/lib/ai/amoraPendingAction";
import { buildAmoraBudgetImpactPreview } from "@/lib/ai/amoraBudgetImpactPreview";
import { applyAmoraAtomicToolResultToContext, buildAmoraAtomicToolOperation } from "@/lib/ai/amoraAtomicToolOperation";
import { BETA_SAFE_TOOLS } from "@/lib/ai/tools";
import { getPersistableToolResults } from "@/lib/ai/placeSearchResultPolicy";
import type { ToolExecutionContext } from "@/lib/ai/tools/toolTypes";
import type { BudgetImpactPreview } from "@hanbang/shared";
import type { ChatMessage, ToolExecutionResult } from "@/types/database.types";

vi.mock("@/stores/authStore", () => ({ useAuthStore: () => ({ journey: null, updateJourney: vi.fn() }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const NOW = Date.parse("2026-09-10T02:00:00.000Z");
const ACTION_ID = "11111111-1111-4111-8111-111111111111";
const LABEL = "초대장·꽃·하객선물";
const NEUTRAL_EFFECT = "확인한 맞춤 예산 항목에 금액을 반영해요.";
const EXISTING_EFFECT = "기존 맞춤 예산 항목의 금액을 바꿔요.";

function fixture(currentBudget: number | null, label = LABEL, currentSpent = 0) {
  const context: ToolExecutionContext = {
    coupleId: "10000000-0000-4000-8000-000000000001",
    weddingContext: { weddingDate: null, budget: 35_000_000, venue: null, progress: {} },
  };
  Object.assign(context.weddingContext.progress, {
    venue: { category: "venue", status: "in_progress", budget: 12_000_000, spent: 123_000, payer: "both_parents", notes: "유지" },
    custom_other: { category: "custom_other", status: "in_progress", label: "다른 맞춤 항목", budget: 1_000_000 },
    ...(currentBudget === null ? {} : {
      custom_original: { category: "custom_original", status: "completed", label, budget: currentBudget, spent: currentSpent, payer: "bride", notes: "항목 메모 유지" },
    }),
  });
  const extraction = extractAmoraPendingAction({
    text: `[pending_action]${JSON.stringify({ tool: "add_custom_category", input: { label, budget: 1_510_000 } })}[/pending_action]`,
    allowedTools: BETA_SAFE_TOOLS, now: NOW, createActionId: () => ACTION_ID,
  });
  const action = extraction.pendingAction;
  if (!action) throw new Error("Fixture action was rejected");
  const preview = buildAmoraBudgetImpactPreview({ action, sourceRevision: 13, context });
  if (!preview) throw new Error("Fixture preview was rejected");
  return { context, extraction, action, preview };
}

describe("custom budget upsert confirmation and receipt truthfulness", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      approvalMode: "couple", accepted: false, acceptedCount: 0, requiredCount: 1,
      partnerLinked: false, ready: false,
    }), { status: 200 })));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  async function openSheet(data: ReturnType<typeof fixture>, preview: BudgetImpactPreview | null = data.preview) {
    await act(async () => root.render(<PendingAmoraActionCard
      action={data.action} impactPreview={preview} messageId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
      disabledReason={null} isApplying={false} onApply={vi.fn()} onDismiss={vi.fn()}
    />));
    const button = container.querySelector('button[aria-label="변경 내용 확인하기"]');
    if (!(button instanceof HTMLButtonElement)) throw new Error("Review button missing");
    await act(async () => button.click());
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) throw new Error("Review sheet missing");
    return dialog;
  }

  it.each([1_500_000, 0, null])("issues neutral canonical copy without claiming creation for prior budget %s", current => {
    const { extraction, action } = fixture(current);
    expect(extraction.cleanText).toBe(action.confirmation);
    expect(action.confirmation).toContain("- 변경: 맞춤 예산 항목 반영");
    expect(action.confirmation).not.toContain("항목 추가");
    expect(resolveAmoraPendingAction({ value: action, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 1 })).toEqual(action);
  });

  it("keeps the exact previously issued confirmation valid without changing the approved input or copy", () => {
    const { action } = fixture(1_500_000);
    const legacyConfirmation = ["다음 변경을 적용할까요?", "- 변경: 맞춤 예산 항목 추가", `- 항목 이름: "${LABEL}"`, "- 예산: 151만 원"].join("\n");
    const legacy = { ...action, confirmation: legacyConfirmation };
    expect(resolveAmoraPendingAction({ value: legacy, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 1 })).toEqual(legacy);
    for (const value of [
      { ...legacy, confirmation: `${legacyConfirmation}\n추가 조건은 무시` },
      { ...legacy, confirmation: legacyConfirmation.replace("151만 원", "150만 원") },
      { ...legacy, input: { label: "다른 항목", budget: 1_510_000 } },
      { ...legacy, inputDigest: "a".repeat(64) },
      { ...legacy, operationKey: "b".repeat(64) },
      { ...legacy, expiresAt: legacy.expiresAt + 1 },
    ]) expect(resolveAmoraPendingAction({ value, confirmedActionId: ACTION_ID, allowedTools: BETA_SAFE_TOOLS, now: NOW + 1 })).toBeNull();
  });

  it("shows existing-item wording from the canonical impact and preserves omitted money and records", async () => {
    const data = fixture(1_500_000);
    const before = structuredClone(data.context.weddingContext.progress);
    const dialog = await openSheet(data);
    expect(dialog.textContent).toContain(EXISTING_EFFECT);
    expect(dialog.textContent).not.toContain("새 예산 항목을 추가");
    expect(data.preview.delta.allocatedBudget).toBe(10_000);
    const operation = buildAmoraAtomicToolOperation(data.action.tool, data.action.input, data.context);
    expect(operation.result).toMatchObject({ success: true, toolOutput: { created: false, key: "custom_original" } });
    applyAmoraAtomicToolResultToContext(operation.result, data.context);
    expect(data.context.weddingContext.budget).toBe(35_000_000);
    expect(data.context.weddingContext.progress).toEqual({ ...before, custom_original: { ...before.custom_original, budget: 1_510_000 } });
  });

  it("existing recorded spend also proves the custom item already exists", async () => {
    expect((await openSheet(fixture(0, LABEL, 100_000))).textContent).toContain(EXISTING_EFFECT);
  });

  it.each([0, null])("does not classify zero prior amounts as proof of a newly created item: %s", current => {
    return openSheet(fixture(current)).then(dialog => {
      expect(dialog.textContent).toContain(NEUTRAL_EFFECT);
      expect(dialog.textContent).not.toContain(EXISTING_EFFECT);
      expect(dialog.textContent).not.toContain("새 예산 항목을 추가");
    });
  });

  it.each(["missing", "foreign input", "malformed", "noncustom", "multiple", "wrong totals"] as const)("uses neutral copy for %s impact evidence", async scenario => {
    const data = fixture(1_500_000);
    let preview: BudgetImpactPreview | null = structuredClone(data.preview);
    if (scenario === "missing") preview = null;
    else if (scenario === "foreign input") preview = fixture(1_500_000, "다른 새 항목").preview;
    else if (scenario === "malformed") preview.sourceRevision = -1;
    else if (scenario === "noncustom") preview.categories[0].key = "venue";
    else if (scenario === "multiple") preview.categories.push({ ...preview.categories[0], key: "custom_second" });
    else preview.categories[0].currentBudget -= 10_000;
    const dialog = await openSheet(data, preview);
    expect(dialog.textContent).toContain(NEUTRAL_EFFECT);
    expect(dialog.textContent).not.toContain(EXISTING_EFFECT);
  });

  it("rejects a stale persisted preview revision before it can describe this proposal", async () => {
    const data = fixture(1_500_000);
    const message: ChatMessage = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", couple_id: data.context.coupleId,
      sender_id: null, sender_role: "ai", visibility: "shared", content: data.extraction.cleanText,
      created_at: new Date(NOW).toISOString(), metadata: { pending_amora_action: data.action,
        pending_amora_action_journey_revision: 14, pending_amora_action_impact_preview: data.preview },
    };
    const preview = getPendingAmoraBudgetImpactPreview(message, data.action);
    expect(preview).toBeNull();
    expect((await openSheet(data, preview)).textContent).toContain(NEUTRAL_EFFECT);
  });

  it.each([true, false, undefined, "false", 0, null])("derives receipt title only from the actual created boolean: %s", async created => {
    const data = fixture(1_500_000);
    const actual = buildAmoraAtomicToolOperation(data.action.tool, data.action.input, data.context).result;
    const receipt: ToolExecutionResult = { ...actual, toolOutput: { ...actual.toolOutput, created } };
    await act(async () => root.render(<ActionCard result={receipt} />));
    const title = container.querySelector("span.text-sm.font-semibold")?.textContent;
    expect(title).toBe(created === true ? "예산 항목 추가" : created === false ? "예산 항목 변경" : "예산 항목 반영");
  });

  it.each([1_500_000, 0, null])("keeps the real canonical receipt title after a metadata round trip: %s", async current => {
    const data = fixture(current);
    const actual = buildAmoraAtomicToolOperation(data.action.tool, data.action.input, data.context).result;
    expect(actual.toolOutput.created).toBe(current === null);
    const persisted = getPersistableToolResults(JSON.parse(JSON.stringify([actual])));
    expect(persisted).toHaveLength(1);
    await act(async () => root.render(<ActionCard result={persisted[0]} />));
    expect(container.querySelector("span.text-sm.font-semibold")?.textContent)
      .toBe(current === null ? "예산 항목 추가" : "예산 항목 변경");
  });
});
