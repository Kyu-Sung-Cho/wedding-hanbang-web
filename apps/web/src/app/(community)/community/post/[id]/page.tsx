import { notFound } from "next/navigation";
import PostDetailClient from "./PostDetailClient";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";
import { createClient } from "@/lib/supabase/server";

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

  if (viewerError) {
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
