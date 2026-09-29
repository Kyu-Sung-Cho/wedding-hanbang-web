import { z } from "zod";

export const PROVIDER_KINDS = ["individual", "team", "company"] as const;
export const PROVIDER_CATEGORIES = ["photography", "videography", "hair_makeup", "hair_styling", "floral", "mc", "directing", "venue", "catering", "other"] as const;
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = { individual: "개인", team: "팀", company: "업체" };
export const PROVIDER_CATEGORY_LABELS: Record<ProviderCategory, string> = {
  photography: "사진", videography: "영상", hair_makeup: "헤어·메이크업", hair_styling: "헤어변형",
  floral: "꽃·스타일링", mc: "사회·공연", directing: "진행·디렉팅", venue: "예식·행사 장소", catering: "식사·케이터링", other: "기타",
};
export type ProviderKind = typeof PROVIDER_KINDS[number];
export type ProviderCategory = typeof PROVIDER_CATEGORIES[number];

const nullableText = z.string().nullable();
export const providerMediaSchema = z.object({
  id: z.string().uuid(), provider_id: z.string().uuid(), caption: z.string(), alt_text: z.string(),
  sort_order: z.number().int(), image_url: z.string().optional(), created_at: z.string().optional(),
});
export const providerProfileSchema = z.object({
  id: z.string().uuid(), kind: z.enum(PROVIDER_KINDS), name: z.string(),
  categories: z.array(z.string()), regions: z.array(z.string()), introduction: z.string(),
  website: nullableText, instagram: nullableText,
  approval_status: z.enum(["pending", "approved", "rejected", "suspended"]),
  publication_status: z.enum(["draft", "published", "paused"]), version: z.number().int(),
  created_at: z.string(), updated_at: z.string(),
});
export const providerApplicationSchema = z.object({
  id: z.string().uuid(), provider_id: z.string().uuid(), kind: z.enum(PROVIDER_KINDS), name: z.string(),
  categories: z.array(z.string()), regions: z.array(z.string()), contact_name: z.string(), contact_email: z.string(),
  application_note: z.string(), status: z.enum(["pending", "changes_requested", "approved", "rejected"]),
  review_reason: nullableText, version: z.number().int(), created_at: z.string(), updated_at: z.string(),
});
export const providerOfferingSchema = z.object({
  id: z.string().uuid(), provider_id: z.string().uuid(), name: z.string(), category: z.string(), description: z.string(),
  base_price_krw: z.number().nonnegative(), price_unit: z.string(), includes: z.array(z.string()), extra_charges: z.string(), conditions: z.string(),
  is_active: z.boolean(),
  review_status: z.enum(["pending", "approved", "rejected"]),
  recommendation_status: z.enum(["unreviewed", "eligible", "needs_review", "blocked"]),
  review_reason: nullableText, version: z.number().int(), created_at: z.string(), updated_at: z.string(),
});
export const businessInquirySchema = z.object({
  id: z.string().uuid(), kind: z.enum(["collaboration", "media", "data", "other"]), subject: z.string(), message: z.string(),
  contact_name: z.string(), contact_email: z.string(), status: z.enum(["received", "reviewing", "responded", "closed"]),
  reply: nullableText, version: z.number().int(), created_at: z.string(), updated_at: z.string(),
});
export const providerWorkspaceSchema = z.object({
  profiles: z.array(providerProfileSchema), applications: z.array(providerApplicationSchema),
  offerings: z.array(providerOfferingSchema), media: z.array(providerMediaSchema), business_inquiries: z.array(businessInquirySchema),
});
export const publicProviderSchema = providerProfileSchema.omit({ approval_status: true, publication_status: true, version: true, created_at: true }).extend({
  offerings: z.array(providerOfferingSchema.omit({ review_reason: true, version: true, created_at: true })),
  media: z.array(providerMediaSchema),
});
export const providerCatalogPageSchema = z.object({ providers: z.array(publicProviderSchema), next_cursor: z.string().uuid().nullable() });
export const providerAdminPageSchema = providerWorkspaceSchema.extend({ next_cursor: z.string().uuid().nullable() });
export type ProviderCatalogPage = z.infer<typeof providerCatalogPageSchema>;
export type ProviderAdminPage = z.infer<typeof providerAdminPageSchema>;
export type ProviderProfile = z.infer<typeof providerProfileSchema>;
export type ProviderApplication = z.infer<typeof providerApplicationSchema>;
export type ProviderOffering = z.infer<typeof providerOfferingSchema>;
export type ProviderMedia = z.infer<typeof providerMediaSchema>;
export type BusinessInquiry = z.infer<typeof businessInquirySchema>;
export type ProviderWorkspace = z.infer<typeof providerWorkspaceSchema>;
export type PublicProvider = z.infer<typeof publicProviderSchema>;

export function providerMediaUrl(providerId: string, mediaId: string): string {
  return `/api/provider/profiles/${encodeURIComponent(providerId)}/media/${encodeURIComponent(mediaId)}`;
}
