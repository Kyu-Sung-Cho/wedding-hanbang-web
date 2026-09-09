import { hasAmoraOtherDomainTopicSignal } from "./amoraBoundedContinuity";
import { hasAmoraSafetySignal } from "./amoraQuestionScope";
import { speakerLabelFor } from "./speakerLabels";

type PlanningRow = {
  id: string;
  role: string;
  content: string;
  sender_id: string | null;
  sender_type: string;
  visibility: string;
  segment_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type AmoraPlanningTurnInput = {
  requestKind: string;
  durable: boolean;
  scope: string;
  allowsStoredProviderContext: boolean;
  preparationStatus: string | null;
  hasPriorityAction: boolean;
  hasAttachments: boolean;
  actorId: string;
  currentUserMessageId: string;
  currentUserText: string;
  oldestFirstRows: readonly PlanningRow[];
  providerMessages: readonly { id?: string; role: string; content: string }[];
};

const STORED_SCOPES = new Set(["W0_wedding_core", "W1_wedding_adjacent"]);
const QUOTED = /["'“”‘’「」『』`]|(?:^|\n)\s*>/u;
const INDIRECT = /만약|가정|예를\s*들|(?:라면|다면)|친구가|친구는|동료가|동료는|라고\s*(?:했|말했|하더|전했)|다고\s*(?:했|말했|하더|전했)/u;
const STOP = /그냥\s*들어|듣기만|말하기\s*싫|이유.{0,20}(?:묻지|말하지|그만)|캐묻|취소|파혼|연기|중단|미루/u;
const NEW_REQUEST = /(?:해|봐|찾아|알려|써|골라|비교해|정리해)\s*(?:줘|주세|주실|줄래)|검색|저장|반영|적용|승인|초안|예약|결제|등록/u;
const CHANGE = /바꾸|바꿀|바뀌|변경|전환|줄일|줄이|늘릴|늘리|말고/u;
const NEGATED_CHANGE = /(?:바꾸|바꿀|변경|전환|줄이|줄일|늘리|늘릴).{0,18}(?:않|아니|없)/u;
const WEDDING = /결혼식|예식|웨딩|하객|가족식/u;
const FORMAT = /가족식|일반\s*웨딩|소규모\s*(?:예식|결혼식)|스몰\s*웨딩|야외\s*(?:예식|결혼식)|성당\s*(?:예식|결혼식)/u;

function plainDirectText(text: string): boolean {
  return text.trim().length > 0 && !QUOTED.test(text) && !INDIRECT.test(text)
    && !STOP.test(text) && !hasAmoraSafetySignal(text)
    && !hasAmoraOtherDomainTopicSignal(text);
}

type ChangeKind = "format" | "region" | "guests";
const CHANGE_TARGETS: Record<ChangeKind, string> = {
  format: `(?:${FORMAT.source}|(?:결혼식|예식|웨딩)\\s*(?:형식|방식|형태))`,
  region: "(?:결혼식|예식|웨딩)\\s*(?:지역|권역|도시)",
  guests: "하객\\s*(?:수|인원|규모)?",
};

function largePracticalChanges(text: string): Set<ChangeKind> {
  const kinds = new Set<ChangeKind>();
  if (NEGATED_CHANGE.test(text) || givesReason(text)) return kinds;
  for (const sentence of text.split(/[.!?？\n]/u)) {
    // 현재 화자의 직접 선택만 받는다. 다른 사람의 계획을 전달한 선언은 제외한다.
    if (!WEDDING.test(sentence) || !CHANGE.test(sentence)
      || !/(?:할래|할게|바꿀래|바꿀게|줄일래|줄일게|늘릴래|늘릴게)(?:요)?\s*$/u.test(sentence)) continue;
    if (FORMAT.test(sentence) && /바꾸|바꿀|변경|전환|말고/u.test(sentence)) kinds.add("format");
    if (new RegExp(CHANGE_TARGETS.region, "u").test(sentence)
      && /바꾸|바꿀|변경|전환/u.test(sentence)) kinds.add("region");
    // 인원은 큰 전환 여부만 판단한다. 추출값을 프롬프트·저장·권한에 전달하지 않는다.
    const counts = [...sentence.matchAll(/(?<![\d,])([1-9]\d{0,4})\s*명/gu)].map(match => Number(match[1]));
    if (counts.length === 2 && /줄일|줄이|늘릴|늘리|말고/u.test(sentence)
      && (counts[1] <= counts[0] / 2 || counts[1] >= counts[0] * 2)) kinds.add("guests");
  }
  return kinds;
}

function asksReasonForChange(text: string, kinds: ReadonlySet<ChangeKind>): boolean {
  if (/(?:제가|내가|아모라가)\s*(?:제안|추천)|이미\s*(?:들었|말했)/u.test(text)) return false;
  const changed = "(?:바꾸신|바꾼|변경한|전환한|줄인|늘린|바꾸게\\s*된)";
  return text.split(/[.!\n]/u).some(sentence =>
    /[?？]|여쭤|물어|알려.{0,12}(?:주실|주세요|줄래)/u.test(sentence)
    && [...kinds].some(kind => new RegExp(
      `${CHANGE_TARGETS[kind]}(?:으로|로|을|를)?\\s*${changed}\\s*(?:이유|계기)`, "u",
    ).test(sentence)));
}

function givesReason(text: string): boolean {
  return !/[?？]/u.test(text) && !NEW_REQUEST.test(text)
    && !/이미\s*(?:말했|얘기했)|앞에서\s*(?:말했|얘기했)/u.test(text)
    && !/때문.{0,12}(?:아니|않)/u.test(text)
    && /때문(?:이|에)|서\s*(?:그래|그렇|야|요)(?:[.!\s]|$)/u.test(text);
}

function providerBodyMatches(row: PlanningRow, content: string): boolean {
  if (content === row.content) return true;
  if (row.role !== "user") return false;
  return [false, true].some(neutral => content === `[${speakerLabelFor({
    neutral, isSelf: true, senderType: row.sender_type,
  })}] ${row.content}`);
}

/** 서버 정본과 이미 선택된 provider 입력이 증명하는 인접 후속만 선택한다. */
export function getAmoraPlanningTurn(input: AmoraPlanningTurnInput): "pivot_reason_followup" | null {
  if (input.requestKind !== "chat" || !input.durable || !STORED_SCOPES.has(input.scope)
    || !input.allowsStoredProviderContext || input.preparationStatus !== "preparing"
    || input.hasPriorityAction || input.hasAttachments || !input.actorId || !input.currentUserMessageId
    || input.oldestFirstRows.length < 3 || input.providerMessages.length < 3) return null;

  const rows = input.oldestFirstRows.slice(-3);
  const [prior, assistant, current] = rows;
  if (new Set(input.oldestFirstRows.map(row => row.id)).size !== input.oldestFirstRows.length
    || rows.some(row => !row.id || !row.content.trim())
    || prior.role !== "user" || current.role !== "user" || assistant.role !== "assistant"
    || prior.sender_type === "ai" || current.sender_type === "ai" || assistant.sender_type !== "ai"
    || prior.sender_id !== input.actorId || current.sender_id !== input.actorId || assistant.sender_id !== null
    || current.id !== input.currentUserMessageId || current.content !== input.currentUserText
    || assistant.metadata?.in_reply_to_user_message_id !== prior.id
    || rows.some(row => row.metadata?.target === "partner")
    || !["shared", "bride_private", "groom_private"].includes(current.visibility)
    || rows.some(row => row.visibility !== current.visibility)
    || rows.some(row => (row.segment_id ?? null) !== (current.segment_id ?? null))) return null;

  const messages = input.providerMessages.slice(-3);
  if (rows.some((row, index) => messages[index].id !== row.id
    || messages[index].role !== row.role || !providerBodyMatches(row, messages[index].content))) return null;

  if (!rows.every(row => plainDirectText(row.content))
    || !asksReasonForChange(assistant.content, largePracticalChanges(prior.content))
    || !givesReason(current.content)) return null;
  return "pivot_reason_followup";
}
