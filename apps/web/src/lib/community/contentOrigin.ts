import type { CommunityContentOrigin } from "@/types/community.types";

export type ContentOriginPresentation = {
  label: string;
  description: string;
  className: string;
};

const CONTENT_ORIGIN_VALUES: ReadonlySet<CommunityContentOrigin> = new Set([
  "member",
  "operator",
  "ai",
  "industry_professional",
  "legacy_unverified",
]);

const CONTENT_ORIGIN_PRESENTATION: Record<
  CommunityContentOrigin,
  ContentOriginPresentation
> = {
  member: {
    label: "일반 회원 · 경험 미인증",
    description:
      "일반 회원이 작성했으며 결혼 준비 경험이나 내용의 사실 여부를 별도로 인증하지 않았어요.",
    className: "border-[#d9d4ce] bg-[#faf9f7] text-[var(--hb-text-body)]",
  },
  operator: {
    label: "웨딩한방 운영팀",
    description: "웨딩한방 운영팀 계정이 직접 작성한 내용이에요.",
    className: "border-[#b8cbc5] bg-[#eef4f1] text-[var(--hb-text-strong)]",
  },
  ai: {
    label: "AI 생성",
    description:
      "웨딩한방의 AI가 생성한 내용이에요. 중요한 결정 전에는 원문과 계약 조건을 다시 확인해 주세요.",
    className: "border-[#c8b9d7] bg-[#f5f0f8] text-[#655372]",
  },
  industry_professional: {
    label: "업계 종사자",
    description:
      "웨딩 업계 종사자 계정이 작성했어요. 소속이나 이해관계는 글의 광고·협찬 표시도 함께 확인해 주세요.",
    className: "border-[#d8c7ad] bg-[#fff8ec] text-[#8a642f]",
  },
  legacy_unverified: {
    label: "출처 확인 전",
    description:
      "이전 콘텐츠로 작성 주체의 유형을 아직 확인하지 못했어요. 내용을 참고할 때 이 점을 함께 고려해 주세요.",
    className: "border-[#e2c9c5] bg-[#fbf2f0] text-[#8F6662]",
  },
};

export function isCommunityContentOrigin(
  value: unknown,
): value is CommunityContentOrigin {
  return (
    typeof value === "string" &&
    CONTENT_ORIGIN_VALUES.has(value as CommunityContentOrigin)
  );
}

/**
 * 알 수 없거나 누락된 값은 신뢰도가 더 높은 출처로 추정하지 않는다.
 * DB 값이 유일한 진실이며, 확인할 수 없으면 항상 legacy_unverified로 표시한다.
 */
export function normalizeCommunityContentOrigin(
  value: unknown,
): CommunityContentOrigin {
  return isCommunityContentOrigin(value) ? value : "legacy_unverified";
}

export function getContentOriginPresentation(
  value: unknown,
): ContentOriginPresentation {
  return CONTENT_ORIGIN_PRESENTATION[normalizeCommunityContentOrigin(value)];
}
