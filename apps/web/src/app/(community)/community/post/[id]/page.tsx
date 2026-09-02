import Link from "next/link";
import PostDetailClient from "./PostDetailClient";
import { isMalformedPostIdError } from "@/lib/community/postIdErrors";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";
import { createClient } from "@/lib/supabase/server";
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
      <h1 className="font-serif-kr text-[var(--hb-text-strong)]">
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
  } = await viewerClient.auth.getUser();

  if (user) {
    const { data: visiblePost, error: visiblePostError } = await viewerClient
      .from("community_posts")
      .select("id")
      .eq("id", id)
      .eq("under_review", false)
      .maybeSingle();

    // 읽기가 실패한 것과 글이 없는 것은 다른 사실이다. 한 덩어리로 묶어 「찾을 수
    // 없어요」라고 하면, 잠깐 흔들린 DB 때문에 멀쩡한 글이 영구히 없어진 것처럼 보인다.
    // 단 22P02(주소가 UUID 가 아님)는 다시 시도해도 같으므로 "없는 글"이 맞다 —
    // 로그아웃 경로의 로더도 같은 판정을 쓴다.
    if (visiblePostError && !isMalformedPostIdError(visiblePostError)) {
      return <PostDetailNotice {...UNAVAILABLE} />;
    }

    if (!visiblePost) {
      return <PostDetailNotice {...MISSING} />;
    }

    return <PostDetailClient postId={id} initialPost={null} />;
  }

  // 여기부터는 **로그인 상태가 아닌 모든 방문자**가 같은 길을 간다 — 확인된
  // 로그아웃 방문자든, 만료·폐기된 세션 쿠키라 확인에 실패한 방문자든.
  //
  // ⚠️ 예전에는 후자를 따로 떼어 `initialPost={null}` 인 껍데기를 돌려줬다. 그런데
  // 그 껍데기를 채워야 할 `/api/community/posts/<id>` 는 **같은 이유로** 503 을 내서,
  // 스피너가 끝나지 않고 오류 문구조차 없었다. 2026-09-02 운영 실측(형식은 정상이고
  // Supabase 가 거절하는 세션 쿠키): 상세 페이지 200 인데 보이는 글자 354자 —
  // 내비와 푸터뿐이었다. 커뮤니티 피드는 그 글을 목록에 걸어 두고 있었다.
  //
  // 이 로더가 돌려주는 것은 **로그아웃 방문자가 받는 바이트와 같다** —
  // `visibility=public`·`under_review=false` 만 읽고 `user_vote`·`user_bookmarked`·
  // `verification_doc_url` 은 고정으로 비운다. 그 바이트는 이미 인터넷 전체에 열려
  // 있으므로(세션 없이 anon 키만으로 같은 행을 읽는다) 신원을 모르는 방문자에게
  // 내주어도 새는 것이 없다.
  //
  // 차단은 층이 다르다. `community_viewer_can_see` 는 뷰어 id 와 상대 id 를 둘 다
  // 요구하고 하나라도 null 이면 예외를 던진다 — 신원을 모르는 방문자에게는 정의되지
  // 않는다. 신원이 **확인된** 뷰어에게는 위 갈래가 그대로 적용한다.
  //
  // 로더는 두 가지로 실패한다: 행이 없으면 `null`, 읽기 자체가 실패하면 **throw**.
  // 던지면 스트리밍 뒤라 대체 화면을 못 그리므로 여기서 받아서 값으로 바꾼다.
  const initialPost = await getPublicCommunityPostDetail(id).catch(() => "unavailable" as const);

  if (initialPost === "unavailable") {
    return <PostDetailNotice {...UNAVAILABLE} />;
  }

  if (!initialPost) {
    return <PostDetailNotice {...MISSING} />;
  }

  return <PostDetailClient postId={id} initialPost={initialPost} />;
}
