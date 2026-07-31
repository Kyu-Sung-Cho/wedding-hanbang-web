import { notFound } from "next/navigation";
import PostDetailClient from "./PostDetailClient";
import { getPublicCommunityPostDetail } from "@/lib/community/publicPostDetail";

export const dynamic = "force-dynamic";

type PostDetailPageProps = {
  params: Promise<{ id: string }>;
};

export default async function PostDetailPage({
  params,
}: PostDetailPageProps) {
  const { id } = await params;
  const initialPost = await getPublicCommunityPostDetail(id);

  if (!initialPost) {
    notFound();
  }

  return <PostDetailClient initialPost={initialPost} />;
}
