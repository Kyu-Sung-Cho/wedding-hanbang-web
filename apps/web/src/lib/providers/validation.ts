import { z } from "zod";
import { PROVIDER_CATEGORIES, PROVIDER_KINDS } from "./contracts";

const text = (max: number) => z.string().trim().max(max);
const required = (max: number) => text(max).min(1);
export const providerIdSchema = z.string().uuid();
const version = z.number().int().positive();
function safeHttpsUrl(value: string): URL | null {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url : null; }
  catch { return null; }
}
const httpsLink = z.union([z.literal(""), z.string().trim().max(500).url().refine((value) => {
  return safeHttpsUrl(value) !== null;
}, "https 주소를 입력해 주세요.")]).nullable();
const applicationFields = {
  kind: z.enum(PROVIDER_KINDS), name: required(120),
  categories: z.array(z.enum(PROVIDER_CATEGORIES)).min(1).max(10),
  regions: z.array(required(80)).min(1).max(20), contact_name: required(80), application_note: text(2000),
  consents: z.object({ privacy: z.literal(true), price_transparency: z.literal(true), extra_charges: z.literal(true), standard_terms: z.literal(true), version: z.literal("2026-09-28") }).strict(),
};
const instagramLink = httpsLink.refine((value) => !value || ["instagram.com", "www.instagram.com"].includes(safeHttpsUrl(value)?.hostname ?? ""), "인스타그램 프로필 주소를 입력해 주세요.");
export const applicationInputSchema = z.object({ ...applicationFields, request_id: z.string().uuid() }).strict();
export const resubmitInputSchema = z.object({ ...applicationFields, expected_version: version }).strict();
export const profileInputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("save"), expected_version: version, introduction: text(3000), website: httpsLink, instagram: instagramLink }).strict(),
  z.object({ action: z.enum(["publish", "pause"]), expected_version: version }).strict(),
]);
export const offeringInputSchema = z.object({
  name: required(120), category: z.enum(PROVIDER_CATEGORIES), description: required(3000),
  base_price_krw: z.number().int().min(0).max(1_000_000_000), price_unit: required(60),
  includes: z.array(required(200)).min(1).max(30), extra_charges: required(2000), conditions: required(3000),
}).strict();
export const offeringUpdateSchema = z.union([
  offeringInputSchema.extend({ expected_version: version }),
  z.object({ action: z.literal("withdraw"), expected_version: version }).strict(),
]);
export const catalogQuerySchema = z.object({
  category: z.enum(PROVIDER_CATEGORIES).optional(), region: required(80).optional(),
  q: required(100).optional(), after: z.string().uuid().optional(),
}).strict();
export const adminQuerySchema = z.object({
  kind: z.enum(["applications", "offerings", "inquiries"]).default("inquiries"),
  status: z.string().max(30).default("all"), after: z.string().uuid().optional(),
}).strict().superRefine((value, context) => {
  const statuses = { applications: ["pending", "changes_requested", "approved", "rejected"], offerings: ["pending", "approved", "rejected", "withdrawn"], inquiries: ["received", "reviewing", "responded", "closed"] };
  if (value.status !== "all" && !statuses[value.kind].includes(value.status)) context.addIssue({ code: "custom", path: ["status"], message: "처리 상태를 확인해 주세요." });
});
export const inquiryInputSchema = z.object({
  request_id: z.string().uuid(), kind: z.enum(["collaboration", "media", "data", "other"]),
  subject: required(160), message: required(5000), contact_name: required(80), privacy_consent: z.literal(true),
}).strict();
export const mediaInputSchema = z.object({ caption: text(500), alt_text: required(200), rights_confirmed: z.literal("true") }).strict();
export const adminInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("application"), action: z.enum(["approve", "reject", "request_changes"]), expected_version: version, reason: text(2000).optional() }).strict(),
  z.object({ kind: z.literal("offering"), action: z.enum(["approve", "reject"]), expected_version: version, reason: text(2000).optional(), recommendation_status: z.enum(["unreviewed", "eligible", "blocked"]).optional() }).strict(),
  z.object({ kind: z.literal("profile"), action: z.enum(["suspend", "restore"]), expected_version: version, reason: required(2000) }).strict(),
  z.object({ kind: z.literal("inquiry"), action: z.enum(["reviewing", "responded", "closed"]), expected_version: version, reply: text(5000).optional() }).strict(),
]).superRefine((value, context) => {
  if ((value.kind === "application" || value.kind === "offering") && value.action !== "approve" && !value.reason) context.addIssue({ code: "custom", path: ["reason"], message: "처리 사유가 필요해요." });
  if (value.kind === "inquiry" && value.action === "responded" && !value.reply) context.addIssue({ code: "custom", path: ["reply"], message: "답변을 입력해 주세요." });
});
