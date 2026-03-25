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
  allowCostTemplate: boolean;
}

export const COMMUNITY_CATEGORIES: CommunityCategoryInfo[] = [
  {
    key: "sdme_review",
    label: "스드메 후기",
    shortLabel: "스드메",
    description: "스튜디오·드레스·메이크업 실제 이용 후기",
    icon: "Camera",
    color: "text-rose-600",
    bgColor: "bg-rose-50",
    allowVendorTags: true,
    allowCostTemplate: false,
  },
  {
    key: "venue_review",
    label: "예식장 후기",
    shortLabel: "예식장",
    description: "예식장 실제 이용 후기와 견적 공유",
    icon: "Building2",
    color: "text-amber-600",
    bgColor: "bg-amber-50",
    allowVendorTags: true,
    allowCostTemplate: false,
  },
  {
    key: "cost_share",
    label: "비용 공유",
    shortLabel: "비용",
    description: "결혼 준비 전체 비용 내역 공유",
    icon: "Receipt",
    color: "text-emerald-600",
    bgColor: "bg-emerald-50",
    allowVendorTags: true,
    allowCostTemplate: true,
  },
  {
    key: "tips",
    label: "꿀팁",
    shortLabel: "꿀팁",
    description: "결혼 준비 노하우와 꿀팁",
    icon: "Lightbulb",
    color: "text-yellow-600",
    bgColor: "bg-yellow-50",
    allowVendorTags: false,
    allowCostTemplate: false,
  },
  {
    key: "honeymoon",
    label: "신혼여행",
    shortLabel: "여행",
    description: "신혼여행 후기와 추천",
    icon: "Plane",
    color: "text-sky-600",
    bgColor: "bg-sky-50",
    allowVendorTags: true,
    allowCostTemplate: false,
  },
  {
    key: "qa",
    label: "Q&A",
    shortLabel: "Q&A",
    description: "결혼 준비 관련 질문",
    icon: "MessageCircleQuestion",
    color: "text-violet-600",
    bgColor: "bg-violet-50",
    allowVendorTags: false,
    allowCostTemplate: false,
  },
  {
    key: "free_board",
    label: "자유게시판",
    shortLabel: "자유",
    description: "자유롭게 이야기하는 공간",
    icon: "MessageSquare",
    color: "text-slate-600",
    bgColor: "bg-slate-50",
    allowVendorTags: false,
    allowCostTemplate: false,
  },
];

export const CATEGORY_MAP = Object.fromEntries(
  COMMUNITY_CATEGORIES.map((c) => [c.key, c])
) as Record<CommunityCategory, CommunityCategoryInfo>;

// 비용공유 템플릿 카테고리
export const COST_SHARE_CATEGORIES = [
  { key: "venue", label: "예식장" },
  { key: "studio", label: "스튜디오" },
  { key: "dress", label: "드레스" },
  { key: "makeup", label: "메이크업" },
  { key: "ring", label: "예물(반지)" },
  { key: "hanbok", label: "한복" },
  { key: "yedan", label: "예단" },
  { key: "honeymoon", label: "신혼여행" },
  { key: "houseware", label: "혼수(가전/가구)" },
  { key: "housing", label: "신혼집" },
  { key: "invitation", label: "청첩장" },
  { key: "snap", label: "본식 스냅/영상" },
  { key: "bouquet", label: "부케/꽃장식" },
  { key: "gift", label: "답례품" },
  { key: "pyebaek", label: "폐백" },
  { key: "other", label: "기타" },
];

// 신고 사유
export const REPORT_REASONS = [
  { key: "spam", label: "스팸/광고" },
  { key: "abuse", label: "욕설/비방" },
  { key: "ad", label: "업체 홍보글" },
  { key: "inappropriate", label: "음란물/부적절" },
  { key: "other", label: "기타" },
] as const;
