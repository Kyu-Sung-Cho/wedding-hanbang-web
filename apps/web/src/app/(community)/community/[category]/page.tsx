import { redirect } from "next/navigation";
import { communityCategoryFeedPath, isCommunityCategory } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";

export default async function CategoryRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams?: Promise<{ tag?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const category = resolvedParams.category;

  if (!isCommunityCategory(category)) {
    redirect(weddingPath());
  }

  redirect(communityCategoryFeedPath(category, resolvedSearchParams?.tag));
}
