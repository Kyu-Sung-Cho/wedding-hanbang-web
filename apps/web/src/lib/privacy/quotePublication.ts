import { isUuid } from "@/utils/requestValidation";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Makes an owner-controlled quote public immediately before the first share.
 * The server-provided path is accepted only when it names the same quote, so a
 * malformed response cannot turn a share click into an open redirect.
 */
export async function publishQuoteForSharing(
  quoteId: string,
  fetcher: FetchLike = fetch,
): Promise<string> {
  if (!isUuid(quoteId)) {
    throw new Error("QUOTE_PUBLICATION_FAILED");
  }

  const response = await fetcher(
    `/api/amora/quote-check/${encodeURIComponent(quoteId)}/publish`,
    {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error("QUOTE_PUBLICATION_FAILED");
  }

  const expectedPath = `/quote/${quoteId}`;
  if (
    !response.ok
    || !isRecord(body)
    || body.id !== quoteId
    || body.published !== true
    || body.publicPath !== expectedPath
  ) {
    throw new Error("QUOTE_PUBLICATION_FAILED");
  }

  return body.publicPath;
}
