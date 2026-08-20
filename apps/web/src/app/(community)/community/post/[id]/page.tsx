import { notFound } from "next/navigation";
import { headers } from "next/headers";
import PostDetailClient from "./PostDetailClient";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";
import { createClient } from "@/lib/supabase/server";
import { cookieHeaderHasAuthCredential } from "@/utils/requestValidation";

export const dynamic = "force-dynamic";

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
      notFound();
    }

    return <PostDetailClient postId={id} initialPost={null} />;
  }

  const initialPost = await getPublicCommunityPostDetail(id);

  if (!initialPost) {
    notFound();
  }

  return <PostDetailClient postId={id} initialPost={initialPost} />;
}
