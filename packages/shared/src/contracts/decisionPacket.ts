/**
 * Decision Packet — 준비 건 하나의 "무엇을 정하는가"를 담는 의미 단위.
 * 예산·할 일·일정은 이 패킷의 투영이지 별개의 진실이 아니다.
 *
 * 저장소에는 이미 실행 축이 있다. `StoredAmoraPendingAction`의 `inputDigest`와
 * `operationKey`, `amora_shared_action_acceptances`의 `proposal_digest`·
 * `roster_fingerprint`, 그리고 mutation receipt가 "누가 무엇을 실행했는가"를
 * 붙잡는다. 비어 있던 것은 의미 축이다 — 무엇이 확인됐고, 무엇을 아직 모르고,
 * 그 근거가 어느 등급인지.
 *
 * 그 의미 축을 정규 문자열에 포함시키면 두 가지가 따라온다.
 *   1. 내용이 바뀌면 digest가 바뀌므로, 사용자가 보지 않은 버전의 승인은 무효다.
 *   2. 모르는 것이 남아 있으면 승인 요청 자체를 막을 수 있다.
 *
 * 해시는 여기서 계산하지 않는다. 클라이언트가 digest를 만들 수 있으면 아무 내용에나
 * 원하는 digest를 붙여 주장할 수 있으므로, 발급은 서버 전용 경로에 둔다. 이 모듈은
 * 웹과 앱이 함께 쓰는 순수 의미·검증 계층이다.
 */

export const DECISION_PACKET_VERSION = 1;

/**
 * 근거 등급. §5.4의 "확인된 사실 / 관행 / 제안 / 확인 필요를 섞지 않는다"를 타입으로
 * 만든 것이다. 사용자에게 그대로 설명할 수 있는 등급만 존재한다.
 */
export const DECISION_FACT_EVIDENCE_GRADES = [
  "confirmed_user",   // 사용자가 직접 확인해 준 값
  "user_document",    // 사용자가 올린 자료에서 읽은 값
  "public_source",    // 출처를 밝힐 수 있는 공개 자료
  "common_practice",  // 흔한 관행 — 판정이 아니다
  "amora_proposal",   // 아모라가 제안한 값 — 아직 사실이 아니다
] as const;

export type DecisionFactEvidence = (typeof DECISION_FACT_EVIDENCE_GRADES)[number];

/**
 * 결정을 뒷받침한다고 인정하는 등급. 공개 자료와 관행은 맥락이지 커플의 결정이
 * 아니고, 아모라의 제안은 더더욱 아니다.
 */
const CONFIRMING_EVIDENCE: ReadonlySet<DecisionFactEvidence> = new Set([
  "confirmed_user",
  "user_document",
]);

export const DECISION_SCOPES = ["owner_private", "couple_shared"] as const;
export type DecisionScope = (typeof DECISION_SCOPES)[number];

export interface DecisionFact {
  key: string;
  value: string;
  evidence: DecisionFactEvidence;
}

export interface DecisionUnknown {
  key: string;
  /** 사용자에게 그대로 물어볼 수 있는 문장. 내부 코드명을 노출하지 않는다. */
  question: string;
}

export interface DecisionPacketDraft {
  topic: string;
  scope: DecisionScope;
  ownerUserId: string;
  facts: readonly DecisionFact[];
  unknowns: readonly DecisionUnknown[];
}

export interface DecisionPacket {
  readonly version: typeof DECISION_PACKET_VERSION;
  readonly topic: string;
  readonly scope: DecisionScope;
  readonly ownerUserId: string;
  readonly facts: readonly DecisionFact[];
  readonly unknowns: readonly DecisionUnknown[];
}

export type DecisionApprovalGate =
  | { ok: true }
  | { ok: false; reason: "unresolved_unknowns"; unknownKeys: readonly string[] }
  | { ok: false; reason: "no_confirmed_facts" };

const MAX_KEY_CHARS = 64;
const MAX_VALUE_CHARS = 512;
const MAX_QUESTION_CHARS = 200;
const MAX_TOPIC_CHARS = 64;
const MAX_FACTS = 64;
const MAX_UNKNOWNS = 32;
const KEY_RE = /^[a-z][a-z0-9_]*$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > max) return null;
  return trimmed;
}

function normalizeKey(value: unknown): string | null {
  const text = boundedText(value, MAX_KEY_CHARS);
  return text !== null && KEY_RE.test(text) ? text : null;
}

function normalizeScope(value: unknown): DecisionScope | null {
  return typeof value === "string"
    && (DECISION_SCOPES as readonly string[]).includes(value)
    ? (value as DecisionScope)
    : null;
}

function normalizeFact(value: unknown): DecisionFact | null {
  if (!isRecord(value)) return null;
  const key = normalizeKey(value.key);
  const factValue = boundedText(value.value, MAX_VALUE_CHARS);
  const evidence = value.evidence;
  if (key === null || factValue === null) return null;
  if (typeof evidence !== "string") return null;
  if (!DECISION_FACT_EVIDENCE_GRADES.includes(evidence as DecisionFactEvidence)) {
    return null;
  }
  return { key, value: factValue, evidence: evidence as DecisionFactEvidence };
}

function normalizeUnknown(value: unknown): DecisionUnknown | null {
  if (!isRecord(value)) return null;
  const key = normalizeKey(value.key);
  const question = boundedText(value.question, MAX_QUESTION_CHARS);
  return key !== null && question !== null ? { key, question } : null;
}

function byKey(left: { key: string }, right: { key: string }): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

/**
 * 초안을 정규 패킷으로 만든다. 하나라도 설명할 수 없는 모양이면 `null`을 돌려주고
 * 넓은 쪽으로 기본값을 잡지 않는다 — 모르는 scope를 공유로 낙착시키는 것이 정확히
 * 커플 경계를 무너뜨리는 방식이다.
 */
export function normalizeDecisionPacket(draft: unknown): DecisionPacket | null {
  if (!isRecord(draft)) return null;

  const topic = boundedText(draft.topic, MAX_TOPIC_CHARS);
  if (topic === null || !KEY_RE.test(topic)) return null;

  const scope = normalizeScope(draft.scope);
  if (scope === null) return null;

  const ownerUserId = typeof draft.ownerUserId === "string"
    && UUID_RE.test(draft.ownerUserId)
    ? draft.ownerUserId.toLowerCase()
    : null;
  if (ownerUserId === null) return null;

  if (!Array.isArray(draft.facts) || draft.facts.length > MAX_FACTS) return null;
  if (!Array.isArray(draft.unknowns) || draft.unknowns.length > MAX_UNKNOWNS) return null;

  const facts: DecisionFact[] = [];
  for (const raw of draft.facts) {
    const fact = normalizeFact(raw);
    if (fact === null) return null;
    // 같은 key가 서로 다른 값으로 두 번 오면 어느 쪽이 사용자가 본 값인지 알 수 없다.
    if (facts.some((existing) => existing.key === fact.key)) return null;
    facts.push(fact);
  }

  const unknowns: DecisionUnknown[] = [];
  for (const raw of draft.unknowns) {
    const unknown = normalizeUnknown(raw);
    if (unknown === null) return null;
    if (unknowns.some((existing) => existing.key === unknown.key)) return null;
    // 이미 확인된 것을 동시에 모른다고 말할 수는 없다.
    if (facts.some((fact) => fact.key === unknown.key)) return null;
    unknowns.push(unknown);
  }

  return {
    version: DECISION_PACKET_VERSION,
    topic,
    scope,
    ownerUserId,
    facts: facts.sort(byKey),
    unknowns: unknowns.sort(byKey),
  };
}

/**
 * 서버가 digest를 만들 때 해싱할 정규 문자열. 같은 의미면 키 순서와 무관하게 같은
 * 문자열이 나오고, 사실 하나 또는 모르는 것 하나만 달라져도 달라진다.
 *
 * 이스케이프는 `JSON.stringify`로 한다. 저장소의 기존 정규화기
 * (`canonicalAmoraToolInput`)와 같은 방식이라는 점이 첫째 이유고, 둘째 이유는 이것이
 * 전역 함수라는 점이다. `encodeURIComponent`는 짝 없는 서로게이트(잘린 이모지 반쪽)에
 * URIError를 던지는데, 그런 문자열은 `normalizeDecisionPacket`을 통과한다 — 검증기가
 * 통과시킨 값을 정규화기가 처리하지 못하면 승인 자체가 영영 발급되지 않는다.
 * `JSON.stringify`는 그것을 `\\ud83d`로 이스케이프하며 절대 던지지 않는다.
 *
 * 값이 따옴표 안에 들어가므로 구분자 `:`와 `,`가 값에 섞여도 경계가 흐려지지 않는다.
 */
export function canonicalizeDecisionPacket(packet: DecisionPacket): string {
  const facts = packet.facts
    .map((fact) => [fact.key, fact.value, fact.evidence]
      .map((part) => JSON.stringify(part))
      .join(":"))
    .join(",");
  // 질문 문장까지 넣는 이유: 같은 key라도 다르게 물으면 사용자가 답한 대상이 다르다.
  const unknowns = packet.unknowns
    .map((unknown) => [unknown.key, unknown.question]
      .map((part) => JSON.stringify(part))
      .join(":"))
    .join(",");

  return [
    `v${packet.version}`,
    `topic=${JSON.stringify(packet.topic)}`,
    `scope=${packet.scope}`,
    `owner=${packet.ownerUserId}`,
    `facts=[${facts}]`,
    `unknowns=[${unknowns}]`,
  ].join("\n");
}

/**
 * 승인 버튼을 띄워도 되는지 판단한다.
 *
 * 모르는 채로 승인을 받는 것이 가장 흔한 신뢰 위반이다. 사용자는 "네"를 눌렀지만
 * 자기가 무엇에 동의했는지 몰랐고, 나중에 예산이 어긋난다. 그래서 미확인 항목이
 * 남아 있으면 승인 단계로 넘어가지 않고 질문 단계로 되돌린다.
 */
export function canRequestApproval(packet: DecisionPacket): DecisionApprovalGate {
  if (packet.unknowns.length > 0) {
    return {
      ok: false,
      reason: "unresolved_unknowns",
      unknownKeys: packet.unknowns.map((unknown) => unknown.key),
    };
  }

  const hasConfirmedFact = packet.facts.some(
    (fact) => CONFIRMING_EVIDENCE.has(fact.evidence),
  );
  if (!hasConfirmedFact) return { ok: false, reason: "no_confirmed_facts" };

  return { ok: true };
}
