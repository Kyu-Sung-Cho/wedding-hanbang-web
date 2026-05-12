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

// 커뮤니티 게시판
export const COMMUNITY_CATEGORIES: CommunityCategoryInfo[] = [
  {
    key: "is_normal",
    label: "이거 정상이야?",
    shortLabel: "정상이야?",
    description: "가격·상황·업체 대응이 정상인지 묻는 공간. AI가 자동으로 평균과 비교해 알려드려요.",
    icon: "HelpCircle",
    color: "text-[#C4967E]",
    bgColor: "bg-[#FAF8F5]",
    allowVendorTags: true,
    allowPriceForm: true,
  },
  {
    key: "tour_review",
    label: "투어/이용 후기",
    shortLabel: "후기",
    description: "스튜디오·드레스·메이크업·예식장 투어 및 이용 후기. 15초 후기와 상세 후기 모두 환영.",
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
    description: "절약팁, 협상팁, 숨은 할인, 비시즌 활용법, 계약서 체크 포인트.",
    icon: "Lightbulb",
    color: "text-[#C9A96E]",
    bgColor: "bg-[#FAF8F0]",
    allowVendorTags: false,
    allowPriceForm: false,
  },
  {
    key: "ama",
    label: "결혼 끝났다 AMA",
    shortLabel: "AMA",
    description: "결혼 완료한 선배에게 무엇이든 물어보세요. Ask Me Anything.",
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
    description: "시댁 고민, 메리지블루, 커플 갈등, 잡담, 하소연 — 무엇이든 편하게.",
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

// 광고 표시 시스템 (필수 선택)
export const AD_DISCLOSURE_OPTIONS = [
  {
    key: "general",
    label: "일반",
    shortLabel: "일반",
    description: "내가 직접 쓴 글입니다. 어떤 혜택도 받지 않았어요.",
    color: "#22C55E",
    bgColor: "#F0FDF4",
  },
  {
    key: "sponsored",
    label: "협찬",
    shortLabel: "협찬",
    description: "혜택을 받고 작성한 글입니다. (할인, 무료 제공 등)",
    color: "#EAB308",
    bgColor: "#FEFCE8",
    requiresDetail: true,
  },
  {
    key: "ad",
    label: "광고",
    shortLabel: "광고",
    description: "업체 공식 광고입니다. 추천/검색 알고리즘에 반영되지 않아요.",
    color: "#EF4444",
    bgColor: "#FEF2F2",
  },
] as const;

// 동기방 계약 카테고리
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

// 동기방 메시지 스레드 토픽
export const COHORT_THREAD_TOPICS = [
  { key: "price", label: "가격", icon: "💰" },
  { key: "review", label: "후기", icon: "⭐" },
  { key: "concern", label: "고민", icon: "💭" },
  { key: "chat", label: "잡담", icon: "💬" },
] as const;

// 신고 사유
export const REPORT_REASONS = [
  { key: "spam", label: "스팸/광고" },
  { key: "abuse", label: "욕설/비방" },
  { key: "ad", label: "업체 홍보글 (협찬 미표시)" },
  { key: "inappropriate", label: "음란물/부적절" },
  { key: "other", label: "기타" },
] as const;

// 레거시 호환: 비용공유 카테고리 (CostShareEditor용)
export const COST_SHARE_CATEGORIES = COHORT_CONTRACT_CATEGORIES;

// 하객 관계 (방명록)
export const GUEST_RELATIONS = [
  { key: "university_friend", label: "대학친구" },
  { key: "work_colleague", label: "직장동료" },
  { key: "family", label: "가족" },
  { key: "old_friend", label: "오래된 친구" },
  { key: "partner", label: "파트너 지인" },
  { key: "other", label: "기타" },
] as const;
