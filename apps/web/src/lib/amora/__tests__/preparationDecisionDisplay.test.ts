import { describe, expect, it } from "vitest";
import { arrangePreparationDecisions, parsePreparationDecisions } from "../preparationBoard";
import { formatChosenValue, getPreparationDecisionDisplay } from "../preparationDecisionDisplay";

const coupleId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const base = {
  id: "33333333-3333-4333-8333-333333333333", couple_id: coupleId, visibility: "shared",
  category: "general", title: "일정 취소: 확인할 일정", reasoning: null, decision_type: "scheduled",
  source: "schedule", created_at: "2026-09-11T00:00:00Z", superseded_at: null, memory_key: null,
};
function schedule(kind: "cancel" | "restore", origin = "couple_plan_change_request") {
  const before = { id: eventId, title: "확인할 일정", status: kind === "cancel" ? "planned" : "cancelled" };
  const after = { ...before, status: kind === "cancel" ? "cancelled" : "planned" };
  return {
    ...base, title: `일정 ${kind === "cancel" ? "취소" : "복원"}: 확인할 일정`,
    metadata: { origin, mutationKind: kind, eventId },
    chosen_value: { schemaVersion: 1, eventId, before, after,
      ...(origin === "couple_plan_change_request" ? { mutationKind: kind, changes: { __events: [after] } } : { operation: kind }) },
  };
}
function budget(title = "venue 예산: 13000000원 → 12500000원") {
  return { ...base, category: "plan", source: "manual", decision_type: "decided", title,
    metadata: { origin: "couple_plan_change_request" },
    chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      venue: { budget: 12500000, spent: 123000, payer: "both_parents", status: "not_started", category: "venue" },
    }, progress_remove_keys: [] } },
  };
}
const parse = (row: unknown) => parsePreparationDecisions([row], coupleId).records[0];

describe("preparation decision historical display", () => {
  it.each(["couple_plan_change_request", "amora_shared_action"])("labels structured cancel/restore as records for %s without moving their stored category or column", origin => {
    for (const kind of ["cancel", "restore"] as const) {
      const row = schedule(kind, origin); const original = structuredClone(row);
      expect(parse(row)).toMatchObject({ title: row.title, category: "general", source: "schedule", status: "confirmed",
        stateLabel: kind === "cancel" ? "일정 취소 기록" : "일정 복원 기록" });
      expect(row).toEqual(original);
    }
  });

  it("uses a neutral record label for legacy, unsupported or inconsistent evidence instead of reading cancellation from prose", () => {
    const row = schedule("cancel");
    for (const value of [
      { ...base, metadata: {} }, { ...row, chosen_value: null }, { ...row, chosen_value: "cancel" },
      { ...row, source: "chat" }, { ...row, metadata: { ...row.metadata, origin: "other" } },
      { ...row, metadata: { ...row.metadata, mutationKind: "restore" } },
      { ...row, chosen_value: { ...row.chosen_value, schemaVersion: 2 } },
      { ...row, chosen_value: { ...row.chosen_value, eventId: coupleId } },
      { ...row, chosen_value: { ...row.chosen_value, after: { ...row.chosen_value.after, status: "planned" } } },
      { ...row, chosen_value: { ...row.chosen_value, before: null } },
      { ...schedule("restore"), chosen_value: { ...schedule("restore").chosen_value, before: { id: eventId, status: "planned" } } },
    ]) expect(parse(value).stateLabel).toBe("일정 기록");
  });

  // 금액은 DB 원문("12500000원")을 그대로 검증하고, 화면에는 예산 화면과 같은 formatWon 표기로 보여준다.
  it.each([
    ["venue 예산: 13000000원 → 12500000원", "결혼식장 예산: 1,300만원 → 1,250만원"],
    ["venue 부담: 미정 → 두 가족", "결혼식장 부담: 미정 → 두 가족"],
    ["venue 지출: 미정 → 123000원", "결혼식장 지출: 미정 → 123,000원"],
    ["venue 예산: 13000000원 → 12500000원 · venue 부담: 미정 → 두 가족", "결혼식장 예산: 1,300만원 → 1,250만원 · 결혼식장 부담: 미정 → 두 가족"],
  ])("formats proven generated legacy title %s while retaining the original", (title, displayTitle) => {
    const row = budget(title); const original = structuredClone(row);
    expect(parse(row)).toMatchObject({ title, displayTitle, category: "plan", status: "confirmed", source: "manual" });
    expect(row).toEqual(original);
  });

  it("preserves custom names, arbitrary prose, unknown provenance and unmatched amounts unchanged", () => {
    const row = budget(); const patch = row.chosen_value.changes.progress_patch.venue;
    for (const value of [
      { ...row, source: "budget" }, { ...row, metadata: {} }, { ...row, chosen_value: null },
      { ...row, title: "venue에 상담한 뒤 예산을 정했어요" },
      { ...row, title: "venue 예산: 13000000원 → 12500001원" },
      { ...row, title: "venue 지출: 미정 → 999원" },
      { ...row, title: "venue 부담: 미정 → 두 사람" },
      { ...row, title: `${row.title} · 직접 남긴 메모` },
      { ...row, title: `인용: ${row.title}` },
      ...[{ label: "venue" }, { name: "내 venue" }, { category: "custom_venue" }].map(change => ({ ...row,
        chosen_value: { ...row.chosen_value, changes: { progress_patch: { venue: { ...patch, ...change } } } },
      })),
      { ...row, title: "custom_venue 예산: 13000000원 → 12500000원", chosen_value: { schemaVersion: 1,
        changes: { progress_patch: { custom_venue: { ...patch, category: "custom_venue" } } } } },
    ]) {
      expect(parse(value).title).toBe(value.title);
      expect(parse(value)).not.toHaveProperty("displayTitle");
      expect(parse(value)).not.toHaveProperty("valueSlots");
    }
  });

  it("adds thousands separators to the spent amount a user reported without parsing comma text", () => {
    const row = { ...budget("studio 지출: 0원 → 500000원"), chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      studio: { category: "studio", status: "in_progress", spent: 500000 } }, progress_remove_keys: [] } } };
    expect(parse(row)).toMatchObject({ title: "studio 지출: 0원 → 500000원", displayTitle: "웨딩 사진 촬영 지출: 0원 → 50만원",
      valueSlots: ["spent:studio"], relatedCategories: ["budget", "studio"] });
    const odd = { ...row, title: "studio 지출: 0원 → 512345원", chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      studio: { category: "studio", status: "in_progress", spent: 512345 } } } } };
    expect(parse(odd).displayTitle).toBe("웨딩 사진 촬영 지출: 0원 → 512,345원");
    // 이미 쉼표가 들어간 원문은 DB가 만든 모양이 아니므로 바꾸지 않는다.
    expect(parse({ ...row, title: "studio 지출: 0원 → 500,000원" })).not.toHaveProperty("displayTitle");
  });

  it("formats named custom items and total budget changes only when the stored after-value matches", () => {
    const custom = { ...budget("결혼식장·식사 예산: 9000000원 → 9500000원"), chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      custom_venue: { status: "not_started", label: "결혼식장·식사", budget: 9500000 } } } } };
    expect(parse(custom)).toMatchObject({ displayTitle: "결혼식장·식사 예산: 900만원 → 950만원", valueSlots: ["budget:custom_venue"], relatedCategories: ["budget"] });
    const total = { ...budget("총예산: 30000000원 → 35000000원"), chosen_value: { schemaVersion: 1, changes: { total_budget: 35000000 } } };
    expect(parse(total)).toMatchObject({ displayTitle: "총예산: 3,000만원 → 3,500만원", valueSlots: ["budget:total"] });
    expect(parse({ ...total, title: "총예산: 30000000원 → 36000000원" })).not.toHaveProperty("displayTitle");
  });

  it("shows before and after amounts for Amora budget receipts and keys them by scope and category", () => {
    const row = amoraCategory("33333333-3333-4333-8333-333333333333", "2026-09-12T00:00:00Z", 4500000, 4000000);
    expect(parse(row)).toMatchObject({ title: "드레스·예식 정장 예산 4,000,000원 반영", displayTitle: "드레스·예식 정장 예산 450만원 → 400만원",
      category: "budget", valueSlots: ["budget:dress"], relatedCategories: ["dress"] });
    expect(parse(amoraCategory(row.id, row.created_at, null, 4000000)).displayTitle).toBe("드레스·예식 정장 예산 미정 → 400만원");
    const total = { ...row, title: "총예산 35,000,000원 반영", chosen_value: { schemaVersion: 1, budgetScope: "total", amount: 35000000,
      budgetDelta: { schemaVersion: 1, totalBudget: { before: 30000000, after: 35000000 }, categories: [] } } };
    expect(parse(total)).toMatchObject({ displayTitle: "총예산 3,000만원 → 3,500만원", valueSlots: ["budget:total"] });
    const allocation = { ...row, title: "총예산 35,000,000원 기준 예산 배분 반영", chosen_value: { schemaVersion: 1, budgetScope: "allocation",
      budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [
        { key: "dress", label: "드레스", beforeBudget: null, afterBudget: 3000000 },
        { key: "reserve", label: "예비비", beforeBudget: 1000000, afterBudget: 2000000 }] } } };
    // 총예산이 그대로인 배분(totalBudget: null)은 총예산 값을 바꾼 기록이 아니다.
    expect(parse(allocation)).toMatchObject({ displayTitle: "총예산 3,500만원 기준 예산 배분 반영",
      valueSlots: ["budget:dress", "budget:reserve"], relatedCategories: ["dress"] });
    // 배분하면서 총예산도 바꿨다면 총예산 값의 기록이기도 하다.
    const allocationWithTotal = { ...allocation, chosen_value: { ...allocation.chosen_value,
      budgetDelta: { ...allocation.chosen_value.budgetDelta, totalBudget: { before: 30000000, after: 35000000 } } } };
    expect(parse(allocationWithTotal)).toMatchObject({ displayTitle: "총예산 3,500만원 기준 예산 배분 반영",
      valueSlots: ["budget:total", "budget:dress", "budget:reserve"], relatedCategories: ["dress"] });
    for (const broken of [
      { ...row, metadata: { origin: "other" } },
      { ...row, chosen_value: { ...row.chosen_value, amount: 4500000 } },
      { ...row, chosen_value: { ...row.chosen_value, categoryKey: "venue" } },
      { ...row, chosen_value: { ...row.chosen_value, budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [{ key: "dress", label: "드레스", beforeBudget: -1, afterBudget: 4000000 }] } } },
      { ...total, chosen_value: { ...total.chosen_value, amount: 1 } },
      { ...allocation, title: "총예산 35000000원 기준 예산 배분 반영" },
    ]) {
      expect(parse(broken)).not.toHaveProperty("displayTitle");
      expect(parse(broken)).not.toHaveProperty("valueSlots");
    }
  });

  it("drops unchanged schedule fragments at display time and keeps the stored original", () => {
    const title = "일정 복원: 스튜디오 미팅 · 날짜: 2027-05-01 → 2027-05-01 · 시간: 없음 → 없음 · 상태: 취소 → 예정 · 취소 기록: 있음 → 제거";
    const row = { ...schedule("restore"), title };
    expect(parse(row)).toMatchObject({ title, displayTitle: "일정 복원: 스튜디오 미팅 · 날짜: 2027-05-01 · 상태: 취소 → 예정 · 취소 기록: 있음 → 제거" });
    // 사용자가 적은 일정 제목과 다른 출처의 기록은 건드리지 않는다.
    expect(parse({ ...row, title: "일정 수정: 메모: 없음 → 없음" })).not.toHaveProperty("displayTitle");
    expect(parse({ ...row, metadata: { ...row.metadata, origin: "amora_shared_action" } })).not.toHaveProperty("displayTitle");
  });

  it("marks only checklist or status saves as routine progress and leaves real changes as decisions", () => {
    const routine = { ...budget("진행 상황: 2개 수정"), chosen_value: { schemaVersion: 1, changes: { progress_patch: {
      dress: { category: "dress", status: "in_progress", budget: 4000000, checklist: [{ id: "a", label: "피팅", done: true }] },
      venue: { category: "venue", status: "completed" },
    }, progress_remove_keys: [] } } };
    expect(parse(routine)).toMatchObject({ routineChanges: 2 });
    for (const value of [
      { ...routine, title: "진행 상황: 3개 수정" },
      { ...routine, title: "진행 상황: 2개 수정 · 1개 삭제" },
      { ...routine, title: "진행 상황: 전체 변경" },
      { ...routine, chosen_value: { schemaVersion: 1, changes: { ...routine.chosen_value.changes, progress_remove_keys: ["venue"] } } },
      { ...routine, chosen_value: { schemaVersion: 1, changes: { ...routine.chosen_value.changes, venue: "새 장소" } } },
      { ...routine, title: "진행 상황: 1개 수정", chosen_value: { schemaVersion: 1, changes: { progress_patch: { __events: [] } } } },
      { ...routine, title: "진행 상황: 1개 수정", chosen_value: { schemaVersion: 1, changes: { progress_patch: { dress: { budget: 1 } } } } },
      { ...routine, source: "schedule" },
      { ...routine, decision_type: "scheduled" },
      { ...routine, metadata: {} },
    ]) expect(parse(value)).not.toHaveProperty("routineChanges");
  });

  // 2026-09-16 운영 실측: 일정 화면에서 체크한 저장은 source=schedule · decision_type=scheduled 로 남아
  // "진행 상황: 1개 수정" 여섯 줄이 결정 목록에 그대로 보였다. 일정이 바뀐 저장은 DB가 일정 요약 제목을 쓴다.
  it("folds checklist saves recorded from the schedule screen, which the database stores as scheduled records", () => {
    const fromSchedule = { ...base, category: "schedule", title: "진행 상황: 1개 수정", reasoning: "현재 구성원이 확인한 수동 계획 변경",
      metadata: { origin: "couple_plan_change_request", surfaceHref: "/schedule" },
      chosen_value: { schemaVersion: 1, changes: { progress_patch: {
        greeting: { status: "in_progress", category: "greeting", checklist: [{ id: "greeting_01", done: true, label: "각자 찾아뵐 날짜와 시간, 만날 곳 확정" }] },
      }, progress_remove_keys: [] } } };
    expect(parse(fromSchedule)).toMatchObject({ routineChanges: 1, stateLabel: "일정 기록" });
    for (const value of [
      { ...fromSchedule, chosen_value: { schemaVersion: 1, changes: { progress_patch: { __events: [] }, progress_remove_keys: [] } } },
      { ...fromSchedule, title: "일정 추가: 스드메 상담 예약 · 날짜: 없음 → 2026-10-10" },
      { ...fromSchedule, metadata: { origin: "amora_shared_action" } },
    ]) expect(parse(value)).not.toHaveProperty("routineChanges");
  });

  // "안 해요"는 준비 범위를 정한 선택이다. 체크 저장처럼 접지 않고, DB 제목에 없는 분야 이름을 patch에서 읽어 적는다.
  it("keeps a 안 해요 selection as a decision and names the skipped category", () => {
    const skip = (patch: Record<string, unknown>, count: number, source = "schedule", decision_type = "scheduled") => ({
      ...base, source, decision_type, category: source === "schedule" ? "schedule" : "plan", title: `진행 상황: ${count}개 수정`,
      metadata: { origin: "couple_plan_change_request" },
      chosen_value: { schemaVersion: 1, changes: { progress_patch: patch, progress_remove_keys: [] } } });
    expect(parse(skip({ pyebaek: { category: "pyebaek", status: "not_applicable", checklist: [] } }, 1))).toMatchObject({
      displayTitle: "결혼식 뒤 전통 인사: '안 해요'로 표시" });
    expect(parse(skip({ pyebaek: { category: "pyebaek", status: "not_applicable" }, hanbok: { status: "not_applicable" } }, 2, "manual", "decided"))).toMatchObject({
      displayTitle: "결혼식 뒤 전통 인사·한복: '안 해요'로 표시" });
    expect(parse(skip({ pyebaek: { category: "pyebaek", status: "not_applicable" }, dress: { category: "dress", status: "in_progress" } }, 2))).toMatchObject({
      displayTitle: "결혼식 뒤 전통 인사: '안 해요'로 표시 · 진행 상황 1개 수정" });
    expect(parse(skip({ custom_snap: { label: "본식 스냅", status: "not_applicable" } }, 1))).toMatchObject({ displayTitle: "본식 스냅: '안 해요'로 표시" });
    for (const row of [
      skip({ pyebaek: { category: "pyebaek", status: "not_applicable" } }, 1),
      skip({ mystery: { status: "not_applicable" } }, 1),
    ]) expect(parse(row)).not.toHaveProperty("routineChanges");
    // 이름을 읽지 못하면 원문 그대로 둔다(접지도, 지어내지도 않는다).
    expect(parse(skip({ mystery: { status: "not_applicable" } }, 1))).not.toHaveProperty("displayTitle");
  });

  // 2026-09-16 운영 실측: 분야 표시 없이 예산만 지운 저장은 DB가 키 이름으로 요약해 "hanbok 예산: 1500000원 → 미정"으로 보였다.
  it("reads a budget cleared without a category marker with screen names and 만원 amounts", () => {
    const cleared = { ...budget("총예산: 35000000원 → 32500000원 · hanbok 예산: 1500000원 → 미정 · yedan 예산: 2000000원 → 미정"),
      chosen_value: { schemaVersion: 1, changes: { total_budget: 32500000, progress_patch: {
        yedan: { status: "not_applicable" }, hanbok: { status: "not_applicable" } } } } };
    expect(parse(cleared)).toMatchObject({
      displayTitle: "총예산: 3,500만원 → 3,250만원 · 한복 예산: 150만원 → 미정 · 두 가족에게 드릴 선물 예산: 200만원 → 미정",
      valueSlots: ["budget:total", "budget:hanbok", "budget:yedan"],
    });
    // 저장된 값이 남아 있는데 요약이 "미정"이면 원문 그대로 둔다. 다른 분야 표시가 붙은 항목도 연결하지 않는다.
    for (const broken of [
      { ...cleared, chosen_value: { schemaVersion: 1, changes: { total_budget: 32500000, progress_patch: {
        yedan: { status: "not_applicable" }, hanbok: { status: "not_applicable", budget: 1500000 } } } } },
      { ...cleared, chosen_value: { schemaVersion: 1, changes: { total_budget: 32500000, progress_patch: {
        yedan: { status: "not_applicable" }, hanbok: { status: "not_applicable", category: "venue" } } } } },
    ]) expect(parse(broken)).not.toHaveProperty("displayTitle");
  });

  // 2026-09-16 운영 실측: 아모라 배분 기록의 설명이 DB 원문 "한복 1,500,000원, 예단 2,000,000원"으로 보였다.
  it("rewrites the Amora allocation detail with screen names and 만원 amounts while keeping the stored original", () => {
    const value = "총예산 35,000,000원 기준 예산 배분 반영: 한복 1,500,000원, 예단 2,000,000원";
    const allocation = { ...base, category: "budget", source: "budget", decision_type: "decided", title: "총예산 35,000,000원 기준 예산 배분 반영",
      reasoning: `승인한 구성원의 예산 배정 변경. ${value}`, metadata: { origin: "amora_shared_budget_action" },
      chosen_value: { schemaVersion: 1, budgetScope: "allocation", value, snapshotRevision: 18, budgetDelta: { schemaVersion: 1,
        totalBudget: { before: 32500000, after: 35000000 },
        categories: [{ key: "hanbok", label: "한복", beforeBudget: null, afterBudget: 1500000 }, { key: "yedan", label: "예단", beforeBudget: null, afterBudget: 2000000 }] } } };
    expect(parse(allocation)).toMatchObject({
      detail: allocation.reasoning,
      displayDetail: "승인한 구성원의 예산 배정 변경. 총예산 3,250만원 → 3,500만원 · 한복 예산 미정 → 150만원 · 두 가족에게 드릴 선물 예산 미정 → 200만원",
    });
    const unchangedTotal = { ...allocation, chosen_value: { ...allocation.chosen_value, budgetDelta: { ...allocation.chosen_value.budgetDelta, totalBudget: null } } };
    expect(parse(unchangedTotal).displayDetail).toBe("승인한 구성원의 예산 배정 변경. 한복 예산 미정 → 150만원 · 두 가족에게 드릴 선물 예산 미정 → 200만원");
    // 예비비 이름에는 이미 "미정"이 들어 있다. "예산"으로 갈라 "미정 미정"으로 붙지 않게 한다.
    const reserveValue = "총예산 35,000,000원 기준 예산 배분 반영: 한복 1,500,000원, 예비비·사용처 미정 500,000원";
    const withReserve = { ...allocation, reasoning: `승인한 구성원의 예산 배정 변경. ${reserveValue}`, chosen_value: { ...allocation.chosen_value, value: reserveValue,
      budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [
        { key: "hanbok", label: "한복", beforeBudget: null, afterBudget: 1500000 }, { key: "reserve", label: "예비비·사용처 미정", beforeBudget: null, afterBudget: 500000 }] } } };
    expect(parse(withReserve).displayDetail).toBe("승인한 구성원의 예산 배정 변경. 한복 예산 미정 → 150만원 · 예비비·사용처 미정 예산 미정 → 50만원");
    expect(parse(withReserve).displayDetail).not.toContain("미정 미정");
    // 설명이 저장된 값과 맞지 않거나 사람이 쓴 설명이면 바꾸지 않는다.
    for (const broken of [
      { ...allocation, reasoning: "승인한 구성원의 예산 배정 변경. 다른 설명" },
      { ...allocation, reasoning: "직접 적은 메모" },
      { ...allocation, chosen_value: { ...allocation.chosen_value, value: "총예산 36,000,000원 기준 예산 배분 반영: 한복 1,500,000원, 예단 2,000,000원" } },
    ]) expect(parse(broken)).not.toHaveProperty("displayDetail");
  });

  it("formats vendor_booking chosen_value into displayDetail when reasoning is null or present", () => {
    const bookingIntent = {
      ...base,
      category: "dress",
      source: "vendor_booking",
      decision_type: "considering",
      title: "메종 드 라라 상담·예약 예정",
      reasoning: null,
      metadata: { origin: "booking_intent", booking_id: "b1" },
      chosen_value: {
        booking_id: "b1",
        vendor_id: "v1",
        vendor_name: "메종 드 라라",
        product_id: "p1",
        product_name: "본식 드레스",
        booking_date: "2026-11-15",
        booking_time: "14:00",
        quoted_amount: 1500000,
      },
    };
    expect(formatChosenValue(bookingIntent.chosen_value, "vendor_booking")).toBe("2026-11-15 · 14:00 · 본식 드레스 150만원");
    expect(getPreparationDecisionDisplay(bookingIntent)).toEqual({
      title: "메종 드 라라 상담·예약 예정",
      detail: "2026-11-15 · 14:00 · 본식 드레스 150만원",
    });
    expect(parse(bookingIntent)).toMatchObject({
      title: "메종 드 라라 상담·예약 예정",
      displayDetail: "2026-11-15 · 14:00 · 본식 드레스 150만원",
    });

    const completedWithReview = {
      ...bookingIntent,
      decision_type: "completed",
      title: "메종 드 라라 상담·방문 완료",
      reasoning: "원장님이 친절하셨어요",
    };
    expect(parse(completedWithReview)).toMatchObject({
      detail: "원장님이 친절하셨어요",
      displayDetail: "2026-11-15 · 14:00 · 본식 드레스 150만원 · 원장님이 친절하셨어요",
    });
  });
});

function amoraCategory(id: string, created_at: string, before: number | null, after: number, key = "dress") {
  const title = `드레스·예식 정장 예산 ${after.toLocaleString("en-US")}원 반영`;
  return { ...base, id, created_at, category: "budget", source: "budget", decision_type: "decided", title, reasoning: "승인한 구성원의 예산 배정 변경",
    metadata: { origin: "amora_shared_budget_action" },
    chosen_value: { schemaVersion: 1, budgetScope: "category", snapshotRevision: 3, value: title, categoryKey: key, amount: after,
      budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [{ key, label: "드레스·예식 정장", beforeBudget: before, afterBudget: after }] } },
  };
}

describe("arranging loaded decision records", () => {
  const ids = ["33333333-3333-4333-8333-333333333339", "33333333-3333-4333-8333-333333333338", "33333333-3333-4333-8333-333333333337", "33333333-3333-4333-8333-333333333336", "33333333-3333-4333-8333-333333333335"];

  it("keeps only the newest dress budget as the latest value after 400 → 450 → 400", () => {
    const { records } = parsePreparationDecisions([
      amoraCategory(ids[0], "2026-09-12T03:00:00Z", 4500000, 4000000),
      amoraCategory(ids[1], "2026-09-12T02:00:00Z", 4000000, 4500000),
      amoraCategory(ids[2], "2026-09-12T01:00:00Z", null, 4000000),
    ], coupleId);
    const { decisions } = arrangePreparationDecisions(records);
    expect(decisions.map(row => [row.displayTitle, row.valueState])).toEqual([
      ["드레스·예식 정장 예산 450만원 → 400만원", "latest"],
      ["드레스·예식 정장 예산 400만원 → 450만원", "previous"],
      ["드레스·예식 정장 예산 미정 → 400만원", "previous"],
    ]);
    // 표시 순서와 원문은 그대로다.
    expect(decisions.map(row => row.id)).toEqual(ids.slice(0, 3));
    expect(decisions.map(row => row.title)).toEqual(records.map(row => row.title));
  });

  it("groups manual and Amora changes of the same value, keeps other categories and partial allocations current", () => {
    const manualVenue = { ...budget("venue 예산: 13000000원 → 12500000원"), id: ids[0], created_at: "2026-09-12T05:00:00Z" };
    const records = parsePreparationDecisions([
      manualVenue,
      amoraCategory(ids[1], "2026-09-12T04:00:00Z", 4500000, 4000000),
      { ...amoraCategory(ids[2], "2026-09-12T03:00:00Z", null, 1), title: "총예산 35,000,000원 기준 예산 배분 반영", chosen_value: { schemaVersion: 1, budgetScope: "allocation",
        budgetDelta: { schemaVersion: 1, totalBudget: null, categories: [
          { key: "dress", label: "드레스", beforeBudget: null, afterBudget: 4500000 },
          { key: "venue", label: "결혼식장", beforeBudget: null, afterBudget: 13000000 },
          { key: "makeup", label: "헤어·메이크업", beforeBudget: null, afterBudget: 2000000 }] } } },
      { ...amoraCategory(ids[3], "2026-09-12T02:00:00Z", null, 13000000, "venue"), title: "결혼식장 예산 13,000,000원 반영" },
    ], coupleId).records;
    const { decisions } = arrangePreparationDecisions(records);
    expect(decisions.map(row => row.valueState)).toEqual(["latest", undefined, undefined, "previous"]);
  });

  // 총예산 3,000만→5,000만 반영 뒤, 총예산을 그대로 두고 드레스만 배분한 경우.
  const totalChange = (id: string, created_at: string, before: number, after: number) => ({
    ...amoraCategory(id, created_at, null, 1), title: `총예산 ${after.toLocaleString("en-US")}원 반영`,
    chosen_value: { schemaVersion: 1, budgetScope: "total", amount: after,
      budgetDelta: { schemaVersion: 1, totalBudget: { before, after }, categories: [] } } });
  const allocationOf = (id: string, created_at: string, total: number, totalBudget: { before: number; after: number } | null) => ({
    ...amoraCategory(id, created_at, null, 1), title: `총예산 ${total.toLocaleString("en-US")}원 기준 예산 배분 반영`,
    chosen_value: { schemaVersion: 1, budgetScope: "allocation",
      budgetDelta: { schemaVersion: 1, totalBudget, categories: [{ key: "dress", label: "드레스", beforeBudget: 3000000, afterBudget: 4000000 }] } } });

  it("keeps a total budget change current when a later allocation leaves the total budget unchanged", () => {
    const records = parsePreparationDecisions([
      allocationOf(ids[0], "2026-09-12T02:00:00Z", 50000000, null),
      totalChange(ids[1], "2026-09-12T01:00:00Z", 30000000, 50000000),
    ], coupleId).records;
    const { decisions } = arrangePreparationDecisions(records);
    expect(decisions.map(row => [row.id, row.valueState])).toEqual([[ids[0], undefined], [ids[1], undefined]]);
  });

  it("still folds the earlier total budget change when a later allocation changed the total budget again", () => {
    const records = parsePreparationDecisions([
      allocationOf(ids[0], "2026-09-12T02:00:00Z", 60000000, { before: 50000000, after: 60000000 }),
      totalChange(ids[1], "2026-09-12T01:00:00Z", 30000000, 50000000),
    ], coupleId).records;
    const { decisions } = arrangePreparationDecisions(records);
    expect(decisions.map(row => [row.id, row.valueState])).toEqual([[ids[0], "latest"], [ids[1], "previous"]]);
  });

  it("collapses routine progress saves per Seoul day and removes them from decision counts", () => {
    const routine = (id: string, created_at: string, count: number) => ({ ...budget(`진행 상황: ${count}개 수정`), id, created_at,
      chosen_value: { schemaVersion: 1, changes: { progress_patch: Object.fromEntries(["dress", "venue", "makeup"].slice(0, count)
        .map(key => [key, { category: key, status: "in_progress" }])), progress_remove_keys: [] } } });
    const records = parsePreparationDecisions([
      routine(ids[0], "2026-09-13T15:30:00Z", 1),
      routine(ids[1], "2026-09-13T01:00:00Z", 2),
      amoraCategory(ids[2], "2026-09-12T20:00:00Z", null, 4000000),
      routine(ids[3], "2026-09-12T14:59:00Z", 3),
    ], coupleId).records;
    const { decisions, routineDays, routineCount } = arrangePreparationDecisions(records);
    expect(decisions.map(row => row.id)).toEqual([ids[2]]);
    expect(routineCount).toBe(3);
    expect(routineDays).toEqual([
      { key: "2026-09-14", label: "9. 14.", records: 1, changes: 1 },
      { key: "2026-09-13", label: "9. 13.", records: 1, changes: 2 },
      { key: "2026-09-12", label: "9. 12.", records: 1, changes: 3 },
    ]);
  });
});
