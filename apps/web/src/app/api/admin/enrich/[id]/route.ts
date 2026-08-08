import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { z } from "zod";
import {
  buildVendorSearchLinks,
  deriveApprovedFittingFeeSuggestion,
  isSafeDisclosureObjectKey,
  mergePrivateEnrichmentAttributes,
  normalizeVendorCategory,
  parseEnrichmentSubmission,
  sourceFileLabel,
  sourceFileLabels,
  vendorRegionLabel,
} from "@/lib/admin/vendorWorkspace";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { isTrustedMutationRequest } from "@/utils/trustedMutation";

type UnknownRecord = Record<string, unknown>;
const ACTIVE_VENDOR_STATUSES = ["pending", "approved"] as const;

function joined(value: unknown): UnknownRecord | null {
  const record = Array.isArray(value) ? value[0] : value;
  return record && typeof record === "object" ? record as UnknownRecord : null;
}

function publicPrice(raw: unknown) {
  const row = raw as UnknownRecord;
  const { source_file: sourceFile, source_object_keys: sourceObjectKeys, ...safe } = row;
  const keys = Array.isArray(sourceObjectKeys)
    ? sourceObjectKeys.filter((value): value is string => typeof value === "string")
    : [];
  const sourceAvailable = keys.length > 0 && keys.every(isSafeDisclosureObjectKey);
  return {
    ...safe,
    snapshot: joined(row.snapshot),
    agency: joined(row.agency),
    options: Array.isArray(row.options) ? row.options : [],
    source_available: sourceAvailable,
    source_count: sourceAvailable ? keys.length : 0,
    source_file_label: sourceFileLabel(typeof sourceFile === "string" ? sourceFile : null),
    source_file_labels: sourceFileLabels(typeof sourceFile === "string" ? sourceFile : null),
  };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
  }

  try {
    const client = getServiceClient();
    const [vendorResult, assignmentResult, tagResult, priceResult] = await Promise.all([
      client
        .from("vendors")
        .select(`
          id, name, slug, category, region_code,
          official_url, instagram_url, naver_place_url,
          attributes, enrichment_status, enriched_at,
          private:vendor_enrichment_private(price_band, notes_internal, enriched_by)
        `)
        .eq("id", id.data)
        .in("status", [...ACTIVE_VENDOR_STATUSES])
        .single(),
      client.from("vendor_tags").select("tag_id").eq("vendor_id", id.data),
      client
        .from("tags")
        .select("id, category, tag_group, slug, label")
        .eq("is_active", true)
        .order("tag_group", { ascending: true })
        .order("label", { ascending: true }),
      client
        .from("official_prices")
        .select(`
          id, category, item_name, base_spec,
          price_min_krw, price_max_krw, vat_note, price_note,
          source_file, source_object_keys, source_quote, confidence, review_status,
          snapshot:price_snapshots(period_label, source, published_at),
          agency:agencies(id, name, region_code),
          options:official_price_options(
            id, name, price_min_krw, price_max_krw,
            unit, condition, raw_text, source_quote, confidence
          )
        `)
        .eq("vendor_id", id.data)
        .order("confidence", { ascending: true, nullsFirst: true }),
    ]);
    if (vendorResult.error || !vendorResult.data) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }
    if (assignmentResult.error || tagResult.error || priceResult.error) {
      return NextResponse.json(
        { error: "업체 보강 정보를 불러오지 못했습니다." },
        { status: 500 },
      );
    }

    const vendor = vendorResult.data as UnknownRecord;
    const category = normalizeVendorCategory(String(vendor.category ?? ""));
    if (!category) {
      return NextResponse.json(
        { error: "아직 보강 폼을 지원하지 않는 업체 유형입니다." },
        { status: 422 },
      );
    }
    const privateRow = joined(vendor.private);
    const adminAttributes = mergePrivateEnrichmentAttributes(
      vendor.attributes,
      privateRow?.price_band,
    );
    const assignedIds = new Set(
      (assignmentResult.data ?? []).map((row) => String((row as UnknownRecord).tag_id)),
    );
    const tags = (tagResult.data ?? []).flatMap((raw) => {
      const tag = raw as UnknownRecord;
      const tagCategory = normalizeVendorCategory(String(tag.category ?? ""));
      if (tag.category !== null && tagCategory !== category) return [];
      return [{ ...tag, selected: assignedIds.has(String(tag.id)) }];
    });
    const name = String(vendor.name ?? "");
    const region = vendorRegionLabel(vendor.region_code);

    const prices = (priceResult.data ?? []).map(publicPrice);
    return NextResponse.json({
      vendor: {
        id: vendor.id,
        name,
        slug: vendor.slug,
        category,
        region_code: vendor.region_code,
        official_url: vendor.official_url,
        instagram_url: vendor.instagram_url,
        naver_place_url: vendor.naver_place_url,
        attributes: adminAttributes,
        notes_internal: typeof privateRow?.notes_internal === "string" ? privateRow.notes_internal : "",
        enrichment_status: vendor.enrichment_status,
        enriched_at: vendor.enriched_at,
        assigned_to_me: privateRow?.enriched_by === userId,
        is_assigned: typeof privateRow?.enriched_by === "string",
      },
      tags,
      prices,
      attribute_suggestions: category === "dress"
        ? { fitting_fee_krw: deriveApprovedFittingFeeSuggestion(prices) }
        : {},
      search_links: buildVendorSearchLinks(name, region),
    });
  } catch {
    return NextResponse.json(
      { error: "업체 보강 정보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isTrustedMutationRequest(request)) {
    return NextResponse.json(
      { error: "Forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) {
    return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    const { data: vendor, error: vendorError } = await client
      .from("vendors")
      .select("id, category")
      .eq("id", id.data)
      .in("status", [...ACTIVE_VENDOR_STATUSES])
      .single();
    if (vendorError || !vendor) {
      return NextResponse.json({ error: "업체를 찾을 수 없습니다." }, { status: 404 });
    }
    const category = normalizeVendorCategory(vendor.category);
    if (!category) {
      return NextResponse.json(
        { error: "아직 보강 폼을 지원하지 않는 업체 유형입니다." },
        { status: 422 },
      );
    }
    const parsed = parseEnrichmentSubmission(category, body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "입력값을 확인해 주세요.", issues: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { error } = await client.rpc("save_vendor_enrichment", {
      p_vendor_id: id.data,
      p_actor_id: userId,
      p_official_url: parsed.data.officialUrl,
      p_instagram_url: parsed.data.instagramUrl,
      p_naver_place_url: parsed.data.naverPlaceUrl,
      p_attributes: parsed.data.publicAttributes,
      p_price_band: parsed.data.priceBand,
      p_notes_internal: parsed.data.notesInternal,
      p_tag_ids: parsed.data.tagIds,
      p_complete: parsed.data.action === "complete",
    });
    if (error) {
      return NextResponse.json(
        { error: "업체 정보를 저장하지 못했습니다. 태그와 URL을 다시 확인해 주세요." },
        { status: 409 },
      );
    }
    return NextResponse.json({
      saved: true,
      completed: parsed.data.action === "complete",
    });
  } catch {
    return NextResponse.json(
      { error: "업체 정보를 저장하지 못했습니다. 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
