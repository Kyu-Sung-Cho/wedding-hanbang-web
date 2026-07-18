import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { PriceUploadVendorCandidate } from "./priceUpload";

const categorySchema = z.enum(["studio", "dress", "makeup", "hall"]);
const regionCodeSchema = z.enum([
  "seoul_gangnam3",
  "seoul_etc",
  "incheon",
  "busan",
  "daejeon",
  "gwangju",
  "daegu",
  "ulsan",
  "gyeonggi",
  "chungcheong",
  "jeolla",
  "gyeongsang",
  "gangwon",
  "jeju",
]);

const candidateSchema = z.strictObject({
  vendor_id: z.string().uuid(),
  vendor_name: z.string().min(1).max(200).refine((value) => value.trim() === value),
  vendor_slug: z.string().max(120).nullable(),
  aliases: z.array(z.string().max(200)).max(100),
  similarity: z.number().min(0).max(1),
  match_kind: z.enum(["exact_name", "exact_alias", "similar"]),
  category: categorySchema,
  region_code: regionCodeSchema.nullable(),
});

const confirmationRowSchema = z.strictObject({
  confirmation_id: z.string().uuid(),
  entry_index: z.number().int().min(0).max(49),
  vendor_name: z.string().min(1).max(200).refine((value) => value.trim() === value),
  category: categorySchema,
  region_code: regionCodeSchema,
  candidates: z.array(candidateSchema).min(1).max(5),
  state: z.literal("pending"),
  version: z.literal(0),
  selected_vendor_id: z.null(),
  staged_snapshot_id: z.null(),
  staged_price_count: z.null(),
  created_at: z.string().min(1).max(64),
  resolved_at: z.null(),
});

const resolvedRowSchema = z.strictObject({
  confirmation_id: z.string().uuid(),
  snapshot_id: z.string().uuid(),
  staged_prices: z.number().int().positive().max(20),
  version: z.literal(1),
  already_resolved: z.boolean(),
});

export type PendingPriceUploadConfirmation = {
  confirmation_id: string;
  entry_index: number;
  vendor_name: string;
  category: "studio" | "dress" | "makeup" | "hall";
  regionCode: z.infer<typeof regionCodeSchema>;
  candidates: Array<PriceUploadVendorCandidate & {
    category: z.infer<typeof categorySchema>;
    regionCode: z.infer<typeof regionCodeSchema> | null;
  }>;
  state: "pending";
  version: 0;
  created_at: string;
};

export class PriceUploadConfirmationError extends Error {
  constructor(readonly kind: "not_found" | "invalid" | "conflict" | "unavailable") {
    super(`PRICE_UPLOAD_CONFIRMATION_${kind.toUpperCase()}`);
  }
}

function fingerprint(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const value = error as Record<string, unknown>;
  return [value.code, value.message, value.details, value.hint]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .slice(0, 4_096);
}

function classify(error: unknown): PriceUploadConfirmationError {
  const value = fingerprint(error);
  if (value.includes("PRICE_UPLOAD_CONFIRMATION_NOT_FOUND") || value.includes("P0002")) {
    return new PriceUploadConfirmationError("not_found");
  }
  if (
    value.includes("INVALID")
    || value.includes("NOT_A_CANDIDATE")
    || value.includes("22023")
  ) {
    return new PriceUploadConfirmationError("invalid");
  }
  if (
    value.includes("CONFLICT")
    || value.includes("ALREADY_RESOLVED_DIFFERENT_VENDOR")
    || value.includes("INACTIVE_OR_CATEGORY_MISMATCH")
    || value.includes("AGENCY_INACTIVE")
    || value.includes("SNAPSHOT_IMMUTABLE")
    || value.includes("40001")
    || value.includes("23514")
    || value.includes("23505")
    || value.includes("55000")
  ) {
    return new PriceUploadConfirmationError("conflict");
  }
  return new PriceUploadConfirmationError("unavailable");
}

export async function listPendingPriceUploadConfirmations(
  client: SupabaseClient,
): Promise<PendingPriceUploadConfirmation[]> {
  const { data, error } = await client.rpc("list_price_upload_confirmations", {
    p_state: "pending",
  });
  if (error) throw classify(error);
  const parsed = z.array(confirmationRowSchema).max(500).safeParse(data ?? []);
  if (!parsed.success) throw new PriceUploadConfirmationError("unavailable");
  return parsed.data.map((row) => ({
    confirmation_id: row.confirmation_id,
    entry_index: row.entry_index,
    vendor_name: row.vendor_name,
    category: row.category,
    regionCode: row.region_code,
    candidates: row.candidates.map((candidate) => ({
      vendorId: candidate.vendor_id,
      vendorName: candidate.vendor_name,
      vendorSlug: candidate.vendor_slug,
      aliases: candidate.aliases,
      similarity: candidate.similarity,
      matchKind: candidate.match_kind,
      category: candidate.category,
      regionCode: candidate.region_code,
    })),
    state: row.state,
    version: row.version,
    created_at: row.created_at,
  }));
}

export async function resolvePendingPriceUploadConfirmation(
  client: SupabaseClient,
  input: {
    confirmationId: string;
    selectedVendorId: string;
    expectedVersion: number;
    resolvedBy: string;
  },
) {
  const { data, error } = await client.rpc("resolve_price_upload_confirmation", {
    p_confirmation_id: input.confirmationId,
    p_selected_vendor_id: input.selectedVendorId,
    p_expected_version: input.expectedVersion,
    p_resolved_by: input.resolvedBy,
  });
  if (error) throw classify(error);
  const parsed = z.array(resolvedRowSchema).length(1).safeParse(data ?? []);
  if (!parsed.success) throw new PriceUploadConfirmationError("unavailable");
  return parsed.data[0];
}
