// @vitest-environment node

import { describe, expect, it } from "vitest";

import { normalizeUploadVendor } from "./priceUpload";
import { parsePriceUpload } from "./priceUpload";
import { processPriceUpload } from "./priceUpload";
import { createUploadSourceRecordKey } from "./priceUpload";
import { createDraftVendorSlug } from "./priceUpload";
import { PRICE_UPLOAD_LIMITS } from "./priceUpload";
import type { PriceUploadRepository } from "./priceUpload";

function validUpload() {
  return {
    period_label: "2026Q3",
    source: "mixed",
    source_note: "수동 공시 자료",
    collected_at: "2026-07-18",
    entries: [
      {
        vendor_name: "샘플스튜디오가",
        category: "studio",
        region_code: "seoul_gangnam3",
        aliases: ["샘플스튜디오구명"],
        prices: [
          {
            agency_slug: "sample-agency-a",
            price_min_krw: 1_000_000,
            price_max_krw: 1_200_000,
            price_note: null,
            base_spec: "샘플 기본 구성",
            options: [
              {
                name: "샘플 추가 구성",
                price_min_krw: 100_000,
                price_max_krw: 100_000,
                unit: null,
                condition: null,
                raw_text: "샘플 추가 구성 10만원",
                is_effectively_mandatory: false,
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("parsePriceUpload", () => {
  it("accepts only the three disclosure source contracts", () => {
    for (const source of ["kca_tprice", "agency_site", "mixed"] as const) {
      expect(parsePriceUpload({ ...validUpload(), source }).success).toBe(true);
    }
    expect(parsePriceUpload({ ...validUpload(), source: "manual_disclosure" }).success)
      .toBe(false);
  });
  it("rejects reversed KRW ranges before any database work", () => {
    const input = validUpload();
    input.entries[0].prices[0].price_min_krw = 1_300_000;

    const parsed = parsePriceUpload(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.some((issue) => issue.path.includes("price_min_krw"))).toBe(true);
    }
  });

  it("rejects duplicate option identities before a parent row can be staged", () => {
    const input = validUpload();
    input.entries[0].prices[0].options.push({
      ...input.entries[0].prices[0].options[0],
      raw_text: "같은 옵션의 중복 행",
    });

    const parsed = parsePriceUpload(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.some((issue) => issue.path.includes("options.1"))).toBe(true);
    }
  });

  it("rejects a KRW value that PostgreSQL integer cannot store", () => {
    const input = validUpload();
    input.entries[0].prices[0].price_max_krw = 2_147_483_648;

    expect(parsePriceUpload(input).success).toBe(false);
  });

  it("rejects a vendor name that becomes empty after former-name extraction", () => {
    const input = validUpload();
    input.entries[0].vendor_name = "(구. 샘플스튜디오구명)";

    const parsed = parsePriceUpload(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.some((issue) => issue.path.endsWith("vendor_name"))).toBe(true);
    }
  });

  it("rejects uploads that exceed the synchronous statement budget", () => {
    const tooManyEntries = validUpload();
    tooManyEntries.entries = Array.from(
      { length: PRICE_UPLOAD_LIMITS.maxEntries + 1 },
      (_, index) => ({
        ...structuredClone(validUpload().entries[0]),
        vendor_name: `Sample Studio ${index}`,
      }),
    );

    const tooManyTotalOptions = validUpload();
    const option = tooManyTotalOptions.entries[0].prices[0].options[0];
    const pricesWithOptions = Array.from(
      { length: PRICE_UPLOAD_LIMITS.maxPricesPerEntry },
      (_, priceIndex) => ({
        ...structuredClone(validUpload().entries[0].prices[0]),
        agency_slug: `sample-agency-${priceIndex}`,
        options: Array.from(
          { length: PRICE_UPLOAD_LIMITS.maxOptionsPerPrice },
          (_, optionIndex) => ({
            ...option,
            name: `Option ${priceIndex}-${optionIndex}`,
          }),
        ),
      }),
    );
    tooManyTotalOptions.entries = [
      { ...tooManyTotalOptions.entries[0], prices: pricesWithOptions },
      {
        ...structuredClone(tooManyTotalOptions.entries[0]),
        vendor_name: "Another Sample Studio",
        prices: [{
          ...structuredClone(validUpload().entries[0].prices[0]),
          agency_slug: "sample-agency-over-budget",
          options: [{ ...option, name: "Over budget option" }],
        }],
      },
    ];

    expect(parsePriceUpload(tooManyEntries).success).toBe(false);
    expect(parsePriceUpload(tooManyTotalOptions).success).toBe(false);
  });

  it("rejects duplicate logical price rows using the source-record identity", () => {
    const input = validUpload();
    input.entries[0].prices.push(structuredClone(input.entries[0].prices[0]));

    const parsed = parsePriceUpload(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues).toContainEqual(expect.objectContaining({
        path: "entries.0.prices.1",
      }));
    }
  });

  it("treats reordered options as the same logical source record", () => {
    const input = validUpload();
    input.entries[0].prices[0].options.push({
      ...input.entries[0].prices[0].options[0],
      name: "샘플 두 번째 구성",
      raw_text: "샘플 두 번째 구성 5만원",
      price_min_krw: 50_000,
      price_max_krw: 50_000,
    });
    input.entries[0].prices.push({
      ...structuredClone(input.entries[0].prices[0]),
      options: [...structuredClone(input.entries[0].prices[0].options)].reverse(),
    });

    expect(parsePriceUpload(input).success).toBe(false);
  });

  it("extracts former names as aliases and compares names without spaces", () => {
    expect(normalizeUploadVendor("샘플 스튜디오 가 (구. 샘플 스튜디오 나)", [
      " 샘플 스튜디오 별칭 ",
      "샘플스튜디오별칭",
    ])).toEqual({
      displayName: "샘플 스튜디오 가",
      normalizedName: "샘플스튜디오가",
      aliases: ["샘플 스튜디오 별칭", "샘플 스튜디오 나"],
    });
  });

  it("stages an exact name or alias match as pending without creating a vendor", async () => {
    const parsed = parsePriceUpload(validUpload());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    let committed: Parameters<PriceUploadRepository["commitUpload"]>[0] | null = null;
    const repository: PriceUploadRepository = {
      findAgencies: async () => [{ id: "agency-1", slug: "sample-agency-a" }],
      findVendorCandidatesBatch: async () => [{
        entryIndex: 0,
        candidates: [{
          vendorId: "vendor-1",
          vendorName: "샘플 스튜디오 가",
          vendorSlug: "sample-studio-a",
          aliases: ["샘플스튜디오가"],
          similarity: 1,
          matchKind: "exact_alias",
        }],
      }],
      commitUpload: async (input) => {
        committed = input;
        return {
          snapshot_id: "snapshot-1",
          counts: {
            auto_matched: 1,
            newly_created: 0,
            needs_confirmation: 0,
            errors: 0,
            staged_prices: 1,
          },
          details: {
            auto_matched: [{
              entry_index: 0,
              vendor_id: "vendor-1",
              vendor_name: "Sample Studio A",
            }],
            newly_created: [],
            needs_confirmation: [],
            errors: [],
          },
        };
      },
    };

    const report = await processPriceUpload(parsed.data, repository, {
      actorId: "00000000-0000-4000-8000-000000000090",
      objectKey: `${"a".repeat(64)}.json`,
    });

    expect(report.counts).toEqual({
      auto_matched: 1,
      newly_created: 0,
      needs_confirmation: 0,
      errors: 0,
      staged_prices: 1,
    });
    expect(report.snapshot_id).toBe("snapshot-1");
    expect(committed).toMatchObject({
      entries: [{
        entryIndex: 0,
        resolution: { kind: "existing", vendorId: "vendor-1" },
      }],
    });
  });

  it("reports pg_trgm candidates at 0.6 or above without creating or staging", async () => {
    const parsed = parsePriceUpload(validUpload());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    let committedEntry: Parameters<PriceUploadRepository["commitUpload"]>[0] | null = null;
    const repository: PriceUploadRepository = {
      findAgencies: async () => [{ id: "agency-1", slug: "sample-agency-a" }],
      findVendorCandidatesBatch: async () => [{
        entryIndex: 0,
        candidates: [{
          vendorId: "candidate-1",
          vendorName: "샘플스튜디오나",
          vendorSlug: "sample-studio-b",
          aliases: [],
          similarity: 0.72,
          matchKind: "similar",
        }],
      }],
      commitUpload: async (input) => {
        committedEntry = input;
        const resolution = input.entries[0].resolution;
        return {
          snapshot_id: null,
          counts: {
            auto_matched: 0,
            newly_created: 0,
            needs_confirmation: 1,
            errors: 0,
            staged_prices: 0,
          },
          details: {
            auto_matched: [],
            newly_created: [],
            needs_confirmation: [{
              confirmation_id: "00000000-0000-4000-8000-000000000099",
              version: 0,
              entry_index: 0,
              vendor_name: input.entries[0].entry.vendor_name,
              candidates: resolution.kind === "confirmation" ? resolution.candidates : [],
            }],
            errors: [],
          },
        };
      },
    };

    const report = await processPriceUpload(parsed.data, repository, {
      actorId: "00000000-0000-4000-8000-000000000090",
      objectKey: `${"a".repeat(64)}.json`,
    });

    expect(report.counts).toEqual({
      auto_matched: 0,
      newly_created: 0,
      needs_confirmation: 1,
      errors: 0,
      staged_prices: 0,
    });
    expect(report.details.needs_confirmation[0].candidates[0]).toMatchObject({
      vendorId: "candidate-1",
      similarity: 0.72,
    });
    expect(report.details.needs_confirmation[0].confirmation_id)
      .toBe("00000000-0000-4000-8000-000000000099");
    expect(report.details.needs_confirmation[0].version).toBe(0);
    expect(JSON.stringify(report)).not.toContain(`${"a".repeat(64)}.json`);
    expect(committedEntry).toMatchObject({
      sourceObjectKey: `${"a".repeat(64)}.json`,
      entries: [{
        entryIndex: 0,
        resolution: {
          kind: "confirmation",
          candidateVendorIds: ["candidate-1"],
        },
        entry: {
          category: "studio",
          prices: [expect.objectContaining({
            source_record_key: expect.stringMatching(/^admin-json:[a-f0-9]{64}$/u),
            source_quote: expect.stringContaining("/entries/0/prices/0"),
          })],
        },
      }],
    });
    expect(report.snapshot_id).toBeNull();
  });

  it("creates an unmatched vendor as draft and stages only pending prices", async () => {
    const parsed = parsePriceUpload(validUpload());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    let committedEntry: Parameters<PriceUploadRepository["commitUpload"]>[0] | null = null;
    const repository: PriceUploadRepository = {
      findAgencies: async () => [{ id: "agency-1", slug: "sample-agency-a" }],
      findVendorCandidatesBatch: async () => [{ entryIndex: 0, candidates: [] }],
      commitUpload: async (input) => {
        committedEntry = input;
        return {
          snapshot_id: "snapshot-1",
          counts: {
            auto_matched: 0,
            newly_created: 1,
            needs_confirmation: 0,
            errors: 0,
            staged_prices: 1,
          },
          details: {
            auto_matched: [],
            newly_created: [{
              entry_index: 0,
              vendor_id: "new-vendor-1",
              vendor_name: input.entries[0].entry.vendor_name,
            }],
            needs_confirmation: [],
            errors: [],
          },
        };
      },
    };

    const report = await processPriceUpload(parsed.data, repository, {
      actorId: "00000000-0000-4000-8000-000000000090",
      objectKey: `${"a".repeat(64)}.json`,
    });

    expect(report.counts).toEqual({
      auto_matched: 0,
      newly_created: 1,
      needs_confirmation: 0,
      errors: 0,
      staged_prices: 1,
    });
    expect(report.details.newly_created[0]).toMatchObject({ vendor_id: "new-vendor-1" });
    expect(committedEntry).toMatchObject({
      entries: [{
        resolution: {
          kind: "draft",
          normalizedName: "샘플스튜디오가",
          vendorSlug: expect.stringMatching(/^studio-seoul-gangnam3-[a-f0-9]{12}$/u),
        },
        entry: {
          prices: [expect.objectContaining({
            source_record_key: expect.stringMatching(/^admin-json:[a-f0-9]{64}$/u),
            source_quote: "JSON /entries/0/prices/0/base_spec: 샘플 기본 구성",
          })],
        },
      }],
    });
  });

  it("uses a deterministic content key so retries are idempotent without index collisions", () => {
    const first = parsePriceUpload(validUpload());
    const changedInput = validUpload();
    changedInput.entries[0].prices[0].price_min_krw += 1;
    const changed = parsePriceUpload(changedInput);
    expect(first.success).toBe(true);
    expect(changed.success).toBe(true);
    if (!first.success || !changed.success) return;

    const firstKey = createUploadSourceRecordKey(
      first.data,
      first.data.entries[0],
      first.data.entries[0].prices[0],
    );

    expect(firstKey).toMatch(/^admin-json:[a-f0-9]{64}$/u);
    expect(createUploadSourceRecordKey(
      first.data,
      first.data.entries[0],
      first.data.entries[0].prices[0],
    )).toBe(firstKey);
    expect(createUploadSourceRecordKey(
      changed.data,
      changed.data.entries[0],
      changed.data.entries[0].prices[0],
    )).not.toBe(firstKey);
  });

  it("creates a stable public-safe slug for a newly staged draft vendor", () => {
    const slug = createDraftVendorSlug("studio", "seoul_gangnam3", "샘플스튜디오가");
    expect(slug).toMatch(/^studio-seoul-gangnam3-[a-f0-9]{12}$/u);
    expect(createDraftVendorSlug("studio", "seoul_gangnam3", "샘플스튜디오가"))
      .toBe(slug);
    expect(createDraftVendorSlug("studio", "seoul_etc", "샘플스튜디오가"))
      .not.toBe(slug);
  });
});
