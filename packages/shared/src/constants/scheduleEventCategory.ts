import { PLANNING_CATEGORY_LABELS, type PlanningCategoryKey } from "./weddingPlanning";

/**
 * 일정(`progress.__events[].categoryKey`)의 분야 값.
 *
 * ## 저장하는 것은 키, 보여주는 것은 이름
 *
 * 웹 일정 입력(`apps/web/src/components/app/schedule/EventFormModal.tsx`)은 처음부터 키
 * (`venue`, `general` …)를 저장했다. 앱 일정 입력은 2026-09-18까지 **한국어 이름을 그대로**
 * (`"결혼식장"`, `"기타"`) 저장했다. 같은 칸에 두 모양이 섞여서, 앱에서 넣은 일정은 웹의
 * 분야 묶음에 끼지 못했고 웹에서 넣은 일정은 앱 목록에 `venue` 가 그대로 보였다.
 *
 * 이제 두 앱 모두 이 파일의 키를 저장한다. 이미 이름으로 저장된 값은 **읽을 때만** 키로
 * 바꾼다(`scheduleEventCategoryKeyFromStored`). 운영 DB를 고쳐 쓰지 않는다 — 2026-09-18
 * 파운더 결정. 사용자가 그 일정을 직접 고쳐 저장할 때 자연스럽게 키로 바뀐다.
 *
 * 이름표는 웹 일정 화면이 쓰던 것과 같다(`ScheduleContent.tsx` 외 세 곳의 `CATEGORY_LABELS`).
 */
export const SCHEDULE_EVENT_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  ...PLANNING_CATEGORY_LABELS,
  general: "일반",
  etiquette: "결혼 예절 참고",
};

export interface ScheduleEventCategoryOption {
  key: string;
  label: string;
}

/**
 * 일정 입력에서 고를 수 있는 분야. 웹 일정 입력과 같은 키·순서·이름이다.
 * 예비비(`reserve`)는 예산 전용이라 일정 분야가 아니다(웹과 같은 규칙).
 */
export const SCHEDULE_EVENT_CATEGORY_OPTIONS: readonly ScheduleEventCategoryOption[] = [
  { key: "general", label: "일반 (모임, 상담 등)" },
  ...(Object.keys(PLANNING_CATEGORY_LABELS) as PlanningCategoryKey[])
    .filter((key) => key !== "reserve")
    .map((key) => ({ key, label: PLANNING_CATEGORY_LABELS[key] })),
];

/**
 * 앱이 예전에 저장한 한국어 이름 → 키.
 *
 * 두 갈래가 있다. git 기록에서 모았다.
 *   - 2026-04-10 이전 앱 일정 입력의 고정 선택지(`예식장`, `예복`, `기타` …).
 *   - 그 뒤 앱이 선택지로 쓴 체크리스트 분야 이름의 옛 판(`상견례`, `드레스/턱시도` …).
 *     지금 이름은 아래 `LABEL_TO_KEY` 가 이름표에서 바로 만든다.
 *
 * **`스드메`는 넣지 않는다.** 사진·드레스·메이크업 세 분야라 하나로 바꾸면 사용자가 고르지
 * 않은 분야가 된다. 모르는 값은 지어내지 않고 그대로 둔다.
 */
const LEGACY_LABEL_TO_KEY: Readonly<Record<string, string>> = {
  기타: "general",
  예식장: "venue",
  스튜디오: "studio",
  드레스: "dress",
  예복: "dress",
  "드레스/턱시도": "dress",
  메이크업: "makeup",
  예물: "ring",
  "예물(반지)": "ring",
  예단: "yedan",
  혼수: "houseware",
  "혼수(가전/가구)": "houseware",
  허니문: "honeymoon",
  청첩장: "invitation",
  상견례: "meeting",
  스냅: "snap",
  영상: "snap",
  "본식 스냅/영상": "snap",
  "웨딩 구두": "shoes",
  부케: "bouquet",
  "부케/꽃장식": "bouquet",
  답례품: "gift",
  축가: "mc",
  사회자: "mc",
  "사회/축가": "mc",
  함: "ham",
  폐백: "pyebaek",
};

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const LABEL_TO_KEY: ReadonlyMap<string, string> = new Map<string, string>([
  ...Object.entries(LEGACY_LABEL_TO_KEY),
  ...SCHEDULE_EVENT_CATEGORY_OPTIONS.map((option) => [option.label, option.key] as [string, string]),
  ...Object.entries(SCHEDULE_EVENT_CATEGORY_LABELS).map(([key, label]) => [label, key] as [string, string]),
]);

/**
 * 저장된 분야 값을 키로 읽는다. 저장값을 바꾸지 않는다 — 읽는 쪽에서만 쓴다.
 *
 * - 이미 키면 그대로.
 * - 앱이 저장했던 한국어 이름이면 그 키.
 * - 그 밖의 값은 **그대로 돌려준다**(사용자 기록을 버리지 않는다).
 * - 문자열이 아니거나 비었으면 `undefined`.
 */
export function scheduleEventCategoryKeyFromStored(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (hasOwn(SCHEDULE_EVENT_CATEGORY_LABELS, trimmed)) return trimmed;
  return LABEL_TO_KEY.get(trimmed) ?? value;
}

/** 키처럼 생긴 값. 이런 값은 사람이 읽는 이름이 아니므로 화면에 그대로 내지 않는다. */
const KEY_SHAPED = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/**
 * 화면에 그릴 분야 이름. 그릴 것이 없으면 `null`.
 *
 * 모르는 키 모양 값(`housewarming` 같은 예전 분야 키)은 그리지 않는다 — `venue` 가 목록에
 * 새던 것과 같은 모양이다. 사람이 적은 이름(`스드메`)은 그대로 그린다.
 */
export function scheduleEventCategoryLabel(value: unknown): string | null {
  const key = scheduleEventCategoryKeyFromStored(value);
  if (key === undefined) return null;
  if (hasOwn(SCHEDULE_EVENT_CATEGORY_LABELS, key)) return SCHEDULE_EVENT_CATEGORY_LABELS[key];
  const shown = key.trim();
  return KEY_SHAPED.test(shown) ? null : shown;
}
