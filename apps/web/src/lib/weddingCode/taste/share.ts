import { isWeddingTasteVersion } from "./constants";
import { hasWeddingTasteAnswers, parseWeddingTasteDraft } from "./validation";
import type { WeddingTasteDraft } from "./types";

export const WEDDING_TASTE_MAX_TOKEN_LENGTH = 3_000;
export const WEDDING_TASTE_MAX_HASH_LENGTH = 8_192;
export function encodeWeddingTasteDraft(input: WeddingTasteDraft): string {
  const draft = parseWeddingTasteDraft(input);
  if (!draft || !hasWeddingTasteAnswers(draft)) throw new Error("공유할 선택이 없거나 형식을 확인하지 못했어요.");
  const token = btoa(JSON.stringify(draft)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (token.length > WEDDING_TASTE_MAX_TOKEN_LENGTH) throw new Error("공유할 선택이 너무 길어요.");
  return token;
}
export function decodeWeddingTasteDraft(token: string): WeddingTasteDraft | null {
  if (!token || token.length > WEDDING_TASTE_MAX_TOKEN_LENGTH || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const raw: unknown = JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/")));
    const draft = parseWeddingTasteDraft(raw);
    if (!draft || !hasWeddingTasteAnswers(draft) || encodeWeddingTasteDraft(draft) !== token) return null;
    return draft;
  } catch { return null; }
}
export function buildWeddingTasteShareUrl({ origin, first, second }: {
  origin: string; first: WeddingTasteDraft; second?: WeddingTasteDraft | null;
}): string {
  if (second && first.version !== second.version) throw new Error("같은 질문에 답한 취향만 함께 공유할 수 있어요.");
  const base = new URL(origin);
  if (!["https:", "http:"].includes(base.protocol) || base.username || base.password) throw new Error("공유 주소를 확인하지 못했어요.");
  const params = new URLSearchParams({ v: first.version, a: encodeWeddingTasteDraft(first) });
  if (second) params.set("b", encodeWeddingTasteDraft(second));
  return base.origin + "/wedding-code/taste#" + params.toString();
}
export function decodeWeddingTasteShareHash(hash: string): { first: WeddingTasteDraft; second: WeddingTasteDraft | null } | null {
  if (!hash || hash.length > WEDDING_TASTE_MAX_HASH_LENGTH) return null;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  if ([...params.keys()].some(key => !["v", "a", "b"].includes(key))
    || params.getAll("v").length !== 1 || params.getAll("a").length !== 1 || params.getAll("b").length > 1
    || !isWeddingTasteVersion(params.get("v"))) return null;
  const first = decodeWeddingTasteDraft(params.get("a") ?? "");
  if (!first || first.version !== params.get("v")) return null;
  const second = params.has("b") ? decodeWeddingTasteDraft(params.get("b") ?? "") : null;
  if (params.has("b") && (!second || second.version !== first.version)) return null;
  return { first, second };
}
