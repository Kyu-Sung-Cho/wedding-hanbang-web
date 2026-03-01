// ============================================================
// 청첩장 관련 타입 정의
// ============================================================

// 템플릿 카테고리
export type TemplateCategory = "classic" | "modern" | "natural" | "season" | "unique";

// 오프닝 애니메이션 타입
export type OpeningAnimation =
  | "fadeIn" | "slideUp" | "zoomIn" | "curtainOpen" | "sparkle"
  | "heartBeat" | "typewriter" | "glitch" | "morphing" | "leafFall"
  | "floatUp" | "petalFall" | "waveSlide" | "snowFall" | "filmRoll"
  | "pageFlip" | "waterDrop" | "letterOpen" | "confetti" | "ripple"
  | "spiralIn" | "blindsOpen" | "fadeScale" | "slideRotate" | "bounceIn"
  | "flipCard" | "doorOpen" | "curtainReveal" | "lightReveal" | "parallaxZoom";

// 측 구분
export type Side = "groom" | "bride" | "both";

// RSVP 식사 옵션
export type MealOption = "한식" | "양식" | "뷔페" | "기타";

// 축의금 수단
export type MoneyMethod = "cash" | "transfer" | "etc";

// 관계 분류
export type Relation = "친구" | "직장동료" | "가족" | "친척" | "은사" | "이웃" | "기타";

// AI 대본 타입
export type ScriptType =
  | "mc_script" | "vow" | "parents_letter"
  | "friend_speech" | "invitation_text" | "thank_you";

// ============================================================
// 템플릿
// ============================================================
export interface InvitationTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  thumbnail_url: string | null;
  is_premium: boolean;
  color_palette: string[];
  font_pair: { heading: string; body: string };
  layout_config: Record<string, string>;
  opening_animation: OpeningAnimation;
  created_at: string;
}

// ============================================================
// 청첩장 인스턴스
// ============================================================
export interface Invitation {
  id: string;
  couple_id: string;
  template_id: string;
  slug: string;
  title: string;

  groom_name: string | null;
  groom_father: string | null;
  groom_mother: string | null;
  bride_name: string | null;
  bride_father: string | null;
  bride_mother: string | null;

  wedding_date: string | null;
  wedding_venue: string | null;
  wedding_address: string | null;
  wedding_hall: string | null;
  wedding_map_url: string | null;

  greeting_title: string;
  greeting_message: string | null;

  opening_animation: OpeningAnimation;
  background_music_url: string | null;
  rsvp_enabled: boolean;
  guestbook_enabled: boolean;
  account_enabled: boolean;

  custom_colors: string[] | null;
  custom_fonts: { heading: string; body: string } | null;

  is_published: boolean;
  view_count: number;
  created_at: string;
  updated_at: string;

  // 관계 데이터 (조인)
  template?: InvitationTemplate;
  photos?: InvitationPhoto[];
  accounts?: InvitationAccount[];
}

// ============================================================
// 갤러리 사진
// ============================================================
export interface InvitationPhoto {
  id: string;
  invitation_id: string;
  url: string;
  sort_order: number;
  caption: string | null;
  created_at: string;
}

// ============================================================
// 축의금 계좌
// ============================================================
export interface InvitationAccount {
  id: string;
  invitation_id: string;
  side: Side;
  label: string;
  bank: string;
  account_number: string;
  holder: string;
  sort_order: number;
  created_at: string;
}

// ============================================================
// RSVP
// ============================================================
export interface InvitationRsvp {
  id: string;
  invitation_id: string;
  guest_name: string;
  phone: string | null;
  attending: boolean;
  guest_count: number;
  meal_option: string | null;
  side: Side | null;
  message: string | null;
  created_at: string;
}

// ============================================================
// 방명록
// ============================================================
export interface InvitationGuestbook {
  id: string;
  invitation_id: string;
  guest_name: string;
  message: string;
  is_hidden: boolean;
  created_at: string;
}

// ============================================================
// 방문 기록
// ============================================================
export interface InvitationVisit {
  id: string;
  invitation_id: string;
  visitor_ip: string | null;
  user_agent: string | null;
  referrer: string | null;
  visited_at: string;
}

// ============================================================
// 축의금 내역
// ============================================================
export interface CongratulatoryMoney {
  id: string;
  couple_id: string;
  guest_name: string;
  amount: number;
  side: Side;
  relation: string | null;
  method: MoneyMethod;
  memo: string | null;
  received_at: string;
  created_at: string;
  updated_at: string;
}

// ============================================================
// AI 대본
// ============================================================
export interface AiScript {
  id: string;
  couple_id: string;
  script_type: ScriptType;
  title: string;
  content: string;
  params: Record<string, unknown>;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================
// 에디터 단계 (6단계)
// ============================================================
export type EditorStep =
  | "template"   // 1. 템플릿 선택
  | "info"       // 2. 신랑신부 정보
  | "wedding"    // 3. 예식 정보
  | "gallery"    // 4. 갤러리
  | "account"    // 5. 축의금 계좌
  | "settings";  // 6. 설정 & 미리보기

export const EDITOR_STEPS: { key: EditorStep; label: string }[] = [
  { key: "template", label: "템플릿" },
  { key: "info", label: "신랑신부" },
  { key: "wedding", label: "예식정보" },
  { key: "gallery", label: "갤러리" },
  { key: "account", label: "축의금" },
  { key: "settings", label: "설정" },
];

// ============================================================
// 통계 요약
// ============================================================
export interface InvitationStats {
  totalViews: number;
  totalRsvp: number;
  attendingCount: number;
  notAttendingCount: number;
  totalGuests: number;
  guestbookCount: number;
  dailyViews: { date: string; count: number }[];
}
