/**
 * AI 실시간 드레스 피팅 관련 타입 정의
 * Decart API (Lucy Pro V2V) 기반 실시간 카메라 피팅
 * 앱과 동일한 타입 구조 사용
 */

// 피팅 세션 상태
export type FittingStatus = "pending" | "streaming" | "completed" | "failed";

/**
 * 드레스 피팅 이미지 (업체 등록)
 * dress_fitting_images 테이블
 */
export interface DressFittingImage {
  id: string;
  vendor_id: string;
  product_id: string | null;
  image_url: string;
  is_fitting_enabled: boolean;
}

/**
 * 피팅 세션/결과 (실시간 카메라 기반)
 * fitting_requests 테이블
 */
export interface FittingRequest {
  id: string;
  couple_id: string;
  vendor_id?: string;
  dress_image_url: string;
  status: FittingStatus;
  session_id: string | null;
  saved_video_url: string | null;
  cost_krw: number;
  is_saved: boolean;
  expires_at: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * 실시간 피팅 세션 생성 입력
 */
export interface FittingSessionInput {
  vendorId?: string;
  dressImageUrl: string;
}

/**
 * 실시간 피팅 세션 응답
 */
export interface FittingSessionResponse {
  requestId: string;
  sessionId: string;
  streamUrl: string;
  cost: number;
}

/**
 * 피팅 서비스 응답
 */
export interface FittingServiceResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
