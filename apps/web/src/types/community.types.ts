// 커뮤니티 TypeScript 타입 정의

export type CommunityCategory =
  | "is_normal"      // 이거 정상이야?
  | "tour_review"    // 투어/이용 후기
  | "tips_v2"        // 꿀팁
  | "ama"            // 결혼 끝났다 AMA
  | "free";          // 자유게시판

export type PostVisibility = "public" | "members" | "draft";
export type PostSort = "hot" | "new" | "top" | "my_cohort" | "my_posts";
export type TimePeriod = "week" | "month" | "all";
export type AdDisclosure = "general" | "sponsored" | "ad";
export type CommunityRank = "sprout" | "preparing" | "expert" | "master" | "senior";
export type ReportReason = "spam" | "abuse" | "ad" | "inappropriate" | "other";
export type CohortThreadTopic = "price" | "review" | "concern" | "chat";
export type CohortContractCategory = "venue" | "studio" | "dress" | "makeup" | "snap" | "ring" | "honeymoon" | "other";
export type CohortEventType =
  | "venue_booked" | "studio_booked" | "dress_booked" | "makeup_booked"
  | "tour_done" | "contract_done" | "invitation_sent" | "progress_update" | "wedding_done";
export type GuestRelation = "university_friend" | "work_colleague" | "family" | "old_friend" | "partner" | "other";
export type GuestbookMessageType = "general" | "congratulations" | "speech" | "photo";

// ────────────────────────────────────────
// 프로필
// ────────────────────────────────────────
export interface CommunityProfile {
  user_id: string;
  nickname: string;
  avatar_url: string | null;
  rank: CommunityRank;
  /** @deprecated 레거시 호환용 alias of rank */
  badge?: CommunityRank | string | null;
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
// 게시글
// ────────────────────────────────────────
export interface PriceData {
  vendor_category: CohortContractCategory;
  base_price: number;        // 만원
  extra_price?: number;      // 만원
  vendor_name?: string;
  region?: string;
  details?: string;
}

export interface AiComment {
  text: string;
  comparison: "below" | "average" | "above" | "unknown";
  percentage: number;        // 평균 대비 %
  reference: string;         // 비교 기준, 출처, 또는 "공식 비교 기준 부족"
  generated_at: string;
}

// 카드 게시물 (인스타 캐러셀 형식)의 슬라이드 한 장.
// type=image 면 url에 정적 이미지/GIF, type=video 면 mp4/webm/mov URL.
export interface SlideMedia {
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
  /** 영상일 때 미리보기 썸네일 (선택). 비워두면 첫 프레임 자동 사용. */
  thumbnail_url?: string;
}

export interface CommunityPost {
  id: string;
  author_id: string;
  category: CommunityCategory;
  title: string;
  content: string;
  images: string[];
  /** 카드 게시물(인스타 캐러셀 형식)일 때 슬라이드 배열. 일반 글이면 null. */
  slides: SlideMedia[] | null;
  visibility: PostVisibility;
  ad_disclosure: AdDisclosure;
  sponsorship_detail: string | null;
  ai_comment: AiComment | null;
  is_resolved: boolean;
  is_verified_review: boolean;
  verification_doc_url: string | null;
  price_data: PriceData | null;
  is_quick_review: boolean;
  rating: number | null;
  cohort_room_id: string | null;
  under_review: boolean;
  upvote_count: number;
  downvote_count: number;
  comment_count: number;
  view_count: number;
  bookmark_count: number;
  is_pinned: boolean;
  is_weekly_best: boolean;
  vendor_tags: string[];
  tags: string[];
  /** @deprecated 레거시 호환 */
  cost_data?: CostShareData | null;
  created_at: string;
  updated_at: string;
}

export interface PostWithAuthor extends CommunityPost {
  author: CommunityProfile;
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

export interface CommunityFeedQuery {
  search?: string;
  category?: string;
  tag?: string;
  sort?: string;
  period?: string;
  feed?: string;
}

export interface PostDetail extends PostWithAuthor {
  vendor_details: VendorTagInfo[];
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

export interface VendorTagInfo {
  id: string;
  vendor_name: string;
  /** @deprecated 레거시 alias */
  business_name?: string;
  category: string | null;
  region: string | null;
  mention_count: number;
  avg_rating: number | null;
  avg_base_price: number | null;
  avg_extra_price: number | null;
  extra_rate: number | null;
  /** @deprecated 레거시 alias */
  rating?: number | null;
  /** @deprecated 레거시 alias */
  thumbnail_url?: string | null;
}

// ────────────────────────────────────────
// 댓글
// ────────────────────────────────────────
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
  author?: CommunityProfile;
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
  user?: CommunityProfile;
}

export interface CohortStat {
  category: CohortContractCategory;
  sample_size: number;
  avg_base_price: number;
  avg_extra_price: number;
  avg_total: number;
}

// ────────────────────────────────────────
// 방명록
// ────────────────────────────────────────
export interface Guestbook {
  id: string;
  owner_id: string;
  slug: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  venue: string | null;
  cover_image_url: string | null;
  our_story: string | null;
  proposal_story: string | null;
  thank_you_message: string | null;
  is_active: boolean;
  message_count: number;
  view_count: number;
  rolling_paper_url: string | null;
  rolling_paper_generated_at: string | null;
  created_at: string;
}

export interface GuestbookPhoto {
  id: string;
  guestbook_id: string;
  url: string;
  caption: string | null;
  position: number;
  created_at: string;
}

export type GuestbookReactionType = "love" | "congrats" | "touched";

export interface GuestbookMessageReactions {
  counts: Record<GuestbookReactionType, number>;
  mine: Record<GuestbookReactionType, boolean>;
}

export interface GuestbookMessage {
  id: string;
  guestbook_id: string;
  guest_name: string;
  relation: GuestRelation | null;
  message: string;
  image_url: string | null;
  message_type: GuestbookMessageType;
  is_approved: boolean;
  created_at: string;
  /** 서버에서 GET 응답에만 포함됨 (집계 + 호출자 IP가 누른 것). INSERT 응답에는 없음. */
  reactions?: GuestbookMessageReactions;
}

// ────────────────────────────────────────
// API 입출력
// ────────────────────────────────────────
export interface CreatePostInput {
  category: CommunityCategory;
  title: string;
  content: string;
  images?: string[];
  /** 카드 게시물(인스타 캐러셀 형식)일 때 슬라이드 배열. 비우면 일반 글. */
  slides?: SlideMedia[] | null;
  visibility?: PostVisibility;
  vendor_tags?: string[];
  tags?: string[];
  ad_disclosure: AdDisclosure;
  sponsorship_detail?: string;
  price_data?: PriceData;
  is_quick_review?: boolean;
  rating?: number;
  poll?: CreatePollInput | null;
}

export interface UpdatePostInput {
  title?: string;
  content?: string;
  images?: string[];
  slides?: SlideMedia[] | null;
  visibility?: PostVisibility;
  vendor_tags?: string[];
  tags?: string[];
  is_resolved?: boolean;
  /** @deprecated 레거시 호환 */
  cost_data?: CostShareData | null;
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

// 레거시 호환용 (기존 코드가 import 깨지지 않도록)
export type BadgeType = CommunityRank;
export interface CostShareData {
  totalCost: number;
  region: string;
  guestCount: number;
  weddingDate: string;
  categories: CostShareCategory[];
  regretPoints?: string;
  goodPoints?: string;
  advice?: string;
}
export interface CostShareCategory {
  key: string;
  label: string;
  cost: number;
  vendor?: string;
  vendorId?: string;
  contractCost?: number;
  extraCost?: number;
  notes?: string;
}
