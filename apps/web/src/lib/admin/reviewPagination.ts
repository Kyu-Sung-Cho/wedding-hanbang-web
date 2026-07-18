export const DEFAULT_REVIEW_PAGE_LIMIT = 100;
export const MAX_REVIEW_PAGE_LIMIT = 200;
const MAX_REVIEW_OFFSET = 1_000_000;

export interface ReviewPageRequest {
  limit: number;
  offset: number;
}

export interface ReviewPage<T> {
  items: T[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function encodeReviewCursor(offset: number): string {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_REVIEW_OFFSET) {
    throw new Error("invalid review cursor offset");
  }
  return `v1:${offset}`;
}

export function parseReviewPageRequest(searchParams: URLSearchParams): ReviewPageRequest | null {
  const rawLimit = searchParams.get("limit");
  const requestedLimit = rawLimit === null ? DEFAULT_REVIEW_PAGE_LIMIT : Number(rawLimit);
  if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1) return null;
  const limit = Math.min(MAX_REVIEW_PAGE_LIMIT, requestedLimit);

  const cursor = searchParams.get("cursor");
  if (cursor === null || cursor === "") return { limit, offset: 0 };
  const match = /^v1:(0|[1-9][0-9]{0,6})$/u.exec(cursor);
  if (!match) return null;
  const offset = Number(match[1]);
  if (!Number.isSafeInteger(offset) || offset > MAX_REVIEW_OFFSET - limit) return null;
  return { limit, offset };
}

export function finalizeReviewPage<T>(
  fetchedRows: readonly T[],
  request: ReviewPageRequest,
): ReviewPage<T> {
  const hasMore = fetchedRows.length > request.limit;
  const items = fetchedRows.slice(0, request.limit);
  return {
    items,
    hasMore,
    nextCursor: hasMore ? encodeReviewCursor(request.offset + items.length) : null,
  };
}
