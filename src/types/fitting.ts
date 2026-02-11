export type FittingStatus = "pending" | "processing" | "completed" | "failed";

export interface FittingRequest {
  id: string;
  user_id: string;
  couple_id: string;
  user_photo_url: string;
  dress_style: string;
  status: FittingStatus;
  result_url: string | null;
  video_url: string | null;
  cost_krw: number;
  is_saved: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface FittingUsage {
  id: string;
  user_id: string;
  couple_id: string;
  period_start: string;
  free_limit: number;
  free_used: number;
}

export const DRESS_STYLES = [
  { id: "a_line", label: "A라인", emoji: "👗", description: "클래식하고 우아한 실루엣" },
  { id: "mermaid", label: "머메이드", emoji: "🧜‍♀️", description: "몸매를 강조하는 피트앤플레어" },
  { id: "ball_gown", label: "볼가운", emoji: "👸", description: "풍성하고 화려한 공주풍" },
  { id: "empire", label: "엠파이어", emoji: "🏛️", description: "하이웨이스트로 우아한 라인" },
  { id: "sheath", label: "시스", emoji: "✨", description: "슬림하고 모던한 직선 실루엣" },
  { id: "tea_length", label: "티 렝스", emoji: "🌸", description: "종아리 길이의 빈티지 스타일" },
] as const;
