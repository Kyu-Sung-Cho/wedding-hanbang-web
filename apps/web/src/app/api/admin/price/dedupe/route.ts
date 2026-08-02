import { AdminNextResponse as NextResponse } from "@/lib/admin/privateResponse";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";
import { checkAdminReadRateLimit } from "@/lib/admin/adminReadBoundary";

const KINDS = new Set(["vendor", "agency"]);
const STATUSES = new Set(["pending", "same", "different", "superseded", "all"]);

export async function GET(request: Request) {
  const { authorized, userId } = await verifyAdmin(request);
  if (!authorized || !userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = await checkAdminReadRateLimit(request, userId, "price-dedupe");
  if (limited) return limited;

  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get("kind");
  if (!kind || !KINDS.has(kind)) {
    return NextResponse.json(
      { error: "중복 판단 대상(kind=vendor 또는 kind=agency)을 지정해 주세요." },
      { status: 400 },
    );
  }

  const status = searchParams.get("status") ?? "pending";
  if (!STATUSES.has(status)) {
    return NextResponse.json({ error: "유효하지 않은 중복 판단 상태입니다." }, { status: 400 });
  }

  try {
    const client = getServiceClient();
    const baseQuery = kind === "vendor"
      ? client
          .from("vendor_dedupe_candidates")
          .select(`
            id, reason, similarity, status, preserved_vendor_id, decided_at, created_at,
            left_vendor:vendors!vendor_dedupe_candidates_left_vendor_id_fkey(
              id, name, aliases, category, region_code, slug, enrichment_status
            ),
            right_vendor:vendors!vendor_dedupe_candidates_right_vendor_id_fkey(
              id, name, aliases, category, region_code, slug, enrichment_status
            )
          `)
      : client
          .from("agency_dedupe_candidates")
          .select(`
            id, reason, similarity, status, preserved_agency_id, decided_at, created_at,
            left_agency:agencies!agency_dedupe_candidates_left_agency_id_fkey(
              id, name, normalized_name, corporate_name, aliases, region_code
            ),
            right_agency:agencies!agency_dedupe_candidates_right_agency_id_fkey(
              id, name, normalized_name, corporate_name, aliases, region_code
            )
          `);

    let query = baseQuery
      .order("similarity", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query.limit(100);
    if (error) {
      return NextResponse.json(
        { error: "중복 후보를 불러오지 못했습니다." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      candidates: (data ?? []).map((candidate) => ({
        ...candidate,
        entity_kind: kind,
      })),
      filters: { kind, status },
    });
  } catch {
    return NextResponse.json(
      { error: "중복 후보를 불러오지 못했습니다." },
      { status: 500 },
    );
  }
}
