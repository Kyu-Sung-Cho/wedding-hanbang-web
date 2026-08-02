import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { z } from "zod";
import {
  AGENCY_PACKAGE_EDITABLE_COLUMNS,
  isSafeDisclosureObjectKey,
  parseAgencyPackageReviewSubmission,
  parsePriceReviewSubmission,
  PRICE_EDITABLE_COLUMNS,
  sourceFileLabels,
} from "@/lib/admin/vendorWorkspace";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { verifyAdminJsonEvidence } from "@/lib/admin/priceUploadEvidence";
import { readBoundedJsonValue } from "@/utils/requestValidation";
import { checkAdminMutationRateLimit } from "@/lib/admin/adminReadBoundary";

type PriceRow = Record<string, unknown>;

const REVIEW_VERSION_CONFLICT_MESSAGE =
  "다른 관리자가 먼저 수정했습니다. 최신 내용을 다시 불러와 주세요.";

// The review schema permits 100 options and up to 4,000 characters of source
// evidence per option, so this authenticated admin route needs a larger bound.
const MAX_BODY_BYTES = 768 * 1024;

function isReviewVersionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const code = typeof record.code === "string" ? record.code : "";
  const message = typeof record.message === "string" ? record.message : "";
  return code === "40001"
    || message.includes("PRICE_REVIEW_VERSION_CONFLICT")
    || message.includes("AGENCY_PACKAGE_REVIEW_VERSION_CONFLICT");
}

function reviewVersionConflictResponse() {
  return NextResponse.json({
    error: REVIEW_VERSION_CONFLICT_MESSAGE,
    code: "REVIEW_VERSION_CONFLICT",
  }, { status: 409 });
}

function isPublicTextPrivacyViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return typeof record.message === "string"
    && record.message.includes("DISCLOSURE_PUBLIC_TEXT_PII_BLOCKED:");
}

function isPublicTextLengthViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  return typeof record.message === "string"
    && record.message.includes("DISCLOSURE_PUBLIC_TEXT_LENGTH_BLOCKED:");
}

function publicTextPrivacyResponse() {
  return NextResponse.json({
    error: "공개될 수 있는 항목에 연락처·이메일·링크가 포함되어 있어 저장하지 않았습니다. 해당 정보를 제거한 뒤 다시 시도해 주세요.",
    code: "PUBLIC_TEXT_PII_BLOCKED",
  }, { status: 422 });
}

function publicTextLengthResponse() {
  return NextResponse.json({
    error: "공개될 수 있는 항목이 허용 길이를 초과해 저장하지 않았습니다. 내용을 줄인 뒤 다시 시도해 주세요.",
    code: "PUBLIC_TEXT_LENGTH_BLOCKED",
  }, { status: 422 });
}

function snapshotIsPublished(value: unknown): boolean | null {
  const snapshot = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const published = (snapshot as Record<string, unknown>).published;
  return typeof published === "boolean" ? published : null;
}

function publishedSnapshotResponse() {
  return NextResponse.json({
    error: "이미 발행된 공시가는 직접 수정할 수 없습니다. 새 스냅샷에서 정정해 주세요.",
    code: "PUBLISHED_SNAPSHOT_IMMUTABLE",
  }, { status: 409 });
}

function safePriceResponse(row: PriceRow) {
  const {
    source_file: sourceFile,
    source_object_keys: sourceObjectKeys,
    alias_proposals: aliasProposals,
    snapshot: _snapshot,
    ...safe
  } = row;
  void _snapshot;
  const keys = Array.isArray(sourceObjectKeys)
    ? sourceObjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  const sourceLabels = sourceFileLabels(typeof sourceFile === "string" ? sourceFile : null);
  const sourceAvailable = sourceLabels.length > 0
    && keys.length > 0
    && keys.every(isSafeDisclosureObjectKey);
  return {
    ...safe,
    alias_proposals: Array.isArray(aliasProposals)
      ? aliasProposals.flatMap((value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) return [];
          const proposal = value as PriceRow;
          if (
            typeof proposal.id !== "string"
            || typeof proposal.alias !== "string"
            || !["pending", "approved", "rejected"].includes(String(proposal.status))
            || (proposal.reviewed_at !== null && typeof proposal.reviewed_at !== "string")
          ) return [];
          return [{
            id: proposal.id,
            alias: proposal.alias,
            status: proposal.status,
            reviewed_at: proposal.reviewed_at,
          }];
        })
      : [],
    source_available: sourceAvailable,
    source_count: sourceAvailable ? keys.length : 0,
    source_file_label: sourceLabels[0] ?? null,
    source_file_labels: sourceLabels,
  };
}

function safeAgencyPackageResponse(row: PriceRow) {
  const {
    source_file: sourceFile,
    source_object_keys: sourceObjectKeys,
    snapshot: _snapshot,
    ...safe
  } = row;
  void _snapshot;
  const keys = Array.isArray(sourceObjectKeys)
    ? sourceObjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  const sourceLabels = sourceFileLabels(typeof sourceFile === "string" ? sourceFile : null);
  const sourceAvailable = sourceLabels.length > 0
    && keys.length > 0
    && keys.every(isSafeDisclosureObjectKey);
  return {
    ...safe,
    entity_kind: "agency_package" as const,
    source_available: sourceAvailable,
    source_count: sourceAvailable ? keys.length : 0,
    source_file_label: sourceLabels[0] ?? null,
    source_file_labels: sourceLabels,
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const limited = await checkAdminMutationRateLimit(
    request,
    userId,
    "price-review-update",
  );
  if (limited) return limited;

  const idResult = z.string().uuid().safeParse((await params).id);
  if (!idResult.success) {
    return NextResponse.json({ error: "검수 항목을 찾을 수 없습니다." }, { status: 404 });
  }

  const bodyResult = await readBoundedJsonValue(request, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    if (bodyResult.reason === "too_large") {
      return NextResponse.json({ error: "요청 데이터가 너무 큽니다." }, { status: 413 });
    }
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const rawBody = bodyResult.value;
  if (
    !rawBody
    || typeof rawBody !== "object"
    || !Array.isArray((rawBody as Record<string, unknown>).options)
  ) {
    return NextResponse.json(
      { error: "전체 옵션 배열을 포함해 저장해 주세요." },
      { status: 400 },
    );
  }

  const kind = new URL(request.url).searchParams.get("kind") ?? "price";
  if (kind !== "price" && kind !== "agency_package") {
    return NextResponse.json({ error: "검수 항목 유형을 확인해 주세요." }, { status: 400 });
  }

  if (kind === "agency_package") {
    const parsedPackage = parseAgencyPackageReviewSubmission(rawBody);
    if (!parsedPackage.success) {
      return NextResponse.json(
        { error: "패키지 입력값을 확인해 주세요.", issues: parsedPackage.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    try {
      const client = getServiceClient();
      const { data: current, error: readError } = await client
        .from("official_agency_packages")
        .select("id, source_file, source_object_keys, snapshot:price_snapshots!inner(published)")
        .eq("id", idResult.data)
        .single();
      if (readError || !current) {
        return NextResponse.json({ error: "패키지 검수 항목을 찾을 수 없습니다." }, { status: 404 });
      }
      const published = snapshotIsPublished(current.snapshot);
      if (published === null) {
        return NextResponse.json({ error: "공시 스냅샷 상태를 확인하지 못했습니다." }, { status: 503 });
      }
      if (published) return publishedSnapshotResponse();
      const sourceKeys = Array.isArray(current.source_object_keys)
        ? current.source_object_keys.filter((value): value is string => typeof value === "string")
        : [];
      if (
        parsedPackage.data.action === "approve"
        && (
          typeof current.source_file !== "string"
          || current.source_file.trim().length === 0
          || sourceKeys.length === 0
          || !sourceKeys.every(isSafeDisclosureObjectKey)
        )
      ) {
        return NextResponse.json(
          { error: "보관된 패키지 원본 파일을 확인한 뒤 승인할 수 있습니다." },
          { status: 422 },
        );
      }
      if (
        parsedPackage.data.action === "approve"
        && !(await verifyAdminJsonEvidence(client, sourceKeys))
      ) {
        return NextResponse.json(
          { error: "보관된 패키지 JSON 원본의 무결성을 확인할 수 없습니다." },
          { status: 422 },
        );
      }
      const values = Object.fromEntries(
        AGENCY_PACKAGE_EDITABLE_COLUMNS.map((key) => [key, parsedPackage.data[key]]),
      );
      const { error: reviewError } = await client.rpc("review_official_agency_package", {
        p_package_id: idResult.data,
        p_actor_id: userId,
        p_action: parsedPackage.data.action,
        p_values: values,
        p_options: parsedPackage.data.options,
        p_expected_review_version: parsedPackage.data.expected_review_version,
      });
      if (reviewError) {
        if (isReviewVersionConflict(reviewError)) return reviewVersionConflictResponse();
        if (isPublicTextPrivacyViolation(reviewError)) return publicTextPrivacyResponse();
        if (isPublicTextLengthViolation(reviewError)) return publicTextLengthResponse();
        return NextResponse.json(
          { error: "패키지 검수 내용을 저장하지 못했습니다. 근거와 옵션을 다시 확인해 주세요." },
          { status: 409 },
        );
      }
      const { data: saved, error: writeError } = await client
        .from("official_agency_packages")
        .select(`
          id, package_name, category_scope,
          price_min_krw, price_max_krw, vat_note, price_note, options,
          review_status, source_file, source_object_keys, source_quote, confidence,
          edited_by_admin, review_version, created_at, updated_at
        `)
        .eq("id", idResult.data)
        .single();
      if (writeError || !saved) {
        return NextResponse.json(
          { error: "패키지 검수 내용을 저장하지 못했습니다. 다시 시도해 주세요." },
          { status: 500 },
        );
      }
      return NextResponse.json({ package: safeAgencyPackageResponse(saved as PriceRow) });
    } catch {
      return NextResponse.json(
        { error: "패키지 검수 내용을 저장하지 못했습니다. 다시 시도해 주세요." },
        { status: 500 },
      );
    }
  }

  const parsed = parsePriceReviewSubmission(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "입력값을 확인해 주세요.", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const client = getServiceClient();
    const { data: current, error: readError } = await client
      .from("official_prices")
      .select(`
        id, source_file, source_object_keys,
        snapshot:price_snapshots!inner(published)
      `)
      .eq("id", idResult.data)
      .single();
    if (readError || !current) {
      return NextResponse.json({ error: "검수 항목을 찾을 수 없습니다." }, { status: 404 });
    }
    const published = snapshotIsPublished(current.snapshot);
    if (published === null) {
      return NextResponse.json({ error: "공시 스냅샷 상태를 확인하지 못했습니다." }, { status: 503 });
    }
    if (published) return publishedSnapshotResponse();
    const sourceKeys = Array.isArray(current.source_object_keys)
      ? current.source_object_keys.filter((value): value is string => typeof value === "string")
      : [];
    if (
      parsed.data.action === "approve"
      && (
        typeof current.source_file !== "string"
        || current.source_file.trim().length === 0
        || sourceKeys.length === 0
        || !sourceKeys.every(isSafeDisclosureObjectKey)
      )
    ) {
      return NextResponse.json(
        { error: "보관된 원본 파일을 확인한 뒤 승인할 수 있습니다." },
        { status: 422 },
      );
    }
    if (
      parsed.data.action === "approve"
      && !(await verifyAdminJsonEvidence(client, sourceKeys))
    ) {
      return NextResponse.json(
        { error: "보관된 JSON 원본의 무결성을 확인할 수 없습니다." },
        { status: 422 },
      );
    }

    const values = Object.fromEntries(
      PRICE_EDITABLE_COLUMNS.map((key) => [key, parsed.data[key]]),
    );
    const { error: reviewError } = await client.rpc("review_official_price_with_alias_proposals", {
      p_price_id: idResult.data,
      p_actor_id: userId,
      p_action: parsed.data.action,
      p_values: values,
      p_options: parsed.data.options,
      p_selected_proposal_ids: parsed.data.selected_alias_proposal_ids,
      p_expected_review_version: parsed.data.expected_review_version,
    });
    if (reviewError) {
      if (isReviewVersionConflict(reviewError)) return reviewVersionConflictResponse();
      if (isPublicTextPrivacyViolation(reviewError)) return publicTextPrivacyResponse();
      if (isPublicTextLengthViolation(reviewError)) return publicTextLengthResponse();
      return NextResponse.json(
        { error: "검수 내용을 저장하지 못했습니다. 근거와 옵션을 다시 확인해 주세요." },
        { status: 409 },
      );
    }

    const { data: saved, error: writeError } = await client
      .from("official_prices")
      .select(`
        id, category, item_name, base_spec, price_min_krw, price_max_krw,
        vat_note, price_note, review_status, needs_review,
        source_file, source_object_keys, source_quote, confidence,
        edited_by_admin, review_version, created_at, updated_at,
        options:official_price_options(
          id, name, price_min_krw, price_max_krw, unit, condition,
          raw_text, source_quote, confidence
        ),
        alias_proposals:vendor_alias_proposals(id, alias, status, reviewed_at)
      `)
      .eq("id", idResult.data)
      .single();
    if (writeError || !saved) {
      return NextResponse.json(
        { error: "검수 내용을 저장하지 못했습니다. 다시 시도해 주세요." },
        { status: 500 },
      );
    }

    return NextResponse.json({ price: safePriceResponse(saved as PriceRow) });
  } catch {
    return NextResponse.json(
      { error: "검수 내용을 저장하지 못했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
