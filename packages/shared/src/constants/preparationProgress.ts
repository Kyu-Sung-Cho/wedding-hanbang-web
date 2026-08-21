/**
 * 준비 현황 19항목 — 어떤 항목을 묻고, 어떤 상태를 고를 수 있는가.
 *
 * ## 왜 여기로 올렸나
 *
 * 이 목록은 웹의 `apps/web/src/types/onboarding.types.ts`에만 있었다. 서버 검증도
 * 거기서 키 집합을 만들어 쓴다. 그런데 앱에도 같은 화면이 생기면서, 앱은 자기 나름의
 * 방법으로 키 목록을 조립했다 — 카테고리 템플릿에서 뽑아 라벨 사전으로 거른 것이다.
 *
 * 지금은 우연히 19개로 맞는다. 하지만 카테고리가 하나 추가되는 순간 앱은 서버가
 * 모르는 키를 보내고, 서버의 `parseOnboardingProgress`는 **그 항목만 버리는 게 아니라
 * 요청 전체를 400으로 거절한다**. 카테고리 하나 늘렸다가 앱 온보딩이 통째로 막히는
 * 구조였다.
 *
 * 초대 코드 길이가 웹 15 / 앱 10으로 갈라져 파트너 연결이 깨졌던 것과 같은 모양이다
 * (contracts/coupleInviteCode.ts 참고). 그래서 규칙을 한 벌만 둔다.
 *
 * ## 상태 어휘도 여기 둔다
 *
 * 웹은 3상태(예정·준비 중·완료), 앱은 4상태(아직·준비 중·완료·안 해요)였다. 한쪽이
 * "안 해요"로 표시한 항목을 다른 쪽에서는 고를 수도 되돌릴 수도 없다 — 같은 커플의
 * 두 사람이 같은 데이터를 다르게 보는 상태다. 서버는 네 상태를 모두 받으므로,
 * 화면이 좁게 잡을 이유가 없다.
 */

import { PLANNING_CATEGORY_LABELS } from "./weddingPlanning";
import type { PlanningCategoryKey } from "./weddingPlanning";

/**
 * 온보딩 준비 현황에서 묻는 카테고리. 서버가 `couples.progress`에 허용하는 키 집합의
 * 정본이고, 화면은 이보다 넓어서도 좁아서도 안 된다.
 *
 * `reserve`(예비비)는 여기 없다 — 준비 항목이 아니라 예산의 남은 자리라서 "아직/준비
 * 중/완료"로 물을 대상이 아니다.
 */
export const PREPARATION_PROGRESS_CATEGORY_KEYS = [
  // `greeting`과 맨 아래 `registration`은 main의 #135("체크리스트가 빠뜨린 절차를
  // 채운다")가 추가한 것이다. 병합할 때 이 목록에 옮기지 않으면 **온보딩 화면에서만
  // 두 항목이 조용히 사라진다** — 서버는 21개를 알고 화면은 19개를 그리는 상태가 된다.
  // 이 파일이 정본인 이유가 정확히 그것이라, 카테고리가 늘면 여기부터 고친다.
  "greeting",
  "meeting",
  "venue",
  "studio",
  "dress",
  "makeup",
  "ring",
  "hanbok",
  "yedan",
  "honeymoon",
  "houseware",
  "housing",
  "invitation",
  "snap",
  "shoes",
  "bouquet",
  "gift",
  "mc",
  "ham",
  "pyebaek",
  "registration",
] as const satisfies readonly PlanningCategoryKey[];

export type PreparationProgressCategoryKey =
  (typeof PREPARATION_PROGRESS_CATEGORY_KEYS)[number];

export const PREPARATION_PROGRESS_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
  "not_applicable",
] as const;

export type PreparationProgressStatus =
  (typeof PREPARATION_PROGRESS_STATUSES)[number];

export interface PreparationProgressStatusOption {
  value: PreparationProgressStatus;
  label: string;
}

/**
 * 상태를 화면에 보여줄 때 쓰는 이름. 고르는 자리(선택 버튼)와 보여주는 자리(칩·요약)가
 * 같은 말을 써야 한다 — 온보딩에서 "안 해요"를 고른 항목이 라운지에서 "해당 없음"으로
 * 보이면, 사용자는 자기가 고른 것과 다른 것을 본다.
 *
 * 라운지·대시보드·챗 카드는 원래 각자 사전을 갖고 있었고(예정/진행 중/완료/해당 없음),
 * 챗 카드에는 not_applicable 자리가 아예 없어서 원시 키가 그대로 노출될 수 있었다.
 * Record로 두는 이유가 그것이다 — 상태가 하나 늘면 여기서 컴파일이 깨진다.
 *
 * "아직"은 "예정"과 다르다. 예정이라고 적으면 아직 아무것도 안 정한 사람에게 "하기로
 * 했다"는 계획을 붙이는 셈이다. 안 하기로 한 것은 "안 해요"에 따로 자리가 있다.
 */
export const PREPARATION_PROGRESS_STATUS_LABELS: Record<
  PreparationProgressStatus,
  string
> = {
  not_started: "아직",
  in_progress: "준비 중",
  completed: "완료",
  not_applicable: "안 해요",
};

/**
 * 고르는 버튼이 쓰는 목록. 라벨 사전에서 파생시켜, 고르는 말과 보여주는 말이
 * 갈라질 수 없게 한다.
 */
export const PREPARATION_PROGRESS_STATUS_OPTIONS: readonly PreparationProgressStatusOption[] =
  PREPARATION_PROGRESS_STATUSES.map((value) => ({
    value,
    label: PREPARATION_PROGRESS_STATUS_LABELS[value],
  }));

const CATEGORY_KEY_SET: ReadonlySet<string> = new Set(
  PREPARATION_PROGRESS_CATEGORY_KEYS,
);

export function isPreparationProgressCategoryKey(
  value: unknown,
): value is PreparationProgressCategoryKey {
  return typeof value === "string" && CATEGORY_KEY_SET.has(value);
}

const STATUS_SET: ReadonlySet<string> = new Set(PREPARATION_PROGRESS_STATUSES);

export function isPreparationProgressStatus(
  value: unknown,
): value is PreparationProgressStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

export interface PreparationProgressItem {
  key: PreparationProgressCategoryKey;
  label: string;
  status: PreparationProgressStatus;
  cost?: number;
}

/**
 * 화면이 처음 그릴 목록. 순서는 위 배열이 정본이고, 라벨은 `PLANNING_CATEGORY_LABELS`에서
 * 온다 — 라벨을 화면마다 다시 적으면 한쪽만 고쳐진다.
 */
export function createPreparationProgressItems(): PreparationProgressItem[] {
  return PREPARATION_PROGRESS_CATEGORY_KEYS.map((key) => ({
    key,
    label: PLANNING_CATEGORY_LABELS[key],
    status: "not_started" as PreparationProgressStatus,
  }));
}
