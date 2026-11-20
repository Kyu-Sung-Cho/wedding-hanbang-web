import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecord, isUuid } from "@/utils/requestValidation";

/**
 * 요청한 사람이 어느 커플의 지금 회원인지, 상대는 누구인지, 준비 정보가 무엇인지 읽는다.
 *
 * 읽기는 사용자 권한(RLS)으로 한다. 회원 판정은 SQL 의 `is_current_couple_member` 와 같은 기준을 쓴다
 * — 프로필의 커플과 역할이 커플 표의 자리와 맞아야 한다. 쓰기 함수는 DB 안에서 같은 판정을 다시 한다.
 */

export type CoupleMember = { id: string; name: string | null };

export type JourneySnapshot = {
  weddingDate: string | null;
  venue: string | null;
  totalBudget: number | null;
  progress: Record<string, unknown>;
  stateRevision: number;
};

export type CoupleContext = {
  userId: string;
  coupleId: string;
  /** 커플 표의 자리 순서(첫 자리, 둘째 자리)이고 지금 읽을 수 있는 회원만 든다. */
  members: readonly CoupleMember[];
  viewer: CoupleMember;
  partner: CoupleMember | null;
  /** 상대가 들어와 두 사람 자리가 닫혔다(`couples.membership_sealed_at`). */
  partnerJoined: boolean;
  journey: JourneySnapshot | null;
};

export type CoupleContextFailure = { ok: false; status: 403 | 409 | 503; code: string; error: string };
export type CoupleContextResult = { ok: true; context: CoupleContext } | CoupleContextFailure;

const unavailable = (): CoupleContextFailure => ({
  ok: false,
  status: 503,
  code: "COUPLE_UNAVAILABLE",
  error: "준비 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.",
});

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseJourney(value: unknown): JourneySnapshot | null {
  if (!isRecord(value)) return null;
  const revision = value.state_revision;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) return null;
  const weddingDate = typeof value.wedding_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.wedding_date)
    ? value.wedding_date
    : null;
  const budget = typeof value.total_budget === "number" && Number.isSafeInteger(value.total_budget) && value.total_budget > 0
    ? value.total_budget
    : null;
  return {
    weddingDate,
    venue: cleanName(value.venue),
    totalBudget: budget,
    progress: isRecord(value.progress) ? value.progress : {},
    stateRevision: revision,
  };
}

export async function loadCoupleContext(
  supabase: SupabaseClient,
  userId: string,
  options: { journey?: boolean } = {},
): Promise<CoupleContextResult> {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, role, couple_id")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return unavailable();
  if (!isRecord(profile) || !isUuid(profile.couple_id)) {
    return { ok: false, status: 409, code: "COUPLE_REQUIRED", error: "커플 연결이 필요해요." };
  }
  const coupleId = profile.couple_id.toLowerCase();

  const { data: couple, error: coupleError } = await supabase
    .from("couples")
    .select("id, bride_id, groom_id, membership_sealed_at")
    .eq("id", coupleId)
    .maybeSingle();
  if (coupleError) return unavailable();
  if (!isRecord(couple)) {
    return { ok: false, status: 403, code: "NOT_COUPLE_MEMBER", error: "이 커플의 준비 정보를 볼 수 없어요." };
  }

  const brideId = isUuid(couple.bride_id) ? couple.bride_id.toLowerCase() : null;
  const groomId = isUuid(couple.groom_id) ? couple.groom_id.toLowerCase() : null;
  const viewerId = userId.toLowerCase();
  const seatMatches = (profile.role === "bride" && brideId === viewerId) || (profile.role === "groom" && groomId === viewerId);
  if (!seatMatches) {
    return { ok: false, status: 403, code: "NOT_COUPLE_MEMBER", error: "이 커플의 준비 정보를 볼 수 없어요." };
  }

  const partnerId = brideId === viewerId ? groomId : brideId;
  let partner: CoupleMember | null = null;
  if (partnerId) {
    const { data: partnerRow, error: partnerError } = await supabase
      .from("couple_profile_directory")
      .select("id, name")
      .eq("id", partnerId)
      .maybeSingle();
    if (partnerError) return unavailable();
    if (isRecord(partnerRow) && partnerRow.id === partnerId) {
      partner = { id: partnerId, name: cleanName(partnerRow.name) };
    }
  }

  let journey: JourneySnapshot | null = null;
  if (options.journey !== false) {
    const { data: journeyRow, error: journeyError } = await supabase
      .from("wedding_journeys")
      .select("wedding_date, venue, total_budget, progress, state_revision")
      .eq("couple_id", coupleId)
      .maybeSingle();
    if (journeyError) return unavailable();
    journey = parseJourney(journeyRow);
  }

  const viewer: CoupleMember = { id: viewerId, name: cleanName(profile.name) };
  const seats = brideId === viewerId ? [viewer, partner] : [partner, viewer];
  return {
    ok: true,
    context: {
      userId: viewerId,
      coupleId,
      members: seats.filter((member): member is CoupleMember => member !== null),
      viewer,
      partner,
      partnerJoined: partner !== null && typeof couple.membership_sealed_at === "string",
      journey,
    },
  };
}
