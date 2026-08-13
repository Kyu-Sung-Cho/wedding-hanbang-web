import { MANNERS_PARTS } from "./data";
import {
  parseMannersAmoraSlug,
  type MannersAmoraSlug,
} from "./amoraContract";
import type { MannersSourceKind } from "./types";

export type MannersAmoraSourceRef = Readonly<{
  ref: number;
  kind: MannersSourceKind;
  label: string;
  url: string;
  checkedAt: string;
  scope: string;
  supports: string;
}>;

/**
 * 채팅 API가 검증된 예절 문맥을 구성할 때 사용하는 최소 계약.
 *
 * query의 값은 slug 선택에만 쓰고, 나머지는 모두 저장소의 canonical corpus에서 읽는다.
 * 사용자의 구체적 상황은 기존 인증된 채팅 본문과 커플 context에서 별도로 받아야 한다.
 */
export type MannersAmoraContext = Readonly<{
  kind: "verified_manners_guide";
  version: 1;
  slug: MannersAmoraSlug;
  title: string;
  summary: readonly string[];
  caveat: string;
  sourceRefs: readonly MannersAmoraSourceRef[];
}>;

function isMannersSourceKind(value: unknown): value is MannersSourceKind {
  return value === "official" || value === "original" || value === "secondary";
}

export function resolveMannersAmoraContext(rawSlug: unknown): MannersAmoraContext | null {
  const slug = parseMannersAmoraSlug(rawSlug);
  if (!slug) return null;

  const part = MANNERS_PARTS.find((candidate) => candidate.slug === slug);
  if (!part) return null;
  // Generated corpus drift must not silently downgrade or omit provenance in
  // an AI turn. The UI/data contract may catch this earlier, but the server
  // resolver remains independently fail-closed at the trust boundary.
  if (!part.sources.every((source) => isMannersSourceKind(source.kind))) return null;

  return {
    kind: "verified_manners_guide",
    version: 1,
    slug,
    title: part.title,
    summary: [...part.summary],
    caveat: part.caveat,
    sourceRefs: part.sources.map((source, index) => ({
      ref: index + 1,
      kind: source.kind,
      label: source.label,
      url: source.url,
      checkedAt: source.checkedAt,
      scope: source.scope,
      supports: source.supports,
    })),
  };
}
