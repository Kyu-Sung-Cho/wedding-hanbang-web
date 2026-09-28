import { z } from "zod";
import { providerAccount, providerBody, providerError, providerJson, providerRateLimit, providerRpc, ProviderError } from "./api";
import { providerApplicationSchema, providerProfileSchema, providerOfferingSchema, businessInquirySchema, providerWorkspaceSchema, providerMediaUrl } from "./contracts";
import { adminInputSchema, applicationInputSchema, resubmitInputSchema, profileInputSchema, offeringInputSchema, offeringUpdateSchema, inquiryInputSchema, providerIdSchema } from "./validation";
import { getPublicProviders } from "./publicData";

export function providerOutput<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new ProviderError("PROVIDER_UNAVAILABLE", 503, "처리 결과를 확인하지 못했어요. 새로고침 후 확인해 주세요.");
  return parsed.data;
}
export async function getWorkspace(request: Request, admin = false) {
  try {
    const { client } = await providerAccount(request, false, admin);
    const result = providerOutput(providerWorkspaceSchema, await providerRpc(client, admin ? "provider_admin_workspace" : "provider_get_workspace"));
    return providerJson({ ...result, media: result.media.map((media) => ({ ...media, image_url: providerMediaUrl(media.provider_id, media.id) })) });
  } catch (error) { return providerError(error); }
}
export async function submitApplication(request: Request, applicationId?: string) {
  try {
    const { client, user } = await providerAccount(request, true);
    await providerRateLimit(request, user.id);
    if (applicationId) {
      providerIdSchema.parse(applicationId);
      const { expected_version, ...input } = await providerBody(request, resubmitInputSchema);
      const application = providerOutput(providerApplicationSchema, await providerRpc(client, "provider_resubmit_application", { p_application_id: applicationId, p_expected_version: expected_version, p_input: input }));
      return providerJson({ provider_id: application.provider_id, application_id: application.id, status: application.status });
    }
    const { request_id, ...input } = await providerBody(request, applicationInputSchema);
    return providerJson(providerOutput(z.object({ provider_id: z.string().uuid(), application_id: z.string().uuid(), status: z.string() }), await providerRpc(client, "provider_submit_application", { p_input: input, p_request_id: request_id })), 201);
  } catch (error) { return providerError(error); }
}
export async function updateProfile(request: Request, id: string) {
  try {
    const { client, user } = await providerAccount(request, true);
    providerIdSchema.parse(id);
    await providerRateLimit(request, user.id);
    const input = await providerBody(request, profileInputSchema);
    const result = input.action === "save"
      ? await providerRpc(client, "provider_update_profile", { p_provider_id: id, p_expected_version: input.expected_version, p_input: { introduction: input.introduction, website: input.website ?? "", instagram: input.instagram ?? "" } })
      : await providerRpc(client, "provider_set_publication", { p_provider_id: id, p_expected_version: input.expected_version, p_status: input.action === "publish" ? "published" : "paused" });
    return providerJson(providerOutput(providerProfileSchema, result));
  } catch (error) { return providerError(error); }
}
export async function saveOffering(request: Request, providerId: string, offeringId?: string) {
  try {
    const { client, user } = await providerAccount(request, true);
    providerIdSchema.parse(providerId);
    if (offeringId) providerIdSchema.parse(offeringId);
    await providerRateLimit(request, user.id);
    const parsed = offeringId ? await providerBody(request, offeringUpdateSchema) : await providerBody(request, offeringInputSchema);
    const version = "expected_version" in parsed ? parsed.expected_version : null;
    const input = offeringInputSchema.parse(Object.fromEntries(Object.entries(parsed).filter(([key]) => key !== "expected_version")));
    const result = await providerRpc(client, "provider_save_offering", { p_provider_id: providerId, p_offering_id: offeringId ?? null, p_expected_version: version, p_input: input });
    return providerJson(providerOutput(providerOfferingSchema, result), offeringId ? 200 : 201);
  } catch (error) { return providerError(error); }
}
export async function submitInquiry(request: Request) {
  try {
    const { client, user } = await providerAccount(request, true);
    await providerRateLimit(request, user.id);
    const { request_id, ...input } = await providerBody(request, inquiryInputSchema);
    const result = providerOutput(businessInquirySchema, await providerRpc(client, "provider_submit_business_inquiry", { p_input: input, p_request_id: request_id }));
    return providerJson({ inquiry_id: result.id, status: result.status }, 201);
  } catch (error) { return providerError(error); }
}
export async function publicCatalog(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id") ?? undefined;
    if (id) providerIdSchema.parse(id);
    return providerJson({ providers: await getPublicProviders(id) });
  } catch (error) { return providerError(error); }
}
export async function reviewProvider(request: Request, id: string) {
  try {
    const { client, user } = await providerAccount(request, true, true);
    providerIdSchema.parse(id);
    await providerRateLimit(request, user.id, "provider-admin");
    const input = await providerBody(request, adminInputSchema);
    const common = { p_expected_version: input.expected_version };
    if (input.kind === "application") {
      providerOutput(providerApplicationSchema, await providerRpc(client, "provider_review_application", { ...common, p_application_id: id, p_action: input.action, p_reason: input.reason ?? "" }));
    } else if (input.kind === "offering") {
      providerOutput(providerOfferingSchema, await providerRpc(client, "provider_review_offering", { ...common, p_offering_id: id, p_action: input.action, p_reason: input.reason ?? "", p_recommendation_status: input.recommendation_status ?? "unreviewed" }));
    } else if (input.kind === "profile") {
      providerOutput(providerProfileSchema, await providerRpc(client, input.action === "suspend" ? "provider_suspend_profile" : "provider_restore_profile", { ...common, p_provider_id: id, p_reason: input.reason }));
    } else {
      providerOutput(businessInquirySchema, await providerRpc(client, "provider_review_business_inquiry", { ...common, p_inquiry_id: id, p_status: input.action, p_reply: input.reply ?? "" }));
    }
    return providerJson({ success: true });
  } catch (error) { return providerError(error); }
}
