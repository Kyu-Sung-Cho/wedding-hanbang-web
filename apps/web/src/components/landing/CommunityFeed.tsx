import Link from "next/link";
import { ArrowUpRight, Sparkles, MessageCircle, ArrowUp } from "lucide-react";
import SectionLabel from "./SectionLabel";
import { communityPostPath } from "@/lib/community/routes";
import { PUBLIC_COMMUNITY_POST_QUERY_FILTERS } from "@/lib/community/publicPostRules";
import { createPublicClient } from "@/lib/supabase/public";
import { weddingPath } from "@/lib/weddingPaths";

// 60초 ISR — 랜딩 페이지는 매 방문마다 fetch하지 않아도 됨
export const revalidate = 60;

interface PostRow {
  id: string;
  title: string;
  content: string;
  category: string;
  author_id: string;
  upvote_count: number;
  comment_count: number;
  ai_comment: { text?: string } | null;
  created_at: string;
}

interface ProfileRow {
  user_id: string;
  nickname: string;
  badge: string | null;
  avatar_url: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  is_normal: "가격 상담",
  tour_review: "투어 후기",
  tips_v2: "꿀팁",
  ama: "선배 AMA",
  free: "자유",
};

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

async function fetchPosts(): Promise<{ posts: PostRow[]; profiles: Map<string, ProfileRow> }> {
  try {
    const supabase = createPublicClient();

    const { data: posts } = await supabase
      .from("community_posts")
      .select("id, title, content, category, author_id, upvote_count, comment_count, ai_comment, created_at")
      .eq("visibility", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.visibility)
      .eq("under_review", PUBLIC_COMMUNITY_POST_QUERY_FILTERS.underReview)
      .order("upvote_count", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(6);

    const postRows = (posts ?? []) as unknown as PostRow[];

    if (postRows.length === 0) {
      return { posts: [], profiles: new Map() };
    }

    const authorIds = [...new Set(postRows.map((p) => p.author_id))];
    const { data: profiles } = await supabase
      .from("community_profiles")
      .select("user_id, nickname, badge, avatar_url")
      .in("user_id", authorIds);

    const profileMap = new Map<string, ProfileRow>();
    ((profiles ?? []) as unknown as ProfileRow[]).forEach((p) => {
      profileMap.set(p.user_id, p);
    });

    return { posts: postRows, profiles: profileMap };
  } catch (err) {
    console.error("[CommunityFeed] fetch 실패:", err);
    return { posts: [], profiles: new Map() };
  }
}

export default async function CommunityFeed() {
  const { posts, profiles } = await fetchPosts();
  const isEmpty = posts.length === 0;

  return (
    <section className="py-[clamp(96px,14vw,180px)] px-[clamp(20px,5vw,60px)] bg-white">
      <div className="max-w-[1240px] mx-auto">
        {/* 섹션 헤더 */}
        <div className="mb-16 md:mb-20 flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-2xl">
            <SectionLabel label="커뮤니티" />
            <h2 className="font-serif-kr text-[clamp(32px,5vw,56px)] font-light text-noir-800 leading-[1.2] tracking-normal mb-4">
              지금, <em className="not-italic text-rose-500">다른 커플들</em>은
              <br />
              이런 고민을 나누고 있어요.
            </h2>
            <p className="text-charcoal text-[15px] md:text-base leading-[1.9] font-light">
              실제 글, 실제 가격, 실제 아모라의 답변.
            </p>
          </div>
          {!isEmpty && (
            <Link
              href={weddingPath()}
              className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-2 tracking-[0.02em] hover:text-rose-500 hover:border-rose-500 transition-colors self-start md:self-end shrink-0"
            >
              전체 커뮤니티 보기
              <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>

        {/* 콘텐츠 */}
        {isEmpty ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-0 border-y border-platinum/70 divide-y md:divide-y-0 md:divide-x divide-platinum/70 md:[&>*:nth-child(3)]:border-r-0 lg:[&>*:nth-child(3)]:border-r md:[&>*:nth-child(n+3)]:border-t lg:[&>*:nth-child(n+4)]:border-t lg:[&>*:nth-child(n+4)]:border-t-platinum/70">
            {posts.map((post) => {
              const author = profiles.get(post.author_id);
              const excerpt = stripHtml(post.content).slice(0, 90);
              const hasAmoraComment = Boolean(post.ai_comment?.text);
              const categoryLabel = CATEGORY_LABEL[post.category] ?? post.category;

              return (
                <Link
                  key={post.id}
                  href={communityPostPath(post.id)}
                  className="group p-8 md:p-10 flex flex-col hover:bg-ivory-warm/50 transition-colors"
                >
                  {/* 카테고리 + 아모라 답변 뱃지 */}
                  <div className="flex items-center gap-3 mb-5">
                    <span className="text-[11px] md:text-[12px] tracking-[0.22em] uppercase text-rose-500 font-medium">
                      {categoryLabel}
                    </span>
                    {hasAmoraComment && (
                      <span className="inline-flex items-center gap-1 text-[11px] md:text-[12px] tracking-[0.18em] text-sage-500 font-medium">
                        <Sparkles className="w-3 h-3" />
                        아모라 답변
                      </span>
                    )}
                  </div>

                  {/* 제목 */}
                  <h3 className="font-serif-kr text-[20px] md:text-[22px] text-noir-800 font-medium leading-[1.4] tracking-normal mb-4 line-clamp-2 group-hover:text-rose-500 transition-colors">
                    {post.title}
                  </h3>

                  {/* 본문 excerpt */}
                  <p className="text-charcoal text-[14px] leading-[1.8] font-light mb-8 line-clamp-3 grow">
                    {excerpt}
                    {excerpt.length >= 90 && "…"}
                  </p>

                  {/* 메타: 저자 + 반응 */}
                  <div className="flex items-center justify-between text-[12px] text-taupe-400 mt-auto pt-4 border-t border-platinum/60">
                    <span className="truncate max-w-[60%]">
                      {author?.nickname ?? "익명"}
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="inline-flex items-center gap-1">
                        <ArrowUp className="w-3 h-3" />
                        {post.upvote_count}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="w-3 h-3" />
                        {post.comment_count}
                      </span>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

// Empty state (시드 전)
function EmptyState() {
  return (
    <div className="border-y border-platinum/70 py-16 md:py-20 text-center">
      <Sparkles className="w-8 h-8 text-rose-500 mx-auto mb-6 opacity-60" />
      <p className="font-serif-kr text-[22px] md:text-[26px] text-noir-800 font-light leading-snug mb-4 tracking-normal">
        아직 첫 글을 기다리는 중이에요.
      </p>
      <p className="text-charcoal text-[14px] md:text-[15px] font-light leading-relaxed max-w-md mx-auto mb-10">
        베타 50쌍이 모이면 가장 먼저 이곳에서
        <br />
        서로의 결정과 아모라의 답변이 쌓입니다.
      </p>
      <Link
        href="/beta"
        className="group inline-flex items-center gap-2 text-[14px] text-noir-800 font-medium border-b border-noir-800 pb-2 tracking-[0.02em] hover:text-rose-500 hover:border-rose-500 transition-colors"
      >
        첫 주인공 되기
        <ArrowUpRight className="w-4 h-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </Link>
    </div>
  );
}
