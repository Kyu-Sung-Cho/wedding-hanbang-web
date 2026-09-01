import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { log } from "@/utils/log";
import {
  finalizeReviewPage,
  parseReviewPageRequest,
} from "@/lib/admin/reviewPagination";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isSafeDisclosureObjectKey, sourceFileLabels } from "@/lib/admin/vendorWorkspace";

const REVIEW_STATUSES = new Set(["pending", "approved", "rejected", "all"]);
const ENTITY_KINDS = new Set(["price", "agency_package"]);

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as UnknownRecord;
}

function asJoinedRecord(value: unknown): UnknownRecord | null {
  return asRecord(Array.isArray(value) ? value[0] : value);
}

function validationIssueCodes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((code): code is string => typeof code === "string")
    .map((code) => code.trim())
    .filter(Boolean))];
}

function safeAliasProposals(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const proposal = asRecord(candidate);
    if (
      !proposal
      || typeof proposal.id !== "string"
      || typeof proposal.alias !== "string"
      || !["pending", "approved", "rejected"].includes(String(proposal.status))
      || (proposal.reviewed_at !== null && typeof proposal.reviewed_at !== "string")
    ) {
      return [];
    }
    return [{
      id: proposal.id,
      alias: proposal.alias,
      status: proposal.status as "pending" | "approved" | "rejected",
      reviewed_at: proposal.reviewed_at as string | null,
    }];
  });
}

function mapPriceRow(value: unknown) {
  const row = asRecord(value) ?? {};
  const {
    source_file: sourceFile,
    source_object_keys: sourceObjectKeys,
    alias_proposals: aliasProposals,
    ...safeRow
  } = row;
  const objectKeys = Array.isArray(sourceObjectKeys)
    ? sourceObjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  const sourceLabels = sourceFileLabels(typeof sourceFile === "string" ? sourceFile : null);
  const sourceAvailable = sourceLabels.length > 0
    && objectKeys.length > 0
    && objectKeys.every(isSafeDisclosureObjectKey);
  return {
    ...safeRow,
    entity_kind: "price" as const,
    needs_review: row.needs_review !== false,
    validation_issue_codes: validationIssueCodes(row.validation_issue_codes),
    snapshot: asJoinedRecord(row.snapshot),
    vendor: asJoinedRecord(row.vendor),
    agency: asJoinedRecord(row.agency),
    options: Array.isArray(row.options) ? row.options : [],
    alias_proposals: safeAliasProposals(aliasProposals),
    source_available: sourceAvailable,
    source_count: sourceAvailable ? objectKeys.length : 0,
    source_file_label: sourceLabels[0] ?? null,
    source_file_labels: sourceLabels,
  };
}

function mapAgencyPackageRow(value: unknown) {
  const row = asRecord(value) ?? {};
  const { source_file: sourceFile, source_object_keys: sourceObjectKeys, ...safeRow } = row;
  const objectKeys = Array.isArray(sourceObjectKeys)
    ? sourceObjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  const sourceLabels = sourceFileLabels(typeof sourceFile === "string" ? sourceFile : null);
  const sourceAvailable = sourceLabels.length > 0
    && objectKeys.length > 0
    && objectKeys.every(isSafeDisclosureObjectKey);
  return {
    ...safeRow,
    entity_kind: "agency_package" as const,
    needs_review: row.needs_review !== false,
    validation_issue_codes: validationIssueCodes(row.validation_issue_codes),
    snapshot: asJoinedRecord(row.snapshot),
    agency: asJoinedRecord(row.agency),
    options: Array.isArray(row.options) ? row.options : [],
    source_available: sourceAvailable,
    source_count: sourceAvailable ? objectKeys.length : 0,
    source_file_label: sourceLabels[0] ?? null,
    source_file_labels: sourceLabels,
  };
}

export async function GET(request: Request) {
  const { authorized } = await verifyAdmin(request);
  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "price";
  const reviewStatus = url.searchParams.get("status") ?? "pending";
  if (!ENTITY_KINDS.has(kind) || !REVIEW_STATUSES.has(reviewStatus)) {
    return NextResponse.json({ error: "유효하지 않은 검수 상태입니다." }, { status: 400 });
  }
  const pageRequest = parseReviewPageRequest(url.searchParams);
  if (!pageRequest) {
    return NextResponse.json({ error: "페이지 요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    if (kind === "agency_package") {
      let packageQuery = client
        .from("official_agency_packages")
        .select(`
          id, package_name, category_scope,
          price_min_krw, price_max_krw, vat_note, price_note, options,
          review_status, needs_review, validation_issue_codes,
          source_file, source_object_keys, source_quote, confidence,
          edited_by_admin, review_version, created_at, updated_at,
          snapshot:price_snapshots(period_label, source, published_at),
          agency:agencies(id, name, region_code)
        `)
        .order("confidence", { ascending: true, nullsFirst: true })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (reviewStatus !== "all") {
        packageQuery = packageQuery.eq("review_status", reviewStatus);
      }
      const { data, error } = await packageQuery.range(
        pageRequest.offset,
        pageRequest.offset + pageRequest.limit,
      );
      if (error) {
        return NextResponse.json(
          { error: "대행사 패키지 검수 대기열을 불러오지 못했습니다." },
          { status: 500 },
        );
      }
      const page = finalizeReviewPage(data ?? [], pageRequest);
      return NextResponse.json({
        packages: page.items.map(mapAgencyPackageRow),
        has_more: page.hasMore,
        next_cursor: page.nextCursor,
        filters: { kind, status: reviewStatus, limit: pageRequest.limit },
      });
    }

    let query = client
      .from("official_prices")
      .select(`
        id, category, item_name, base_spec,
        price_min_krw, price_max_krw, vat_note, price_note,
        review_status, needs_review, validation_issue_codes,
        source_file, source_object_keys, source_quote, confidence,
        edited_by_admin, review_version, created_at, updated_at,
        snapshot:price_snapshots(period_label, source, published_at),
        vendor:vendors(id, name, slug, category, region_code, status),
        agency:agencies(id, name, region_code),
        options:official_price_options(
          id, name, price_min_krw, price_max_krw, unit, condition,
          raw_text, source_quote, confidence
        ),
        alias_proposals:vendor_alias_proposals(id, alias, status, reviewed_at)
      `)
      .order("confidence", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (reviewStatus !== "all") {
      query = query.eq("review_status", reviewStatus);
    }
    const { data, error } = await query.range(
      pageRequest.offset,
      pageRequest.offset + pageRequest.limit,
    );
    if (error) {
      return NextResponse.json(
        { error: "가격 검수 대기열을 불러오지 못했습니다." },
        { status: 500 },
      );
    }

    const page = finalizeReviewPage(data ?? [], pageRequest);
    return NextResponse.json({
      prices: page.items.map(mapPriceRow),
      has_more: page.hasMore,
      next_cursor: page.nextCursor,
      filters: { kind, status: reviewStatus, limit: pageRequest.limit },
    });
  } catch (err) {
    log.error("api/admin/price", err);
    return NextResponse.json(
      { error: kind === "agency_package"
        ? "대행사 패키지 검수 대기열을 불러오지 못했습니다."
        : "가격 검수 대기열을 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
