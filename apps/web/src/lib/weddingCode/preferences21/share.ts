import { ITEMS21, VERSIONS, parseAnswers } from "./bank";
import { AGREEMENT_COPY, buildSafeSummary } from "./report";
import type { Answers, ItemId } from "./types";
import {
  PREFERENCES21_RETENTION_MS, hasPreferences21ExactKeys, hasPreferences21Versions,
  isPreferences21PlainObject, parsePreferences21BoundedJson,
} from "./storage";

export const PREFERENCES21_SHARE_NAMESPACE = "wc-preferences21";
export const PREFERENCES21_SHARE_TTL_MS = PREFERENCES21_RETENTION_MS;
export const PREFERENCES21_MAX_SHARE_LENGTH = 12_000;
type NonFamilyItemId = Exclude<ItemId, "Q13" | "Q14" | "Q15" | "Q16">;
const SAFE_IDS = ITEMS21.filter((item) => item.topicId !== "C").map((item) => item.id);
const FAMILY_IDS: readonly ItemId[] = ["Q13", "Q14", "Q15", "Q16"];
const VERSION_KEYS = ["questionnaireVersion", "interpretationVersion", "displayVersion"] as const;
const COMMON_KEYS = ["schemaVersion", "kind", ...VERSION_KEYS, "createdAt", "expiresAt"];
type Header = Readonly<typeof VERSIONS & { schemaVersion: 1; createdAt: number; expiresAt: number }>;
export type Preferences21FriendCard = Readonly<{
  headline: string;
  summary: string;
  lines: readonly Readonly<{ itemId: NonFamilyItemId; text: string }>[];
}>;
export type Preferences21SummaryShare = Header & Readonly<{
  kind: "summary";
  summaryItemIds: readonly NonFamilyItemId[];
  card: Preferences21FriendCard;
}>;
export type Preferences21PartnerInvitation = Header & Readonly<{ kind: "partner-invitation"; answers: Answers }>;
export type Preferences21PartnerReturn = Header & Readonly<{
  kind: "partner-return";
  first: Preferences21PartnerInvitation;
  second: Readonly<typeof VERSIONS & { answers: Answers; createdAt: number; expiresAt: number }>;
}>;
export type Preferences21SharePayload = Preferences21SummaryShare | Preferences21PartnerInvitation | Preferences21PartnerReturn;
export type Preferences21ShareRead =
  | { status: "ready"; payload: Preferences21SharePayload; notice: string }
  | { status: "absent" | "invalid" | "expired" | "version-mismatch"; notice: string };
type ParseFailure = Extract<Preferences21ShareRead, { status: "absent" | "invalid" | "expired" | "version-mismatch" }>;

function invalid(): ParseFailure {
  return { status: "invalid", notice: "이 21문항 링크의 형식을 확인하지 못했어요. 주소가 끝까지 복사됐는지 확인해 주세요." };
}

function safeId(value: unknown): value is NonFamilyItemId {
  return typeof value === "string" && SAFE_IDS.some((id) => id === value) && !FAMILY_IDS.some((id) => id === value);
}

function freezeAnswers(answers: Answers): Answers { return Object.freeze({ ...answers }); }

function cardFromIds(ids: readonly NonFamilyItemId[]): Preferences21FriendCard {
  return Object.freeze({
    headline: "내 결혼 준비 선호",
    summary: ids.length > 0
      ? "내가 대체로 또는 아주 잘 맞는다고 답한 준비 방식을 골라 담았어요."
      : "공유할 구체적인 선호를 아직 고르지 않았어요.",
    lines: Object.freeze(ids.map((itemId) => Object.freeze({ itemId, text: AGREEMENT_COPY[itemId] }))),
  });
}

/** 본인 답의 비가족 선호 요약만 만든다. 원답·상대 답·가족 정보는 카드에 넣지 않는다. */
export function buildPreferences21FriendCard(ownAnswers: unknown): Preferences21FriendCard | null {
  const answers = parseAnswers(ownAnswers);
  if (!answers) return null;
  const summary = buildSafeSummary(answers);
  return cardFromIds(summary.lines.map((line) => line.itemId));
}

function encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function decode(token: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/u.test(token) || token.length > PREFERENCES21_MAX_SHARE_LENGTH) return null;
  try {
    const binary = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    return encode(text) === token ? text : null;
  } catch { return null; }
}

function headerFailure(value: Record<string, unknown>, now: number, fullLifetime: boolean): ParseFailure | null {
  if (value.schemaVersion !== 1 || !VERSION_KEYS.every((key) => typeof value[key] === "string")) return invalid();
  if (!hasPreferences21Versions(value)) {
    return { status: "version-mismatch", notice: "문항·해석·표시 판이 다른 링크예요. 현재 21문항 답으로 바꿔 읽거나 직접 비교하지 않아요." };
  }
  if (!Number.isSafeInteger(now) || now < 0
    || typeof value.createdAt !== "number" || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0 || value.createdAt > now
    || typeof value.expiresAt !== "number" || !Number.isSafeInteger(value.expiresAt)
    || value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > PREFERENCES21_SHARE_TTL_MS
    || (fullLifetime && value.expiresAt - value.createdAt !== PREFERENCES21_SHARE_TTL_MS)) return invalid();
  if (now >= value.expiresAt) return { status: "expired", notice: "이 21문항 링크의 30일 이용 기간이 지났어요. 본인이 새로 공유한 링크를 받아 주세요." };
  return null;
}

function header(value: Record<string, unknown>): Header | null {
  if (!hasPreferences21Versions(value) || typeof value.createdAt !== "number" || typeof value.expiresAt !== "number") return null;
  return { schemaVersion: 1, ...VERSIONS, createdAt: value.createdAt, expiresAt: value.expiresAt };
}

function parseInvitation(value: unknown, now: number): Preferences21PartnerInvitation | ParseFailure {
  if (!isPreferences21PlainObject(value) || value.kind !== "partner-invitation"
    || !hasPreferences21ExactKeys(value, [...COMMON_KEYS, "answers"])) return invalid();
  const failure = headerFailure(value, now, true);
  if (failure) return failure;
  const versions = header(value);
  const answers = parseAnswers(value.answers);
  if (!versions || !answers) return invalid();
  return Object.freeze({ ...versions, kind: "partner-invitation", answers: freezeAnswers(answers) });
}

function parsePayload(value: unknown, now: number): Preferences21ShareRead {
  if (!isPreferences21PlainObject(value)) return invalid();
  if (value.kind === "partner-invitation") {
    const invite = parseInvitation(value, now);
    if ("status" in invite) return invite;
    return { status: "ready", payload: invite, notice: "링크를 가진 사람은 보낸 분이 동의한 원답을 볼 수 있어요. 받은 답은 본인 답으로 저장하지 않아요." };
  }
  if (value.kind === "summary") {
    if (!hasPreferences21ExactKeys(value, [...COMMON_KEYS, "summaryItemIds"])) return invalid();
    const failure = headerFailure(value, now, true);
    if (failure) return failure;
    const versions = header(value);
    if (!versions || !Array.isArray(value.summaryItemIds) || value.summaryItemIds.length > SAFE_IDS.length
      || !value.summaryItemIds.every(safeId) || new Set(value.summaryItemIds).size !== value.summaryItemIds.length) return invalid();
    const ids = Object.freeze([...value.summaryItemIds]);
    return { status: "ready", payload: Object.freeze({ ...versions, kind: "summary", summaryItemIds: ids, card: cardFromIds(ids) }),
      notice: "공유된 본인 선호 요약이에요. 원답·가족 문항·상대 답은 담지 않았어요." };
  }
  if (value.kind === "partner-return") {
    if (!hasPreferences21ExactKeys(value, [...COMMON_KEYS, "first", "second"])) return invalid();
    const failure = headerFailure(value, now, false);
    if (failure) return failure;
    const versions = header(value);
    const first = parseInvitation(value.first, now);
    if ("status" in first) return first;
    const second = value.second;
    if (!versions || !isPreferences21PlainObject(second)
      || !hasPreferences21ExactKeys(second, [...VERSION_KEYS, "answers", "createdAt", "expiresAt"])) return invalid();
    if (!hasPreferences21Versions(second)) return { status: "version-mismatch", notice: "두 사람이 답한 판이 달라 직접 비교할 수 없어요." };
    const answers = parseAnswers(second.answers);
    if (!answers || second.createdAt !== versions.createdAt || second.expiresAt !== first.expiresAt
      || versions.expiresAt !== first.expiresAt || versions.createdAt < first.createdAt) return invalid();
    return { status: "ready", payload: Object.freeze({ ...versions, kind: "partner-return", first,
      second: Object.freeze({ ...VERSIONS, answers: freezeAnswers(answers), createdAt: versions.createdAt, expiresAt: first.expiresAt }) }),
      notice: "각자가 공유를 허용한 실제 답을 나란히 볼 수 있어요. 두 사람이 합의한 사실이나 궁합 점수는 아니에요." };
  }
  return invalid();
}

function toFragment(payload: unknown, now: number): string | null {
  try {
    const raw = JSON.stringify(payload);
    const checked = parsePayload(parsePreferences21BoundedJson(raw), now);
    if (checked.status !== "ready") return null;
    const token = encode(raw);
    return token.length <= PREFERENCES21_MAX_SHARE_LENGTH ? `#${PREFERENCES21_SHARE_NAMESPACE}=${token}` : null;
  } catch { return null; }
}

export function createPreferences21ShareFragment(
  input: { kind: "summary"; answers: unknown } | { kind: "partner-invitation"; answers: unknown; consent: boolean },
  now = Date.now(),
): string | null {
  const answers = parseAnswers(input.answers);
  if (!answers || !Number.isSafeInteger(now) || now < 0) return null;
  const base = { schemaVersion: 1, ...VERSIONS, createdAt: now, expiresAt: now + PREFERENCES21_SHARE_TTL_MS };
  if (input.kind === "summary") {
    const card = buildPreferences21FriendCard(answers);
    return card ? toFragment({ ...base, kind: "summary", summaryItemIds: card.lines.map((line) => line.itemId) }, now) : null;
  }
  if (input.kind !== "partner-invitation" || input.consent !== true) return null;
  return toFragment({ ...base, kind: "partner-invitation", answers }, now);
}

/** 받은 초대는 그대로 둔다. 본인 원답에 새로 동의했을 때만 반환 링크를 만든다. */
export function createPreferences21ReturnFragment(
  receivedInvitation: Preferences21PartnerInvitation,
  ownAnswers: unknown,
  options: { consent: boolean; now?: number },
): string | null {
  if (options.consent !== true) return null;
  const now = options.now ?? Date.now();
  const original = parseInvitation(receivedInvitation, now);
  const answers = parseAnswers(ownAnswers);
  if ("status" in original || !answers) return null;
  return toFragment({ schemaVersion: 1, kind: "partner-return", ...VERSIONS, createdAt: now, expiresAt: original.expiresAt,
    first: original, second: { ...VERSIONS, answers, createdAt: now, expiresAt: original.expiresAt } }, now);
}

export function parsePreferences21ShareFragment(hash: string, now = Date.now()): Preferences21ShareRead {
  if (!hash || hash === "#") return { status: "absent", notice: "" };
  const prefix = `#${PREFERENCES21_SHARE_NAMESPACE}=`;
  if (!hash.startsWith(prefix)) return hash.includes(PREFERENCES21_SHARE_NAMESPACE) ? invalid() : { status: "absent", notice: "" };
  if (hash.length > PREFERENCES21_MAX_SHARE_LENGTH + prefix.length) return invalid();
  const raw = decode(hash.slice(prefix.length));
  return raw === null ? invalid() : parsePayload(parsePreferences21BoundedJson(raw), now);
}
