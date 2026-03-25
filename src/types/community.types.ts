// 커뮤니티 TypeScript 타입 정의

export type CommunityCategory =
  | "sdme_review"
  | "venue_review"
  | "cost_share"
  | "tips"
  | "free_board"
  | "honeymoon"
  | "qa";

export type PostVisibility = "public" | "members" | "draft";
export type PostSort = "hot" | "new" | "top";
export type TimePeriod = "week" | "month" | "all";
export type BadgeType = "member" | "verified_couple" | "top_contributor" | "admin";
export type ReportReason = "spam" | "abuse" | "ad" | "inappropriate" | "other";

// DB 행 타입
export interface CommunityProfile {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  badge: BadgeType;
  post_count: number;
  comment_count: number;
  total_upvotes_received: number;
  created_at: string;
}

export interface CommunityPost {
  id: string;
  author_id: string;
  category: CommunityCategory;
  title: string;
  content: string;
  images: string[];
  visibility: PostVisibility;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  bookmark_count: number;
  is_pinned: boolean;
  is_weekly_best: boolean;
  vendor_tags: string[];
  tags: string[];
  cost_data: CostShareData | null;
  created_at: string;
  updated_at: string;
}

// 피드에서 사용하는 글 + 작성자 정보
export interface PostWithAuthor extends CommunityPost {
  author: CommunityProfile;
  user_vote?: 1 | -1 | null;
  user_bookmarked?: boolean;
}

// 상세 페이지용 (벤더 정보 포함)
export interface PostDetail extends PostWithAuthor {
  vendor_details: VendorTagInfo[];
}

export interface VendorTagInfo {
  id: string;
  business_name: string;
  category: string;
  thumbnail_url: string | null;
  rating: number | null;
}

// 비용 공유 구조화 데이터
export interface CostShareData {
  totalCost: number;        // 총 비용 (만원)
  region: string;           // 지역
  guestCount: number;       // 하객 수
  weddingDate: string;      // 결혼 시기 (YYYY-MM)
  categories: CostShareCategory[];
  regretPoints?: string;    // 후회한 점
  goodPoints?: string;      // 잘한 점
  advice?: string;          // 조언
}

export interface CostShareCategory {
  key: string;              // 카테고리 키 (venue, studio, dress 등)
  label: string;
  cost: number;             // 만원 단위
  vendor?: string;          // 업체명
  vendorId?: string;        // 업체 ID (태그)
  contractCost?: number;    // 계약금
  extraCost?: number;       // 추가금
  notes?: string;           // 메모
}

// 댓글
export interface CommunityComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_id: string;
  content: string;
  upvote_count: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentWithAuthor extends CommunityComment {
  author: CommunityProfile;
  user_vote?: 1 | -1 | null;
  replies?: CommentWithAuthor[];
}

// API 요청/응답 타입
export interface CreatePostInput {
  category: CommunityCategory;
  title: string;
  content: string;
  images?: string[];
  visibility: PostVisibility;
  vendor_tags?: string[];
  tags?: string[];
  cost_data?: CostShareData;
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
  images?: string[];
  visibility?: PostVisibility;
  vendor_tags?: string[];
  tags?: string[];
  cost_data?: CostShareData;
}

export interface PostListParams {
  category?: CommunityCategory;
  sort?: PostSort;
  period?: TimePeriod;
  page?: number;
  limit?: number;
  tag?: string;
  author_id?: string;
  search?: string;
}

export interface PostListResponse {
  posts: PostWithAuthor[];
  total: number;
  hasMore: boolean;
}

export interface CreateCommentInput {
  post_id: string;
  parent_id?: string;
  content: string;
}
