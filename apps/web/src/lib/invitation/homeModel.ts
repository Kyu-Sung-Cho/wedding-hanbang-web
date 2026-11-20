import {
  conditionYearMonth,
  conditionsSummary,
  type AmoraUpdate,
  type DecisionItem,
  type HomeModel,
  type InvitationConditions,
  type InvitationFacts,
  type JourneyFacts,
  type PersonChip,
} from "@hanbang/shared/invitation";
import type { AmoraActionItem } from "@/lib/amora/actions";
import type { CoupleContext, CoupleMember } from "./coupleContext";
import { LIVE_COPY } from "./liveCopy";

/**
 * 청첩장 홈(HomeModel)과 준비 순서(JourneyFacts)를 저장된 사실로만 만든다.
 * 이름은 프로필, 날짜·식장은 `wedding_journeys`, 희망 시기·시간대는 조건(W1)에서 온다. 없는 칸은 빈칸이다.
 */

const MAX_DECISIONS = 4;
const MAX_SUB_CHARS = 40;

function chip(member: CoupleMember, fallback: string): PersonChip {
  const name = member.name ?? fallback;
  return { initial: Array.from(name)[0] ?? "", name };
}

/** 커플 표의 자리 순서로 두 사람. 두 사람이 같은 청첩장을 본다. */
export function peopleChips(context: CoupleContext): PersonChip[] {
  return context.members
    .filter((member) => member.id === context.viewer.id || context.partnerJoined)
    .map((member) => chip(member, member.id === context.viewer.id ? "나" : LIVE_COPY.partnerFallback));
}

export function invitationFacts(context: CoupleContext, conditions: InvitationConditions): InvitationFacts {
  const names = context.members
    .filter((member) => member.id === context.viewer.id || context.partnerJoined)
    .map((member) => member.name);
  const weddingDate = context.journey?.weddingDate ?? null;
  const exact = weddingDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(weddingDate) : null;
  const yearMonth = conditionYearMonth(conditions, weddingDate);
  return {
    firstName: names[0] ?? null,
    secondName: names[1] ?? null,
    year: yearMonth?.year ?? null,
    month: yearMonth?.month ?? null,
    day: exact ? Number(exact[3]) : null,
    timeLabel: conditions.timeLabel,
    venueName: context.journey?.venue ?? null,
  };
}

function actionSub(action: AmoraActionItem): string | null {
  const description = action.description?.split("\n")[0]?.trim();
  if (description) {
    const chars = Array.from(description);
    return chars.length > MAX_SUB_CHARS ? `${chars.slice(0, MAX_SUB_CHARS - 1).join("")}…` : description;
  }
  const due = action.dueDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(action.dueDate) : null;
  return due ? `${Number(due[2])}월 ${Number(due[3])}일까지` : null;
}

/** 함께 쓰는 할 일. 담당자 칸이 아직 없어 모두 "함께"로 둔다. */
export function actionDecisions(actions: readonly AmoraActionItem[]): DecisionItem[] {
  return actions
    .filter((action) => action.status === "open")
    .map((action) => ({
      id: `action-${action.id}`,
      title: action.title,
      sub: actionSub(action),
      owner: { kind: "together" } as const,
      target: null,
    }));
}

export function buildHomeModel(input: {
  context: CoupleContext;
  conditions: InvitationConditions;
  update: AmoraUpdate | null;
  inquiryDecisions: readonly DecisionItem[];
  actions: readonly AmoraActionItem[];
}): HomeModel {
  return {
    people: peopleChips(input.context),
    invitation: invitationFacts(input.context, input.conditions),
    update: input.update,
    decisions: [...input.inquiryDecisions, ...actionDecisions(input.actions)].slice(0, MAX_DECISIONS),
  };
}

export function buildJourneyFacts(input: {
  context: CoupleContext;
  conditions: InvitationConditions;
  shortlistCount: number;
}): JourneyFacts {
  const venue = input.context.journey?.venue ?? null;
  return {
    conditionsSummary: conditionsSummary(input.conditions, input.context.journey?.weddingDate ?? null),
    partnerName: input.context.partnerJoined ? input.context.partner?.name ?? LIVE_COPY.partnerFallback : null,
    venueSummary: venue ?? (input.shortlistCount > 0 ? LIVE_COPY.venueInProgress(input.shortlistCount) : null),
    venueChosen: venue !== null,
  };
}
