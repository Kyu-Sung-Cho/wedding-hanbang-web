import { WEDDING_CODE_V12_QUESTIONS, WEDDING_CODE_V12_VERSION } from "@/constants/weddingCodeV12";
import { decodeWeddingCodeV06, encodeWeddingCodeV06 } from "./v06/code";

export const PREPARATION_STYLE_CONSENT_VERSION = "2026-09-20";
export const PREPARATION_STYLE_SAVE_CONSENT_VERSION = PREPARATION_STYLE_CONSENT_VERSION;
export const PREPARATION_STYLE_SHARE_CONSENT_VERSION = PREPARATION_STYLE_CONSENT_VERSION;
export const PREPARATION_STYLE_OWNER_HEADER = "X-Wedding-Style-Expected-Owner";
export type PreparationStyleResponse = Readonly<{
  sceneVersion: typeof WEDDING_CODE_V12_VERSION;
  answerCode: string;
  revision: number;
  savedAt: string;
}>;
export type PreparationStyleSavedResponse = PreparationStyleResponse;
export type PreparationStyleSnapshot = Readonly<{
  ownerUserId: string;
  stateRevision: number | null;
  coupleId: string | null;
  partnerUserId: string | null;
  own: PreparationStyleResponse | null;
  sharing: Readonly<{ responseRevision: number; sharedAt: string }> | null;
  partner: PreparationStyleResponse | null;
}>;
export function isPreparationStyleRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function hasPreparationStyleKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function isPreparationStyleId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export function isPreparationStyleRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
/** 계정 보관은 현행 판의 실제 보기만 허용한다. 받은 링크의 정규화/구판 추론은 쓰지 않는다. */
export function isPreparationStyleAnswer(sceneVersion: unknown, answerCode: unknown): answerCode is string {
  if (sceneVersion !== WEDDING_CODE_V12_VERSION || typeof answerCode !== "string") return false;
  const answers = decodeWeddingCodeV06(answerCode, WEDDING_CODE_V12_QUESTIONS);
  return answers !== null && encodeWeddingCodeV06(answers, WEDDING_CODE_V12_QUESTIONS) === answerCode;
}
function isTime(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}
export function parsePreparationStyleResponse(value: unknown): PreparationStyleResponse | null {
  if (!isPreparationStyleRecord(value) || !hasPreparationStyleKeys(value, ["sceneVersion", "answerCode", "revision", "savedAt"])) return null;
  if (!isPreparationStyleAnswer(value.sceneVersion, value.answerCode) || !isPreparationStyleRevision(value.revision) || !isTime(value.savedAt)) return null;
  return { sceneVersion: WEDDING_CODE_V12_VERSION, answerCode: value.answerCode, revision: value.revision, savedAt: value.savedAt };
}
/** 잘못된 서버 응답을 저장/공유 성공으로 보이게 하지 않는다. */
export function parsePreparationStyleSnapshot(value: unknown): PreparationStyleSnapshot | null {
  if (!isPreparationStyleRecord(value) || !hasPreparationStyleKeys(value, ["ownerUserId", "stateRevision", "coupleId", "partnerUserId", "own", "sharing", "partner"])) return null;
  if (value.stateRevision !== null && !isPreparationStyleRevision(value.stateRevision)) return null;
  if (!isPreparationStyleId(value.ownerUserId) || (value.coupleId !== null && !isPreparationStyleId(value.coupleId)) || (value.partnerUserId !== null && !isPreparationStyleId(value.partnerUserId))) return null;
  if ((value.partnerUserId !== null && value.coupleId === null) || value.partnerUserId === value.ownerUserId) return null;
  const own = value.own === null ? null : parsePreparationStyleResponse(value.own);
  const partner = value.partner === null ? null : parsePreparationStyleResponse(value.partner);
  if ((value.own !== null && !own) || (value.partner !== null && !partner)) return null;
  if (own && own.revision !== value.stateRevision) return null;
  let sharing: PreparationStyleSnapshot["sharing"] = null;
  if (value.sharing !== null) {
    if (!isPreparationStyleRecord(value.sharing) || !hasPreparationStyleKeys(value.sharing, ["responseRevision", "sharedAt"]) || !isPreparationStyleRevision(value.sharing.responseRevision) || !isTime(value.sharing.sharedAt)) return null;
    if (!own || !value.partnerUserId || value.sharing.responseRevision !== own.revision) return null;
    sharing = { responseRevision: value.sharing.responseRevision, sharedAt: value.sharing.sharedAt };
  }
  if (partner && (!sharing || !own || partner.sceneVersion !== own.sceneVersion)) return null;
  return { ownerUserId: value.ownerUserId, stateRevision: value.stateRevision, coupleId: value.coupleId, partnerUserId: value.partnerUserId, own, sharing, partner };
}
