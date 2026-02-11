import { createClient } from "@/lib/supabase/client";
import { CategoryId, CategoryStatus } from "@/types";

interface JourneyData {
  id: string;
  couple_id: string;
  wedding_date: string | null;
  category_statuses: Record<string, CategoryStatus>;
  checklist_progress: Record<string, boolean>;
  priority_category: CategoryId | null;
  total_budget: number | null;
  sdme_budget: number | null;
  is_onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

// 커플 ID로 여정 조회 또는 생성
export async function getOrCreateJourney(coupleId: string): Promise<JourneyData | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("wedding_journeys")
    .select("*")
    .eq("couple_id", coupleId)
    .single();

  if (data) return data as JourneyData;

  if (error && error.code === "PGRST116") {
    // 여정이 없으면 생성
    const { data: newJourney, error: createError } = await supabase
      .from("wedding_journeys")
      .insert({
        couple_id: coupleId,
        category_statuses: {},
        checklist_progress: {},
        is_onboarding_complete: false,
      })
      .select()
      .single();

    if (createError) {
      console.error("여정 생성 실패:", createError);
      return null;
    }
    return newJourney as JourneyData;
  }

  console.error("여정 조회 실패:", error);
  return null;
}

// 여정 데이터 업데이트
export async function updateJourney(
  journeyId: string,
  updates: Partial<Pick<JourneyData, "wedding_date" | "category_statuses" | "checklist_progress" | "priority_category" | "total_budget" | "sdme_budget" | "is_onboarding_complete">>
) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("wedding_journeys")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", journeyId)
    .select()
    .single();

  if (error) {
    console.error("여정 업데이트 실패:", error);
    return null;
  }
  return data as JourneyData;
}

// 커플 ID 기준 upsert (앱의 syncService 패턴)
export async function syncJourney(
  coupleId: string,
  data: {
    wedding_date?: string | null;
    category_statuses?: Record<string, CategoryStatus>;
    checklist_progress?: Record<string, boolean>;
    priority_category?: CategoryId | null;
    is_onboarding_complete?: boolean;
  }
) {
  const supabase = createClient();

  const { error } = await supabase
    .from("wedding_journeys")
    .upsert(
      {
        couple_id: coupleId,
        ...data,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "couple_id" }
    );

  if (error) {
    console.error("여정 동기화 실패:", error);
    return false;
  }
  return true;
}

// 프로필에서 커플 정보 가져오기
export async function getProfileAndCouple(userId: string) {
  const supabase = createClient();

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("couple_id, role, name, email")
    .eq("id", userId)
    .single();

  if (error || !profile) {
    console.error("프로필 조회 실패:", error);
    return null;
  }

  return profile as { couple_id: string | null; role: string | null; name: string | null; email: string | null };
}

// 커플 정보 조회
export async function getCouple(coupleId: string) {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("couples")
    .select("*")
    .eq("id", coupleId)
    .single();

  if (error) {
    console.error("커플 조회 실패:", error);
    return null;
  }
  return data;
}

// 여정 실시간 구독
export function subscribeToJourney(
  coupleId: string,
  callback: (journey: JourneyData) => void
) {
  const supabase = createClient();

  const channel = supabase
    .channel(`journey:${coupleId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "wedding_journeys",
        filter: `couple_id=eq.${coupleId}`,
      },
      (payload) => {
        if (payload.new) {
          callback(payload.new as JourneyData);
        }
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
