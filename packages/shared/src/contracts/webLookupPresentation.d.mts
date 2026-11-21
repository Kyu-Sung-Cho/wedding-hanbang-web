export const WEB_LOOKUP_NEEDS_VENDOR_CHECK: "업체 확인 필요";
export const WEB_LOOKUP_COPY: Readonly<{
  sourceName: string;
  columns: Readonly<{ name: string; area: string; category: string; page: string; item: string; price: string }>;
  orderNote: string;
  verifyNote: string;
  openNaver: string;
  openPage: string;
  linkOnly: string;
  placeholderBody: string;
  pagePriceNote: string;
  pageNoPrice: string;
  pageTextless: string;
}>;
export function formatWebLookupDate(value: unknown): string | null;
export function safeWebLookupHref(value: unknown): string | null;

export interface WebLookupSearchRow {
  ref: string;
  name: string;
  area: string | null;
  address: string | null;
  category: string | null;
  telephone: string | null;
  description: string | null;
  href: string | null;
  hrefLabel: string | null;
  readable: boolean;
  isWebDocument: boolean;
}

export type WebLookupSearchCard =
  | { kind: "failed"; title: string; body: string }
  | { kind: "placeholder"; title: string; body: string }
  | { kind: "empty"; title: string; body: string }
  | { kind: "results"; title: string; subtitle: string; rows: WebLookupSearchRow[]; naverHref: string | null };

export function getWebLookupSearchCard(rawOutput: unknown, success: boolean): WebLookupSearchCard | null;

export interface WebLookupPagePrice {
  label: string;
  amount: string;
  quote: string | null;
}

export type WebLookupPageCard =
  | { kind: "failed"; title: string; body: string; href: string | null }
  | {
      kind: "page";
      title: string;
      pageTitle: string | null;
      subtitle: string | null;
      prices: WebLookupPagePrice[];
      priceCell: "업체 확인 필요" | null;
      note: string;
      href: string | null;
      domain: string | null;
    };

export function getWebLookupPageCard(rawOutput: unknown, success: boolean): WebLookupPageCard | null;
