import type { CommunityFeedQuery } from "@/types/community.types";

type RawSearchParams = Record<string, string | string[] | undefined>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeCommunityFeedQuery(searchParams?: RawSearchParams): CommunityFeedQuery {
  return {
    search: firstParam(searchParams?.search) ?? "",
    category: firstParam(searchParams?.category) ?? "",
    tag: firstParam(searchParams?.tag) ?? "",
    sort: firstParam(searchParams?.sort) ?? "",
    period: firstParam(searchParams?.period) ?? "",
    feed: firstParam(searchParams?.feed) ?? "",
  };
}
