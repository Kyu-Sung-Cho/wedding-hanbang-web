import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type {
  AtomicPriceUploadInput,
  PriceUploadReport,
  PriceUploadRepository,
  PriceUploadVendorCandidate,
} from "./priceUpload";

const candidateRowsSchema = z.array(z.strictObject({
  vendor_id: z.string().uuid(),
  vendor_name: z.string().min(1).max(200).refine((value) => value.trim() === value),
  vendor_slug: z.string().max(120).nullable(),
  aliases: z.array(z.string().max(200)).max(100),
  similarity: z.number().min(0).max(1),
  match_kind: z.enum(["exact_name", "exact_alias", "similar"]),
})).max(5);
const candidateBatchRowsSchema = z.array(z.strictObject({
  entry_index: z.number().int().min(0).max(49),
  candidates: candidateRowsSchema,
})).max(50);
const agencyRowsSchema = z.array(z.strictObject({
  id: z.string().uuid(),
  slug: z.string().min(1).max(120),
})).max(200);
const atomicUploadRowSchema = z.strictObject({
  entry_index: z.number().int().min(0).max(49),
  outcome: z.enum(["auto_matched", "newly_created", "needs_confirmation"]),
  vendor_id: z.string().uuid().nullable(),
  vendor_name: z.string().min(1).max(200).refine((value) => value.trim() === value),
  confirmation_id: z.string().uuid().nullable(),
  snapshot_id: z.string().uuid().nullable(),
  staged_prices: z.number().int().min(0).max(20),
}).superRefine((row, context) => {
  if (row.outcome === "needs_confirmation") {
    if (row.vendor_id !== null || row.confirmation_id === null
      || row.snapshot_id !== null || row.staged_prices !== 0) {
      context.addIssue({ code: "custom", message: "invalid confirmation outcome" });
    }
    return;
  }
  if (row.vendor_id === null || row.confirmation_id !== null
    || row.snapshot_id === null || row.staged_prices < 1) {
    context.addIssue({ code: "custom", message: "invalid staged outcome" });
  }
});
const atomicUploadRowsSchema = z.array(atomicUploadRowSchema).min(1).max(50);

function serializeAtomicEntry(entry: AtomicPriceUploadInput["entries"][number]) {
  let resolution: Record<string, unknown>;
  if (entry.resolution.kind === "existing") {
    resolution = {
      kind: "existing",
      vendor_id: entry.resolution.vendorId,
      vendor_name: entry.resolution.vendorName,
    };
  } else if (entry.resolution.kind === "draft") {
    resolution = {
      kind: "draft",
      vendor_name: entry.resolution.vendorName,
      normalized_name: entry.resolution.normalizedName,
      vendor_slug: entry.resolution.vendorSlug,
    };
  } else {
    resolution = {
      kind: "confirmation",
      candidate_vendor_ids: entry.resolution.candidateVendorIds,
      candidate_snapshot: entry.resolution.candidates.map((candidate) => ({
        vendor_id: candidate.vendorId,
        vendor_name: candidate.vendorName,
        vendor_slug: candidate.vendorSlug,
        aliases: candidate.aliases,
        similarity: candidate.similarity,
        match_kind: candidate.matchKind,
      })),
    };
  }
  return {
    entry_index: entry.entryIndex,
    entry_payload: entry.entry,
    resolution,
  };
}

export function createSupabasePriceUploadRepository(
  client: SupabaseClient,
): PriceUploadRepository {
  return {
    async commitUpload(input): Promise<PriceUploadReport> {
      const { data, error } = await client.rpc("apply_admin_json_price_upload", {
        p_source_object_key: input.sourceObjectKey,
        p_upload_context: input.upload,
        p_entries: input.entries.map(serializeAtomicEntry),
        p_created_by: input.createdBy,
      });
      if (error) throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_FAILED");
      const parsed = atomicUploadRowsSchema.safeParse(data ?? []);
      if (!parsed.success || parsed.data.length !== input.entries.length) {
        throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
      }
      const inputByIndex = new Map(input.entries.map((entry) => [entry.entryIndex, entry]));
      if (inputByIndex.size !== input.entries.length
        || new Set(parsed.data.map((row) => row.entry_index)).size !== parsed.data.length) {
        throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
      }
      const report: PriceUploadReport = {
        snapshot_id: null,
        counts: {
          auto_matched: 0,
          newly_created: 0,
          needs_confirmation: 0,
          errors: 0,
          staged_prices: 0,
        },
        details: { auto_matched: [], newly_created: [], needs_confirmation: [], errors: [] },
      };
      const snapshotIds = new Set<string>();
      for (const row of parsed.data) {
        const prepared = inputByIndex.get(row.entry_index);
        if (!prepared) throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
        if (row.outcome === "auto_matched") {
          if (prepared.resolution.kind !== "existing"
            || row.vendor_id === null
            || row.snapshot_id === null
            || row.vendor_id !== prepared.resolution.vendorId) {
            throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
          }
          report.counts.auto_matched += 1;
          report.counts.staged_prices += row.staged_prices;
          report.details.auto_matched.push({
            entry_index: row.entry_index,
            vendor_id: row.vendor_id,
            vendor_name: row.vendor_name,
          });
          snapshotIds.add(row.snapshot_id);
        } else if (row.outcome === "newly_created") {
          if (prepared.resolution.kind !== "draft"
            || row.vendor_id === null
            || row.snapshot_id === null
            || row.vendor_name !== prepared.resolution.vendorName) {
            throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
          }
          report.counts.newly_created += 1;
          report.counts.staged_prices += row.staged_prices;
          report.details.newly_created.push({
            entry_index: row.entry_index,
            vendor_id: row.vendor_id,
            vendor_name: row.vendor_name,
          });
          snapshotIds.add(row.snapshot_id);
        } else {
          if (prepared.resolution.kind !== "confirmation"
            || row.confirmation_id === null) {
            throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
          }
          report.counts.needs_confirmation += 1;
          report.details.needs_confirmation.push({
            confirmation_id: row.confirmation_id,
            version: 0,
            entry_index: row.entry_index,
            vendor_name: row.vendor_name,
            candidates: prepared.resolution.candidates,
          });
        }
      }
      if (snapshotIds.size > 1) {
        throw new Error("PRICE_UPLOAD_ATOMIC_COMMIT_RESPONSE_INVALID");
      }
      report.snapshot_id = snapshotIds.values().next().value ?? null;
      return report;
    },
    async findVendorCandidatesBatch(inputs) {
      if (inputs.length === 0) return [];
      const inputIndexes = new Set(inputs.map((input) => input.entryIndex));
      if (inputs.length > 50 || inputIndexes.size !== inputs.length) {
        throw new Error("PRICE_UPLOAD_MATCH_INPUT_INVALID");
      }
      const { data, error } = await client.rpc("match_vendors_for_price_upload_batch", {
        p_requests: inputs.map((input) => ({
          entry_index: input.entryIndex,
          name: input.name,
          category: input.category,
        })),
      });
      if (error) throw new Error("PRICE_UPLOAD_MATCH_FAILED");
      const parsed = candidateBatchRowsSchema.safeParse(data ?? []);
      if (!parsed.success || parsed.data.length !== inputs.length
        || new Set(parsed.data.map((row) => row.entry_index)).size !== parsed.data.length
        || parsed.data.some((row) => !inputIndexes.has(row.entry_index))) {
        throw new Error("PRICE_UPLOAD_MATCH_RESPONSE_INVALID");
      }
      return parsed.data.map((batch) => ({
        entryIndex: batch.entry_index,
        candidates: batch.candidates.map((row): PriceUploadVendorCandidate => ({
          vendorId: row.vendor_id,
          vendorName: row.vendor_name,
          vendorSlug: row.vendor_slug,
          aliases: row.aliases,
          similarity: row.similarity,
          matchKind: row.match_kind,
        })),
      }));
    },
    async findAgencies(slugs) {
      if (slugs.length === 0) return [];
      const { data, error } = await client
        .from("agencies")
        .select("id,slug")
        .eq("is_active", true)
        .in("slug", [...slugs])
        .is("merged_into_agency_id", null);
      if (error) throw new Error("PRICE_UPLOAD_AGENCY_LOOKUP_FAILED");
      const parsed = agencyRowsSchema.safeParse(data ?? []);
      if (!parsed.success) throw new Error("PRICE_UPLOAD_AGENCY_RESPONSE_INVALID");
      return parsed.data;
    },
  };
}
