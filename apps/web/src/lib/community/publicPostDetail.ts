import { z } from "zod";
import { COMMUNITY_POST_PUBLIC_SELECT } from "@/lib/community/postSelect";
import { PUBLIC_COMMUNITY_POST_QUERY_FILTERS } from "@/lib/community/publicPostRules";
import { getCommunityPollActorProjection } from "@/lib/community/pollProjection";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import type {
  CommunityProfile,
  PostDetail,
  VendorTagInfo,
} from "@/types/community.types";

const contentOriginSchema = z.enum([
  "member",
  "operator",
  "ai",
  "industry_professional",
  "legacy_unverified",
]);

const categorySchema = z.enum([
  "is_normal",
  "tour_review",
  "tips_v2",
  "ama",
  "free",
]);

const slideSchema = z.object({
  type: z.enum(["image", "video"]),
  url: z.string(),
  width: z.number().positive().optional(),
  height: z.number().positive().optional(),
  thumbnail_url: z.string().optional(),
});

const aiCommentSchema = z.object({
  text: z.string(),
  comparison: z.enum(["below", "average", "above", "unknown"]),
  percentage: z.number(),
  reference: z.string(),
  generated_at: z.string(),
});

const priceDataSchema = z.object({
  vendor_category: z.enum([
    "venue",
    "studio",
    "dress",
    "makeup",
    "snap",
    "ring",
    "honeymoon",
    "other",
  ]),
  base_price: z.number(),
  extra_price: z.number().optional(),
  vendor_name: z.string().optional(),
  region: z.string().optional(),
  details: z.string().optional(),
});

const costShareCategorySchema = z.object({
  key: z.string(),
  label: z.string(),
  cost: z.number(),
  vendor: z.string().optional(),
  vendorId: z.string().optional(),
  contractCost: z.number().optional(),
  extraCost: z.number().optional(),
  notes: z.string().optional(),
});

const costShareDataSchema = z.object({
  totalCost: z.number(),
  region: z.string(),
  guestCount: z.number(),
  weddingDate: z.string(),
  categories: z.array(costShareCategorySchema),
  regretPoints: z.string().optional(),
  goodPoints: z.string().optional(),
  advice: z.string().optional(),
});

const publicPostSchema = z.object({
  id: z.string().min(1),
  author_id: z.string().min(1),
  content_origin: contentOriginSchema,
  category: categorySchema,
  title: z.string(),
  content: z.string(),
  images: z.array(z.string()),
  slides: z.array(slideSchema).nullable(),
  visibility: z.literal("public"),
  ad_disclosure: z.enum(["general", "sponsored", "ad"]),
  sponsorship_detail: z.string().nullable(),
  ai_comment: aiCommentSchema.nullable(),
  is_resolved: z.boolean(),
  is_verified_review: z.boolean(),
  price_data: priceDataSchema.nullable(),
  is_quick_review: z.boolean(),
  rating: z.number().nullable(),
  cohort_room_id: z.string().nullable(),
  under_review: z.literal(false),
  upvote_count: z.number(),
  downvote_count: z.number(),
  comment_count: z.number(),
  view_count: z.number(),
  bookmark_count: z.number(),
  is_pinned: z.boolean(),
  is_weekly_best: z.boolean(),
  vendor_tags: z.array(z.string()),
  tags: z.array(z.string()),
  cost_data: costShareDataSchema.nullish(),
  created_at: z.string(),
  updated_at: z.string(),
});

const publicAuthorRowSchema = z.object({
  user_id: z.string().min(1),
  nickname: z.string(),
  avatar_url: z.string().nullable(),
  rank: z.enum(["sprout", "preparing", "expert", "master", "senior"]),
});

const publicVendorRowSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  category: z.string().nullable(),
  region_code: z.string().nullable(),
});

const publicPollReferenceSchema = z.object({
  id: z.string().min(1),
  post_id: z.string().min(1),
});

export type PublicCommunityAuthor = Pick<
  CommunityProfile,
  | "user_id"
  | "nickname"
  | "avatar_url"
  | "rank"
  | "wedding_year"
  | "wedding_month"
> & {
  role?: CommunityProfile["role"];
};

export type PublicCommunityVendorTag = Pick<
  VendorTagInfo,
  | "id"
  | "vendor_name"
  | "business_name"
  | "category"
  | "region"
  | "thumbnail_url"
  | "rating"
>;

export type PublicCommunityPostDetail = Omit<
  PostDetail,
  "author" | "vendor_details"
> & {
  author: PublicCommunityAuthor;
  vendor_details: PublicCommunityVendorTag[];
};

function unavailable(detail?: unknown): Error {
  if (detail) {
    console.error("[community.publicPostDetail] public read failed:", detail);
  }
  return new Error("COMMUNITY_PUBLIC_POST_DETAIL_UNAVAILABLE");
}

/**
 * Postgres `invalid_text_representation`. 주소의 id 가 UUID 가 아니면 여기로 온다.
 *
 * 이것을 읽기 실패로 다루면 화면이 「글을 불러오지 못했어요 · 잠시 뒤 다시 시도해
 * 주세요」를 띄우는데, 그 주소는 다시 시도해도 영원히 같다. 없는 글이라고 말하는
 * 편이 사실이다.
 */
const INVALID_TEXT_REPRESENTATION = "22P02";

function fallbackAuthor(authorId: string): PublicCommunityAuthor {
  return {
    user_id: authorId,
    nickname: "익명",
    avatar_url: null,
    rank: "sprout",
    wedding_year: null,
    wedding_month: null,
    role: null,
  };
}

/**
 * 공개 상세의 최초 HTML에 필요한 데이터만 anon 권한으로 읽는다.
 *
 * 사용자별 좋아요·북마크·투표 상태는 포함하지 않는다. 브라우저 hydration 뒤
 * 인증 쿠키를 사용하는 상세 API가 그 상태를 갱신한다.
 */
export async function getPublicCommunityPostDetail(
  postId: string,
): Promise<PublicCommunityPostDetail | null> {
  if (!postId.trim()) return null;

  const supabase = createPublicClient();
  const { data: rawPost, error: postError } = await supabase
    .from("community_posts")
    .select(COMMUNITY_POST_PUBLIC_SELECT)
    .eq("id", postId)
    .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
    .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
    .maybeSingle();

  if (postError) {
    if (postError.code === INVALID_TEXT_REPRESENTATION) return null;
    throw unavailable(postError);
  }
  if (!rawPost) return null;

  const parsedPost = publicPostSchema.safeParse(rawPost);
  if (!parsedPost.success) throw unavailable(parsedPost.error);
  const post = parsedPost.data;

  const authorRequest = supabase
    .from("community_public_profiles")
    .select("user_id, nickname, avatar_url, rank")
    .eq("user_id", post.author_id)
    .maybeSingle();

  const vendorRequest =
    post.vendor_tags.length > 0
      ? supabase
          .from("v_public_vendors")
          .select("id, name, category, region_code")
          .in("id", post.vendor_tags)
      : Promise.resolve({ data: [], error: null });

  const pollRequest = supabase
    .from("community_polls")
    .select("id, post_id")
    .eq("post_id", post.id)
    .maybeSingle();

  const [authorResult, vendorResult, pollResult] = await Promise.all([
    authorRequest,
    vendorRequest,
    pollRequest,
  ]);

  if (authorResult.error) throw unavailable(authorResult.error);
  if (vendorResult.error) throw unavailable(vendorResult.error);
  if (pollResult.error) throw unavailable(pollResult.error);

  let author = fallbackAuthor(post.author_id);
  if (authorResult.data) {
    const parsedAuthor = publicAuthorRowSchema.safeParse(authorResult.data);
    if (!parsedAuthor.success) throw unavailable(parsedAuthor.error);
    author = {
      ...parsedAuthor.data,
      wedding_year: null,
      wedding_month: null,
      role: null,
    };
  }

  const parsedVendors = z.array(publicVendorRowSchema).safeParse(
    vendorResult.data ?? [],
  );
  if (!parsedVendors.success) throw unavailable(parsedVendors.error);
  const vendorDetails: PublicCommunityVendorTag[] = parsedVendors.data.map(
    (vendor) => ({
      id: vendor.id,
      vendor_name: vendor.name,
      business_name: vendor.name,
      category: vendor.category,
      region: vendor.region_code,
      thumbnail_url: null,
      rating: null,
    }),
  );

  let poll: PublicCommunityPostDetail["poll"] = null;
  if (pollResult.data) {
    const parsedPoll = publicPollReferenceSchema.safeParse(pollResult.data);
    if (!parsedPoll.success) throw unavailable(parsedPoll.error);

    try {
      poll = await getCommunityPollActorProjection(
        createAdminClient(),
        null,
        parsedPoll.data.id,
      );
    } catch (error) {
      throw unavailable(error);
    }
  }

  return {
    ...post,
    cost_data: post.cost_data ?? null,
    // 검증 서류 원본은 공개 상세 payload에 포함하지 않는다.
    verification_doc_url: null,
    author,
    vendor_details: vendorDetails,
    user_vote: null,
    user_bookmarked: false,
    poll,
  };
}
