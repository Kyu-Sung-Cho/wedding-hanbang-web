import { NextRequest, NextResponse } from "next/server";
import { USER_RESEARCH_COHORT_CODE } from "@/constants/beta";
import { buildVerifiedResearchApplicationDailyCounts } from "@/lib/admin/researchApplicationStats";
import { getServiceClient, verifyAdmin } from "@/lib/utils/adminAuth";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };
const REGISTRATION_PAGE_SIZE = 500;
const MAX_REGISTRATIONS_PER_RESPONSE = 10_000;

type ServiceClient = ReturnType<typeof getServiceClient>;
type Registration = Record<string, unknown> & {
  id: string;
  created_at: string;
  email_verified_at?: unknown;
};

interface RegistrationCursor {
  createdAt: string;
  id: string;
}

class RegistrationLoadError extends Error {
  constructor(readonly code: "query" | "invalid_cursor" | "safe_cap") {
    super(code);
    this.name = "RegistrationLoadError";
  }
}

function cursorFromRow(row: unknown): RegistrationCursor {
  if (!row || typeof row !== "object") {
    throw new RegistrationLoadError("invalid_cursor");
  }

  const { created_at: createdAt, id } = row as Record<string, unknown>;
  // These values come from NOT NULL database columns, but they are interpolated
  // into PostgREST's `.or()` grammar. Reject unexpected database output instead
  // of ever constructing an ambiguous filter.
  if (
    typeof createdAt !== "string" ||
    !/^[0-9T:.+\-Z]+$/.test(createdAt) ||
    typeof id !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw new RegistrationLoadError("invalid_cursor");
  }

  return { createdAt, id };
}

/**
 * Loads every row in a stable `(created_at, id)` order without relying on the
 * hosted PostgREST row cap. `snapshotUpperBound` excludes applications created
 * after this request began; strict tuple cursors prevent page overlap when an
 * insert happens while later pages are being fetched.
 */
async function loadAllRegistrations(
  supabase: ServiceClient,
  snapshotUpperBound: string
): Promise<Registration[]> {
  const registrations: Registration[] = [];
  let cursor: RegistrationCursor | null = null;

  for (;;) {
    let query = supabase
      .from("research_cohort_applications")
      .select("*", { count: "exact" })
      .eq("cohort_code", USER_RESEARCH_COHORT_CODE)
      .not("privacy_consent_at", "is", null)
      .gt("expires_at", snapshotUpperBound)
      .lte("created_at", snapshotUpperBound);

    if (cursor) {
      query = query.or(
        `created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`
      );
    }

    const { data, error, count } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(REGISTRATION_PAGE_SIZE);

    if (error) {
      throw new RegistrationLoadError("query");
    }

    const rows = (data ?? []) as Registration[];
    if (count === null || !Number.isSafeInteger(count) || count < rows.length) {
      throw new RegistrationLoadError("query");
    }

    // `count: exact` makes this independent of the hosted PostgREST max-row
    // setting. A smaller server cap produces a shorter page, not false EOF.
    if (registrations.length + count > MAX_REGISTRATIONS_PER_RESPONSE) {
      throw new RegistrationLoadError("safe_cap");
    }
    registrations.push(...rows);

    if (count === rows.length) return registrations;
    if (rows.length === 0) throw new RegistrationLoadError("query");

    cursor = cursorFromRow(rows.at(-1));
  }
}

export async function GET(request: NextRequest) {
  try {
    const { authorized } = await verifyAdmin(request);
    if (!authorized) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: PRIVATE_HEADERS }
      );
    }

    const supabase = getServiceClient();
    const now = new Date();
    const nowIso = now.toISOString();

    const { error: purgeError } = await supabase
      .from("research_cohort_applications")
      .delete()
      .lt("expires_at", nowIso);
    if (purgeError) {
      console.error("ADMIN_REGISTRATIONS_EXPIRED_PURGE_FAILED");
      return NextResponse.json(
        { error: "보유기간이 지난 신청 정보를 정리하지 못했습니다." },
        { status: 503, headers: PRIVATE_HEADERS }
      );
    }

    let registrations: Registration[];
    try {
      registrations = await loadAllRegistrations(supabase, nowIso);
    } catch (error) {
      const event =
        error instanceof RegistrationLoadError && error.code === "safe_cap"
          ? "ADMIN_REGISTRATIONS_SAFE_CAP_EXCEEDED"
          : error instanceof RegistrationLoadError && error.code === "invalid_cursor"
            ? "ADMIN_REGISTRATIONS_INVALID_CURSOR"
            : "ADMIN_REGISTRATIONS_QUERY_FAILED";
      console.error(event);
      return NextResponse.json(
        { error: "사용자 연구 신청 정보를 불러올 수 없습니다." },
        { status: 503, headers: PRIVATE_HEADERS }
      );
    }

    const verifiedRegistrations = registrations.filter((registration) =>
      Boolean(registration.email_verified_at)
    );
    const total = verifiedRegistrations.length;
    const submittedTotal = registrations.length;
    const pendingVerificationTotal = submittedTotal - total;
    const dailyCounts = buildVerifiedResearchApplicationDailyCounts(registrations, now);

    return NextResponse.json(
      {
        registrations,
        total,
        submittedTotal,
        pendingVerificationTotal,
        dailyCounts,
      },
      { headers: PRIVATE_HEADERS }
    );
  } catch {
    console.error("ADMIN_REGISTRATIONS_UNEXPECTED_FAILURE");
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      { status: 500, headers: PRIVATE_HEADERS }
    );
  }
}
