export type QuickReviewAdDisclosure = "general" | "sponsored" | "ad";

export interface QuickReviewDraft {
  vendorName: string;
  category: string;
  rating: number;
  review: string;
  adDisclosure: QuickReviewAdDisclosure;
  sponsorshipDetail: string;
}

export interface QuickReviewPostBody {
  category: "tour_review";
  title: string;
  content: string;
  visibility: "public";
  is_quick_review: true;
  rating: number;
  ad_disclosure: QuickReviewAdDisclosure;
  tags: string[];
  vendor_tags: string[];
  sponsorship_detail?: string;
}

export interface QuickReviewCommand {
  idempotencyKey: string;
  body: QuickReviewPostBody;
}

export interface QuickReviewSubmission {
  commandFor(draft: QuickReviewDraft): QuickReviewCommand;
  clearIf(key: string): boolean;
  clear(): void;
}

export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MIN: 5;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_MAX: 500;
export const QUICK_REVIEW_SPONSORSHIP_DETAIL_ERROR: string;

export function validateQuickReviewDraft(draft: QuickReviewDraft): string | null;
export function buildQuickReviewPostBody(draft: QuickReviewDraft): QuickReviewPostBody;
export function createQuickReviewSubmission(createId: () => string): QuickReviewSubmission;
export function readCreatedQuickReviewPostId(value: unknown): string | null;
