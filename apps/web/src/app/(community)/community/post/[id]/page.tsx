import Link from "next/link";
import { headers } from "next/headers";
import PostDetailClient from "./PostDetailClient";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";
import { createClient } from "@/lib/supabase/server";
import { cookieHeaderHasAuthCredential } from "@/utils/requestValidation";
import { weddingPath } from "@/lib/weddingPaths";

export const dynamic = "force-dynamic";

/**
 * 글을 못 보여줄 때 **그 자리에서** 안내한다.
 *
 * ⚠️ 여기 `notFound()` 였다. 그런데 이 라우트는 `dynamic = "force-dynamic"` 이라
 * 커뮤니티 껍데기와 로딩 스켈레톤이 **먼저 흘러나간다.** 그 뒤에 던지면 React 는
 * 그 경계를 실패로 표시하고(`<!--$~-->`) 대체 내용을 끝내 보내지 않는다 — 사용자에게는
 * 위 내비와 아래 푸터만 있고 가운데가 텅 빈 화면이 남는다. 상태 코드도 이미 200 으로
 * 나간 뒤다.
 *
 * 2026-08-29 실측(운영·로컬 동일): 실제 글 997자 vs 없는 글 319자, 20초를 기다려도
 * 그대로였다. `not-found.tsx` 와 `error.tsx` 를 이 세그먼트에 넣어도 **그리지 않았다** —
 * 경계 자체가 스트리밍 뒤에는 대체를 못 한다. 그래서 던지지 않고 값을 돌려준다.
 *
 * 검색 노출은 이 라우트의 `layout.tsx` 가 `robots: index=false` 로 이미 막고 있다.
 */
function PostDetailNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto w-full max-w-[760px] px-4 py-14 sm:px-6">
      <h1 className="font-serif-kr text-[26px] font-normal leading-snug text-[var(--hb-text-strong)]">
        {title}
      </h1>
      <p className="mt-3 text-[14px] leading-[1.8] text-[var(--hb-text-body)]">{body}</p>
      <Link
        href={weddingPath()}
        prefetch={false}
        className="mt-6 inline-flex rounded-[6px] border border-[var(--hb-primary)]/15 bg-white px-5 py-2.5 text-[13.5px] font-semibold text-[var(--hb-text-strong)] transition-colors hover:border-[#8F5150]/45"
      >
        커뮤니티로 돌아가기
      </Link>
    </div>
  );
}

const MISSING = {
  title: "글을 찾을 수 없어요",
  body: "지워졌거나 주소가 바뀐 글일 수 있어요. 신고로 검토 중인 글도 잠시 보이지 않아요.",
} as const;

// 오류 내용을 화면에 쓰지 않는다 — `error.message` 에는 내부 식별자와 DB 원문이 담긴다.
const UNAVAILABLE = {
  title: "글을 불러오지 못했어요",
  body: "잠시 뒤 다시 시도해 주세요. 주소를 직접 입력하셨다면 링크가 온전한지 확인해 주세요.",
} as const;

type PostDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PostDetailPage({
  params,
}: PostDetailPageProps) {
  const { id } = await params;
  const viewerClient = await createClient();
  const {
    data: { user },
    error: viewerError,
  } = await viewerClient.auth.getUser();

  // 로그아웃 방문자에게 getUser()는 늘 "세션 없음" 오류다. 그것까지 확인 실패로
  // 읽으면 아래 공개 상세 로더가 익명 방문자에게 단 한 번도 실행되지 않아 서버가
  // 본문 없는 빈 화면을 내려준다 — 링크 미리보기와 크롤러에는 제목조차 없다.
  // 자격 증명을 실제로 제시한 요청만 확인 실패로 다룬다.
  const presentedCredential = cookieHeaderHasAuthCredential(
    (await headers()).get("cookie"),
  );

  if (viewerError && presentedCredential) {
    return <PostDetailClient postId={id} initialPost={null} />;
  }

  if (user) {
    const { data: visiblePost, error: visiblePostError } = await viewerClient
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .eq("under_review", false)
      .maybeSingle();

    if (visiblePostError || !visiblePost) {
      return <PostDetailNotice {...MISSING} />;
    }

    return <PostDetailClient postId={id} initialPost={null} />;
  }

  // 로더는 두 가지로 실패한다: 행이 없으면 `null`, 읽기 자체가 실패하면 **throw**
  // (예: 주소에 UUID 가 아닌 값 → Postgres 오류). 던지면 위 주석의 빈 화면이 되므로
  // 여기서 받아서 값으로 바꾼다.
  const initialPost = await getPublicCommunityPostDetail(id).catch(() => "unavailable" as const);

  if (initialPost === "unavailable") {
    return <PostDetailNotice {...UNAVAILABLE} />;
  }

  if (!initialPost) {
    return <PostDetailNotice {...MISSING} />;
  }

  return <PostDetailClient postId={id} initialPost={initialPost} />;
}
