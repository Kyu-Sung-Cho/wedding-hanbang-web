export type VendorInquiryContactChannel = "website" | "instagram" | "naver_place";
export type VendorInquiryOutcome = "available" | "unavailable" | "needs_follow_up" | "other";

export interface VendorInquiryContactOption {
  channel: VendorInquiryContactChannel;
  label: string;
  target: string;
}

export interface VendorInquiryHandoff {
  id: string;
  status: "prepared" | "sent" | "replied";
  contactChannel: VendorInquiryContactChannel;
  contactTarget: string;
  inquiryMessage: string;
  providerDeliveryStatus: "not_integrated";
  userReportedSentAt: string | null;
  userReportedReplyAt: string | null;
  userReportedOutcome: VendorInquiryOutcome | null;
  revision: number;
  updatedAt: string;
}

export interface VendorInquiryHandoffResponse {
  accepted: true;
  bookingId: string;
  bookingStatus: string;
  vendorId: string;
  vendorName: string;
  productName: string | null;
  bookingDate: string;
  bookingTime: string;
  contactOptions: VendorInquiryContactOption[];
  contactSource: "verified_public_vendor_view";
  suggestedInquiryMessage: string;
  providerDeliveryStatus: "not_integrated";
  handoff: VendorInquiryHandoff | null;
}

export type VendorInquiryMutationBody =
  | {
      action: "prepare";
      contactChannel: VendorInquiryContactChannel;
      expectedRevision: number;
    }
  | { action: "mark_sent"; expectedRevision: number }
  | {
      action: "record_reply";
      userReportedOutcome: VendorInquiryOutcome;
      expectedRevision: number;
    };

export function parseVendorInquiryHandoffResponse(
  value: unknown,
  expectedBookingId: string,
): VendorInquiryHandoffResponse | null;

export function buildVendorInquiryMutationBody(
  handoff: VendorInquiryHandoff | null,
  action: "prepare" | "mark_sent" | "record_reply",
  values?: {
    contactChannel?: VendorInquiryContactChannel;
    userReportedOutcome?: VendorInquiryOutcome;
  },
): VendorInquiryMutationBody | null;

export function buildVendorInquiryShareMessage(
  handoff: VendorInquiryHandoff | null,
): string | null;

export function getVendorInquiryContactUrl(
  option: VendorInquiryContactOption | null,
): string | null;

export function buildVendorInquiryDecisionPrompt(
  value: VendorInquiryHandoffResponse | null,
): string | null;
