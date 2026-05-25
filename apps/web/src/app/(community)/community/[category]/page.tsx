import { redirect } from "next/navigation";
import { COMMUNITY_CATEGORIES } from "@/constants/communityCategories";
import type { CommunityCategory } from "@/types/community.types";

const validCategories = new Set<CommunityCategory>(COMMUNITY_CATEGORIES.map((category) => category.key));

export default async function CategoryRedirectPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams?: Promise<{ tag?: string }>;
}) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const category = resolvedParams.category as CommunityCategory;

  if (!validCategories.has(category)) {
    redirect("/community");
  }

  const query = new URLSearchParams({
    category,
    feed: "all",
  });

  if (resolvedSearchParams?.tag) {
    query.set("tag", resolvedSearchParams.tag);
  }

  redirect(`/community?${query.toString()}#community-feed`);
}
