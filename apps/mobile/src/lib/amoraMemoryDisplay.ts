/**
 * 「아모라 기억」 설정 화면이 사람에게 하는 말.
 *
 * 웹 설정 화면(`apps/web/src/app/(app)/settings/amora-memory/page.tsx`)과 **같은 문장**이다.
 * 같은 기억을 두 화면이 다르게 부르면 사용자는 무엇이 저장됐는지 모른다. 2026-07-16 웹이
 * "확정한 선택"을 "대화에서 말한 선택"으로, "직접 확인"을 "한 사람이 직접 고침 · 공동 확인
 * 아님"으로 고친 뒤 앱이 두 달 넘게 옛 말을 하고 있었다.
 *
 * 문장을 새로 짓지 않는다. 웹과 글자까지 같은지는 `amoraMemoryWebParity.test.mjs` 가
 * 웹 소스와 맞대어 본다 — 웹이 다시 바뀌면 그 테스트가 먼저 알려준다.
 */

export type AmoraMemoryVisibility = "shared" | "bride_private" | "groom_private";

/**
 * 기억 종류 라벨.
 *
 * `decision` 은 아모라가 **대화에서 들은** 선택이다. 두 사람이 확정한 결정이 아니므로
 * "확정한 선택"이라고 부르지 않는다.
 */
export const AMORA_MEMORY_KIND_LABELS: Readonly<Record<string, string>> = {
  decision: "대화에서 말한 선택",
  preference: "선호",
  constraint: "꼭 지킬 조건",
  relationship: "가족·커플 맥락",
  fact: "준비 정보",
  legacy: "이전 대화 기억",
};

export function memoryKindLabel(kind: string): string {
  return Object.prototype.hasOwnProperty.call(AMORA_MEMORY_KIND_LABELS, kind)
    ? AMORA_MEMORY_KIND_LABELS[kind]
    : "대화 기억";
}

/**
 * 무엇을 기억하지 않는지, 무엇을 입력하면 안 되는지. 웹 안내와 같은 문장이다.
 * 서버는 이런 내용을 결정적 필터로 막는다 — 여기서는 그 사실을 먼저 알릴 뿐이다.
 */
export const AMORA_MEMORY_SENSITIVE_NOTICE =
  "건강·임신·난임·성생활처럼 민감한 내용은 장기 기억에 저장하지 않아요. 주민번호·계좌번호·정확한 주소·계약·예약번호는 입력하지 마세요.";

/**
 * 사람이 고친 기억에 붙이는 표시.
 *
 * 공유 기억을 한 사람이 고치면 DB 는 `user_confirmed_at` 을 비우고
 * `correction_confirmation = 'single_member'` 로 남긴다. 그래서 `userConfirmedAt` 이 아니라
 * `userCorrected` 를 보고, 공유 범위에서는 **공동 확인이 아니라고** 분명히 적는다.
 */
export function memoryCorrectionLabel(
  memory: { userCorrected?: unknown },
  visibility: AmoraMemoryVisibility,
): string | null {
  if (memory.userCorrected !== true) return null;
  return visibility === "shared" ? "한 사람이 직접 고침 · 공동 확인 아님" : "내가 직접 고침";
}

/** 스위치가 가리키는 것 — 공유 범위에서는 **내 동의**다(두 사람이 각각 켠다). */
export function memoryConsentHeading(visibility: AmoraMemoryVisibility): string {
  return visibility === "shared" ? "내 공유 기억 동의" : "나만 상담 기억";
}

type ConsentState = {
  enabled?: boolean;
  consentedByMe?: boolean;
  consentedCount?: number | string;
  requiredCount?: number | string;
};

/** 스위치 아래 상태 문장. 내 동의(스위치)와 실제로 켜졌는지(두 사람 모두 동의)를 가른다. */
export function memoryConsentStatus(
  visibility: AmoraMemoryVisibility,
  setting: ConsentState | null | undefined,
): string {
  if (visibility === "shared") {
    if (setting?.enabled) return "공유 기억 상태 · 켜짐. 두 분이 각각 동의했고 함께 보고 활용해요.";
    if (setting?.consentedByMe) {
      return `공유 기억 상태 · 동의 대기 (${setting.consentedCount}/${setting.requiredCount}). 파트너 구성 변경 시 두 분의 동의를 새로 받아요.`;
    }
    return "공유 기억 상태 · 꺼짐. 파트너 연결 후 두 분이 각각 동의해야 시작돼요.";
  }
  return `나만 상담 기억 상태 · ${setting?.enabled ? "켜짐" : "꺼짐"}. 파트너에게 보이지 않아요.`;
}

export const AMORA_MEMORY_PROFILE_HEADING = "상담할 때 참고하는 맥락";

/** 웹이 화면에 올리는 칸과 그 순서. `conflict_pattern`·`open_questions` 는 올리지 않는다. */
export const AMORA_MEMORY_PROFILE_FIELDS = [
  "persona_summary",
  "budget_posture",
  "decision_style",
  "taste_profile",
  "communication_style",
] as const;

export type AmoraMemoryProfile = {
  visibility: AmoraMemoryVisibility;
  persona_summary?: string | null;
  budget_posture?: string | null;
  decision_style?: string | null;
  taste_profile?: string | null;
  communication_style?: string | null;
  recommendation_rules?: unknown;
};

/**
 * 지금 범위의 「상담할 때 참고하는 맥락」 줄. 서버는 켜진 범위의 맥락만 내려준다.
 * 옛 서버처럼 `profiles` 가 없으면 빈 목록이다 — 없는 맥락을 지어내지 않는다.
 */
export function memoryProfileLines(
  profiles: unknown,
  visibility: AmoraMemoryVisibility,
): string[] {
  if (!Array.isArray(profiles)) return [];
  const profile = (profiles as AmoraMemoryProfile[]).find(
    (item) => item !== null && typeof item === "object" && item.visibility === visibility,
  );
  if (!profile) return [];
  const rules = Array.isArray(profile.recommendation_rules) ? profile.recommendation_rules : [];
  return [...AMORA_MEMORY_PROFILE_FIELDS.map((field) => profile[field]), ...rules]
    .filter((line): line is string => typeof line === "string" && line.trim().length > 0)
    .slice(0, 6);
}
