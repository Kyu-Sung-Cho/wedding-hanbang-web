// 커뮤니티 TypeScript 타입 정의

export type CommunityCategory =
  | "is_normal"      // 레거시 키: 계약·추가금 질문
  | "tour_review"    // 투어/이용 후기
  | "tips_v2"        // 꿀팁
  | "ama"            // 결혼 끝났다 AMA
  | "free";          // 자유게시판

export type PostVisibility = "public" | "members" | "draft";
export type PostSort = "hot" | "new" | "top" | "my_posts";
export type TimePeriod = "week" | "month" | "all";
export type AdDisclosure = "general" | "sponsored" | "ad";
export type ReportReason = "spam" | "abuse" | "ad" | "inappropriate" | "other";
export type CohortThreadTopic = "price" | "review" | "concern" | "chat";
export type CohortContractCategory = "venue" | "studio" | "dress" | "makeup" | "snap" | "ring" | "honeymoon" | "other";
export type CohortEventType =
  | "venue_booked" | "studio_booked" | "dress_booked" | "makeup_booked"
  | "tour_done" | "contract_done" | "invitation_sent" | "progress_update" | "wedding_done";

// ────────────────────────────────────────
// 프로필
// ────────────────────────────────────────
export interface CommunityProfile {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  wedding_year: number | null;
  wedding_month: number | null;
  wedding_completed: boolean;
  progress_percent: number;
  region: string | null;
  post_count: number;
  comment_count: number;
  total_upvotes_received: number;
  warning_count: number;
  is_suspended: boolean;
  created_at: string;
}

// ────────────────────────────────────────
// 공개 커뮤니티 API 계약
// ────────────────────────────────────────
export interface PublicCommunityAuthor {
  /** Opaque community actor ID. This is never an auth.users UUID. */
  user_id: string;
  nickname: string;
  avatar_url: string | null;
}

/** 브라우저가 받을 수 있는 텍스트 전용 게시글 필드와 정확히 일치한다. */
export interface PublicCommunityPost {
  id: string;
  /** Opaque community actor ID. This is never an auth.users UUID. */
  author_id: string;
  category: CommunityCategory;
  title: string;
  content: string;
  visibility: PostVisibility;
  ad_disclosure: AdDisclosure;
  sponsorship_detail: string | null;
  is_resolved: boolean;
  under_review: boolean;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  bookmark_count: number;
  is_pinned: boolean;
  is_weekly_best: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface PostWithAuthor extends PublicCommunityPost {
  author: PublicCommunityAuthor;
  viewer_is_author: boolean;
  user_vote?: 1 | -1 | null;
  user_bookmarked?: boolean;
  poll?: PollSummary | null;
}

export interface InitialCommunityFeed {
  posts: PostWithAuthor[];
  total: number;
  hasMore: boolean;
  fetchedAt: string;
}

export type InitialCommunityFeedResult =
  | { status: "ready"; feed: InitialCommunityFeed }
  | { status: "unavailable"; message: string };

export interface CommunityFeedQuery {
  search?: string;
  category?: string;
  tag?: string;
  author_id?: string;
  sort?: string;
  period?: string;
  feed?: string;
}

export interface PostDetail extends PostWithAuthor {
  poll?: PollWithOptions | null;
}

// ────────────────────────────────────────
// 폴(투표/설문) — 게시글 임베드
// ────────────────────────────────────────
export interface PollOption {
  id: string;
  poll_id: string;
  position: number;
  label: string;
  image_url: string | null;
  vote_count: number;
}

export interface Poll {
  id: string;
  post_id: string;
  question: string;
  allow_multiple: boolean;
  is_anonymous: boolean;
  hide_results_until_voted: boolean;
  closes_at: string | null;
  total_voters: number;
  total_votes: number;
  created_at: string;
}

export interface PollWithOptions extends Poll {
  options: PollOption[];
  /** 현재 사용자가 투표한 option_id 들. 비로그인 시 빈 배열. */
  user_voted_option_ids: string[];
}

/** 목록 카드에 보여줄 요약 정보만 */
export interface PollSummary {
  id: string;
  question: string;
  total_voters: number;
  closes_at: string | null;
}

export interface CreatePollInput {
  question: string;
  options: Array<{ label: string; image_url?: string | null }>;
  allow_multiple?: boolean;
  is_anonymous?: boolean;
  hide_results_until_voted?: boolean;
  closes_at?: string | null;
}

// ────────────────────────────────────────
// 댓글
// ────────────────────────────────────────
export interface CommunityComment {
  id: string;
  post_id: string;
  parent_id: string | null;
  /** Opaque community actor ID. This is never an auth.users UUID. */
  author_id: string;
  content: string;
  upvote_count: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommentWithAuthor extends CommunityComment {
  author: PublicCommunityAuthor;
  viewer_is_author: boolean;
  replies?: CommentWithAuthor[];
}

// ────────────────────────────────────────
// 동기방
// ────────────────────────────────────────
export interface CohortRoom {
  id: string;
  year: number;
  month: number;
  room_number: number;
  name: string;
  member_count: number;
  message_count: number;
  is_active: boolean;
  created_at: string;
}

export interface CohortMember {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string;
  last_seen_at: string;
  is_active: boolean;
  profile?: CommunityProfile;
}

export type CohortProfileSummary = Pick<
  CommunityProfile,
  "user_id" | "nickname" | "avatar_url"
>;

export interface CohortMessage {
  id: string;
  room_id: string;
  author_id: string;
  content: string;
  thread_topic: CohortThreadTopic | null;
  images: string[];
  reply_to: string | null;
  is_deleted: boolean;
  created_at: string;
  author?: CohortProfileSummary;
}

export interface CohortContract {
  id: string;
  room_id: string;
  user_id: string;
  vendor_name: string;
  category: CohortContractCategory;
  base_price: number | null;
  extra_price: number | null;
  notes: string | null;
  created_at: string;
}

export interface CohortTimelineEvent {
  id: string;
  room_id: string;
  user_id: string;
  event_type: CohortEventType;
  description: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  user?: CohortProfileSummary;
}

export interface CohortStat {
  category: CohortContractCategory;
  sample_size: number;
  avg_base_price: number;
  avg_extra_price: number | null;
  avg_total: number | null;
}

// ────────────────────────────────────────
// API 입출력
// ────────────────────────────────────────
export interface CreatePostInput {
  category: CommunityCategory;
  title: string;
  content: string;
  visibility?: PostVisibility;
  tags?: string[];
  ad_disclosure: AdDisclosure;
  sponsorship_detail?: string;
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
  category?: CommunityCategory;
  visibility?: PostVisibility;
  tags?: string[];
  ad_disclosure?: AdDisclosure;
  sponsorship_detail?: string;
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
  general_only?: boolean;
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
