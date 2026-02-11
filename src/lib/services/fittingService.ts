import { createClient } from "@/lib/supabase/client";
import { FittingRequest, FittingUsage } from "@/types/fitting";

// 피팅 사용량 조회 (이번 달)
export async function getFittingUsage(userId: string, coupleId: string): Promise<FittingUsage | null> {
  const supabase = createClient();
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data } = await supabase
    .from("fitting_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("couple_id", coupleId)
    .gte("period_start", periodStart)
    .order("period_start", { ascending: false })
    .limit(1)
    .single();

  return data as FittingUsage | null;
}

// 피팅 사용량 업데이트 (또는 생성)
export async function incrementFittingUsage(userId: string, coupleId: string): Promise<void> {
  const supabase = createClient();
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

  // 기존 사용량 조회
  const { data: existing } = await supabase
    .from("fitting_usage")
    .select("*")
    .eq("user_id", userId)
    .eq("couple_id", coupleId)
    .eq("period_start", periodStart)
    .single();

  if (existing) {
    await supabase
      .from("fitting_usage")
      .update({ free_used: existing.free_used + 1 })
      .eq("id", existing.id);
  } else {
    await supabase
      .from("fitting_usage")
      .insert({
        user_id: userId,
        couple_id: coupleId,
        period_start: periodStart,
        free_limit: 5,
        free_used: 1,
      });
  }
}

// 피팅 요청 생성
export async function createFittingRequest(
  userId: string,
  coupleId: string,
  userPhotoUrl: string,
  dressStyle: string
): Promise<FittingRequest | null> {
  const supabase = createClient();

  const { data, error } = await supabase
    .from("fitting_requests")
    .insert({
      user_id: userId,
      couple_id: coupleId,
      user_photo_url: userPhotoUrl,
      dress_style: dressStyle,
      status: "pending",
      cost_krw: 0,
      is_saved: false,
    })
    .select()
    .single();

  if (error) {
    console.error("피팅 요청 생성 실패:", error);
    return null;
  }

  return data as FittingRequest;
}

// 피팅 결과 조회 (상태 폴링)
export async function getFittingRequest(requestId: string): Promise<FittingRequest | null> {
  const supabase = createClient();

  const { data } = await supabase
    .from("fitting_requests")
    .select("*")
    .eq("id", requestId)
    .single();

  return data as FittingRequest | null;
}

// 피팅 히스토리 조회
export async function getFittingHistory(coupleId: string): Promise<FittingRequest[]> {
  const supabase = createClient();

  const { data } = await supabase
    .from("fitting_requests")
    .select("*")
    .eq("couple_id", coupleId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (data || []) as FittingRequest[];
}

// 피팅 저장 토글
export async function toggleFittingSave(requestId: string, isSaved: boolean): Promise<void> {
  const supabase = createClient();

  await supabase
    .from("fitting_requests")
    .update({ is_saved: isSaved })
    .eq("id", requestId);
}

// 피팅 삭제
export async function deleteFitting(requestId: string): Promise<void> {
  const supabase = createClient();

  await supabase
    .from("fitting_requests")
    .delete()
    .eq("id", requestId);
}

// 사용자 사진 업로드
export async function uploadUserPhoto(userId: string, file: File): Promise<string | null> {
  const supabase = createClient();
  const ext = file.name.split(".").pop();
  const path = `fitting/${userId}/${Date.now()}.${ext}`;

  const { error } = await supabase.storage
    .from("user-photos")
    .upload(path, file, { upsert: true });

  if (error) {
    console.error("사진 업로드 실패:", error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from("user-photos")
    .getPublicUrl(path);

  return urlData.publicUrl;
}

// Edge Function을 통한 AI 피팅 실행
export async function startAIFitting(requestId: string): Promise<boolean> {
  const supabase = createClient();

  const { error } = await supabase.functions.invoke("dress-fitting", {
    body: { fitting_request_id: requestId },
  });

  if (error) {
    console.error("AI 피팅 Edge Function 호출 실패:", error);
    return false;
  }

  return true;
}
