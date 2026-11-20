import {
  JOURNEY_ADD_ONS,
  JOURNEY_STAGES,
  isJourneyAddOnKey,
  isJourneyStageKey,
  parseJourneyPlan,
  type JourneyPlan,
} from "@hanbang/shared/invitation";
import { isRecord } from "@/utils/requestValidation";

/**
 * PATCH `/api/invitation/journey-plan` 본문 검사. 저장된 값을 읽는 `parseJourneyPlan` 은 모르는 값을
 * 조용히 버리지만, 경계에서는 버리지 않고 거절한다. 사람이 뺀다고 누른 것이 사라지면 안 된다.
 */

export type JourneyPlanInputResult = { ok: true; plan: JourneyPlan } | { ok: false; error: string };

export function parseJourneyPlanInput(body: unknown): JourneyPlanInputResult {
  if (!isRecord(body) || Object.keys(body).some((key) => key !== "off" && key !== "addOns")) {
    return { ok: false, error: "요청 형식이 올바르지 않아요." };
  }
  const off = body.off;
  const addOns = body.addOns;
  if (!Array.isArray(off) || !Array.isArray(addOns) || off.length > JOURNEY_STAGES.length || addOns.length > JOURNEY_ADD_ONS.length) {
    return { ok: false, error: "준비 순서 형식이 올바르지 않아요." };
  }
  const optional = new Set(JOURNEY_STAGES.filter((stage) => stage.optional).map((stage) => stage.key));
  if (!off.every((key) => isJourneyStageKey(key) && optional.has(key))) {
    return { ok: false, error: "뺄 수 없는 단계가 있어요." };
  }
  if (!addOns.every(isJourneyAddOnKey)) return { ok: false, error: "넣을 수 없는 항목이 있어요." };
  return { ok: true, plan: parseJourneyPlan({ off, addOns }) };
}

export function journeyPlanSummary(plan: JourneyPlan): string {
  const off = JOURNEY_STAGES.filter((stage) => plan.off.includes(stage.key)).map((stage) => stage.title);
  const added = JOURNEY_ADD_ONS.filter((addOn) => plan.addOns.includes(addOn.key)).map((addOn) => addOn.title);
  const parts = [
    ...(off.length > 0 ? [`${off.join(", ")} 뺌`] : []),
    ...(added.length > 0 ? [`${added.join(", ")} 넣음`] : []),
  ];
  return parts.length > 0 ? `준비 순서: ${parts.join(", ")}` : "준비 순서: 기본 순서로 되돌림";
}

export function journeyPlansEqual(left: JourneyPlan, right: JourneyPlan): boolean {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  return same(left.off, right.off) && same(left.addOns, right.addOns);
}
