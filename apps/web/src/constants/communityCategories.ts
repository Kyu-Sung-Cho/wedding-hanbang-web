import type { CommunityCategory } from "@/types/community.types";

export interface CommunityCategoryInfo {
  key: CommunityCategory;
  label: string;
  shortLabel: string;
  description: string;
  icon: string;
  color: string;
  bgColor: string;
  allowVendorTags: boolean;
  allowPriceForm: boolean;
}

export const COMMUNITY_CATEGORIES: CommunityCategoryInfo[] = [
  {
    key: "is_normal",
    label: "계약·추가금 질문",
    shortLabel: "조건 질문",
    description: "계약서의 포함 범위, 별도 비용, 변경·취소 조건을 이용자 경험과 함께 확인하는 공간입니다. 가격 적정성이나 계약 안전성을 판정하지 않습니다.",
    icon: "HelpCircle",
    color: "text-[#C4967E]",
    bgColor: "bg-[#FAF8F5]",
    allowVendorTags: true,
    allowPriceForm: false,
  },
  {
    key: "tour_review",
    label: "투어/이용 후기",
    shortLabel: "후기",
    description: "스튜디오, 드레스, 메이크업, 예식장 투어와 이용 후기를 공유합니다.",
    icon: "Camera",
    color: "text-[#C4967E]",
    bgColor: "bg-[#FAF8F5]",
    allowVendorTags: true,
    allowPriceForm: false,
  },
  {
    key: "tips_v2",
    label: "꿀팁",
    shortLabel: "꿀팁",
    description: "계약 전 질문, 추가비용 확인 항목, 준비 순서처럼 도움이 되는 팁을 모읍니다.",
    icon: "Lightbulb",
    color: "text-[#C9A96E]",
    bgColor: "bg-[#FAF8F0]",
    allowVendorTags: false,
    allowPriceForm: false,
  },
  {
    key: "ama",
    label: "결혼 선배 Q&A",
    shortLabel: "선배 Q&A",
    description: "결혼을 먼저 끝낸 선배에게 현실적인 선택 기준과 경험을 묻는 공간입니다.",
    icon: "GraduationCap",
    color: "text-[#1A1A1F]",
    bgColor: "bg-[#F0EFED]",
    allowVendorTags: false,
    allowPriceForm: false,
  },
  {
    key: "free",
    label: "자유게시판",
    shortLabel: "자유",
    description: "준비 중 생기는 고민, 잡담, 커플 대화처럼 가볍게 나누고 싶은 이야기를 올립니다.",
    icon: "MessageSquare",
    color: "text-[#878680]",
    bgColor: "bg-[#FAFAF8]",
    allowVendorTags: false,
    allowPriceForm: false,
  },
];

export const CATEGORY_MAP = Object.fromEntries(
  COMMUNITY_CATEGORIES.map((c) => [c.key, c])
) as Record<CommunityCategory, CommunityCategoryInfo>;

export const AD_DISCLOSURE_OPTIONS = [
  {
    key: "general",
    label: "일반 글",
    shortLabel: "일반",
    description: "직접 경험하거나 궁금해서 작성하는 글입니다. 혜택이나 대가를 받지 않았어요.",
    color: "#0284C7",
    bgColor: "#F0F9FF",
    borderColor: "#BAE6FD",
    icon: "check",
  },
  {
    key: "sponsored",
    label: "협찬 포함",
    shortLabel: "협찬",
    description: "할인, 무료 제공, 포인트 등 혜택을 받고 작성하는 글입니다.",
    color: "#A16207",
    bgColor: "#FEFCE8",
    borderColor: "#FDE68A",
    icon: "star",
    requiresDetail: true,
  },
  {
    key: "ad",
    label: "광고",
    shortLabel: "광고",
    description: "업체 공식 광고나 홍보 글입니다. 추천/검색 알고리즘에 반영되지 않아요.",
    color: "#334155",
    bgColor: "#F1F5F9",
    borderColor: "#CBD5E1",
    icon: "megaphone",
  },
] as const;

export const COHORT_CONTRACT_CATEGORIES = [
  { key: "venue", label: "예식장" },
  { key: "studio", label: "스튜디오" },
  { key: "dress", label: "드레스" },
  { key: "makeup", label: "메이크업" },
  { key: "snap", label: "본식 스냅/영상" },
  { key: "ring", label: "예물(반지)" },
  { key: "honeymoon", label: "신혼여행" },
  { key: "other", label: "기타" },
] as const;

export const COHORT_THREAD_TOPICS = [
  { key: "price", label: "가격", icon: "₩" },
  { key: "review", label: "후기", icon: "✓" },
  { key: "concern", label: "고민", icon: "?" },
  { key: "chat", label: "잡담", icon: "·" },
] as const;

export const REPORT_REASONS = [
  { key: "spam", label: "스팸/광고" },
  { key: "abuse", label: "욕설/비하" },
  { key: "ad", label: "업체 홍보글(협찬 미표시)" },
  { key: "inappropriate", label: "부적절한 내용" },
  { key: "other", label: "기타" },
] as const;

export const COST_SHARE_CATEGORIES = COHORT_CONTRACT_CATEGORIES;

export const GUEST_RELATIONS = [
  { key: "university_friend", label: "대학친구" },
  { key: "work_colleague", label: "직장동료" },
  { key: "family", label: "가족" },
  { key: "old_friend", label: "오랜 친구" },
  { key: "partner", label: "파트너 지인" },
  { key: "other", label: "기타" },
] as const;
