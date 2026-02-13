/**
 * AI 실시간 드레스 피팅 서비스
 * Decart API (Lucy Pro V2V) 기반 실시간 카메라 피팅
 * 무료 체험 없음 - 매 세션당 10,000원 과금
 * 앱과 동일한 서비스 구조 사용
 */

import { createClient } from "@/lib/supabase/client";
import {
  DressFittingImage,
  FittingRequest,
  FittingServiceResponse,
  FittingSessionInput,
  FittingSessionResponse,
} from "@/types/fitting";

// 피팅 비용 상수
export const FITTING_COST_KRW = 10000;

// =====================================================
// 드레스 이미지 관련
// =====================================================

/** 업체의 피팅 가능한 드레스 이미지 조회 */
export async function getDressImages(
  vendorId: string
): Promise<FittingServiceResponse<DressFittingImage[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dress_fitting_images")
      .select("*")
      .eq("vendor_id", vendorId)
      .eq("is_fitting_enabled", true);

    if (error) throw error;

    return { success: true, data: data as DressFittingImage[] };
  } catch (error) {
    console.error("[FittingService] getDressImages error:", error);
    return { success: false, error: "드레스 이미지를 불러오는데 실패했습니다." };
  }
}

/** 모든 피팅 가능 드레스 이미지 조회 */
export async function getAllDressImages(): Promise<FittingServiceResponse<DressFittingImage[]>> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("dress_fitting_images")
      .select("*")
      .eq("is_fitting_enabled", true)
      .limit(50);

    if (error) throw error;

    return { success: true, data: data as DressFittingImage[] };
  } catch (error) {
    console.error("[FittingService] getAllDressImages error:", error);
    return { success: false, error: "드레스 이미지를 불러오는데 실패했습니다." };
  }
}

// =====================================================
// 실시간 피팅 세션 관련
// =====================================================

/** 실시간 피팅 세션 생성 (Supabase Edge Function) */
export async function createFittingSession(
  input: FittingSessionInput,
  coupleId: string
): Promise<FittingServiceResponse<FittingSessionResponse>> {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "로그인이 필요합니다." };
    }

    // DB에 세션 레코드 생성
    const { data: requestData, error: requestError } = await supabase
      .from("fitting_requests")
      .insert({
        couple_id: coupleId,
        vendor_id: input.vendorId || null,
        dress_image_url: input.dressImageUrl,
        status: "pending",
        cost_krw: FITTING_COST_KRW,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      })
      .select()
      .single();

    if (requestError) throw requestError;

    // Supabase Edge Function 호출 (실시간 세션 생성)
    const { data: functionResult, error: functionError } = await supabase.functions.invoke(
      "fitting-session",
      {
        body: {
          requestId: requestData.id,
          dressImageUrl: input.dressImageUrl,
        },
      }
    );

    if (functionError) {
      // 요청 실패 시 상태 업데이트
      await supabase
        .from("fitting_requests")
        .update({ status: "failed" })
        .eq("id", requestData.id);
      throw functionError;
    }

    // 세션 정보로 DB 업데이트
    await supabase
      .from("fitting_requests")
      .update({
        session_id: functionResult?.sessionId,
        status: "streaming",
      })
      .eq("id", requestData.id);

    return {
      success: true,
      data: {
        requestId: requestData.id,
        sessionId: functionResult?.sessionId || "",
        streamUrl: functionResult?.streamUrl || "",
        cost: FITTING_COST_KRW,
      },
    };
  } catch (error) {
    console.error("[FittingService] createFittingSession error:", error);
    return { success: false, error: "피팅 세션 생성에 실패했습니다." };
  }
}

/** 피팅 세션 종료 */
export async function endFittingSession(
  requestId: string
): Promise<FittingServiceResponse<void>> {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from("fitting_requests")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("[FittingService] endFittingSession error:", error);
    return { success: false, error: "세션 종료에 실패했습니다." };
  }
}

// =====================================================
// 영상/캡처 저장
// =====================================================

/** 실시간 피팅 영상 캡처 저장 (웹: Blob 기반) */
export async function saveVideoCapture(
  requestId: string,
  videoBlob: Blob
): Promise<FittingServiceResponse<string>> {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "로그인이 필요합니다." };
    }

    // 영상 파일 업로드
    const fileName = `fitting/${requestId}_${Date.now()}.webm`;

    const { error: uploadError } = await supabase.storage
      .from("fitting-videos")
      .upload(fileName, videoBlob, {
        contentType: "video/webm",
        upsert: false,
      });

    if (uploadError) throw uploadError;

    // 공개 URL 가져오기
    const { data: urlData } = supabase.storage
      .from("fitting-videos")
      .getPublicUrl(fileName);

    // DB 업데이트
    const { error: updateError } = await supabase
      .from("fitting_requests")
      .update({
        saved_video_url: urlData.publicUrl,
        is_saved: true,
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", requestId);

    if (updateError) throw updateError;

    return { success: true, data: urlData.publicUrl };
  } catch (error) {
    console.error("[FittingService] saveVideoCapture error:", error);
    return { success: false, error: "영상 저장에 실패했습니다." };
  }
}

// =====================================================
// 피팅 기록
// =====================================================

/** 내 피팅 기록 조회 */
export async function getMyFittings(
  coupleId: string
): Promise<FittingServiceResponse<FittingRequest[]>> {
  try {
    const supabase = createClient();

    const { data, error } = await supabase
      .from("fitting_requests")
      .select("*")
      .eq("couple_id", coupleId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    return { success: true, data: data as FittingRequest[] };
  } catch (error) {
    console.error("[FittingService] getMyFittings error:", error);
    return { success: false, error: "피팅 기록을 불러오는데 실패했습니다." };
  }
}

/** 피팅 저장 (만료 방지) */
export async function saveFitting(
  requestId: string
): Promise<FittingServiceResponse<void>> {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from("fitting_requests")
      .update({
        is_saved: true,
        expires_at: null,
      })
      .eq("id", requestId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("[FittingService] saveFitting error:", error);
    return { success: false, error: "저장에 실패했습니다." };
  }
}

/** 피팅 삭제 */
export async function deleteFitting(
  requestId: string
): Promise<FittingServiceResponse<void>> {
  try {
    const supabase = createClient();

    const { error } = await supabase
      .from("fitting_requests")
      .delete()
      .eq("id", requestId);

    if (error) throw error;

    return { success: true };
  } catch (error) {
    console.error("[FittingService] deleteFitting error:", error);
    return { success: false, error: "삭제에 실패했습니다." };
  }
}

/** 드레스 이미지 업로드 (웹 전용: 사용자가 직접 드레스 사진 업로드) */
export async function uploadDressImage(
  file: File
): Promise<FittingServiceResponse<string>> {
  try {
    const supabase = createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return { success: false, error: "로그인이 필요합니다." };
    }

    const ext = file.name.split(".").pop();
    const path = `dress-images/${user.id}/${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("user-photos")
      .upload(path, file, { upsert: true });

    if (error) throw error;

    const { data: urlData } = supabase.storage
      .from("user-photos")
      .getPublicUrl(path);

    return { success: true, data: urlData.publicUrl };
  } catch (error) {
    console.error("[FittingService] uploadDressImage error:", error);
    return { success: false, error: "이미지 업로드에 실패했습니다." };
  }
}
