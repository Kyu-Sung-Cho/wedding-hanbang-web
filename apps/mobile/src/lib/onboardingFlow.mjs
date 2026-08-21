/**
 * 온보딩에서 **누가 어느 화면을 걷는가**, 그리고 **제출한 뒤 무엇이 저장되지
 * 않았는가**를 정한다.
 *
 * ## 합류하는 사람에게는 준비 현황을 묻지 않는다
 *
 * `couples.progress`는 커플이 함께 쓰는 한 벌이다. 나중에 초대 코드로 합류한
 * 사람에게 준비 단계와 19항목을 다시 물으면, 먼저 시작한 파트너가 적어둔 내용을
 * 이쪽 화면의 초깃값이 덮어쓴다. 두 사람이 같은 자리를 각자 채우는 구조라서
 * "나중에 고치면 된다"로 넘길 수 없다 — 덮어쓴 순간 먼저 적은 쪽 기록은 사라진다.
 *
 * 그래서 합류 경로는 그 화면을 아예 지나가지 않고, 제출 payload에도 단계와 19항목을
 * 한 줄도 넣지 않는다. 웹과 같은 결정이다.
 *
 * ## 걷는 화면 수와 진행 표시가 같아야 한다
 *
 * 화면을 건너뛰게 하면서 "6단계 중 4단계"라고 적으면, 사람은 남은 두 화면을 기다리다
 * 갑자기 끝난 앱을 본다. 그래서 진행 표시의 분모도 **그 사람이 실제로 보는 화면 수**로
 * 계산한다. 뒤로 가기도 같은 목록을 거꾸로 밟는다.
 *
 * 화면 코드가 아니라 여기에 둔 이유는, 이 계산이 렌더링 없이 테스트되어야 하기
 * 때문이다.
 */

import { buildOnboardingProgress } from "./onboardingFirstValue.mjs";

/** 완료 화면의 스텝 번호. 입력 화면(1~5) 다음 자리다. */
export const ONBOARDING_DONE_STEP = 6;

/** 준비 현황(단계 + 19항목) 화면의 스텝 번호. */
export const ONBOARDING_PREPARATION_STEP = 5;

// 1 역할 · 2 커플 연결 · 3 결혼 정보 · 4 웨딩 스타일 · 5 준비 현황 · 6 완료
const CREATE_STEPS = Object.freeze([1, 2, 3, 4, 5, 6]);
// 합류는 역할과 코드까지만 걷는다. 완료 화면도 없다 — 보여줄 초대 코드가 없어서 바로
// 웨딩 라운지로 들어간다. 그래서 이 사람이 보는 화면은 둘이고, 분모도 둘이다.
//
// 결혼 정보(3)와 웨딩 스타일(4)까지 건너뛰는 이유는 준비 현황과 같다. 예식일·장소·예산은
// `wedding_journeys`의 공유 값이고, 스타일·우선순위는 `couples.progress.__preferences`의
// 공유 값이다. 합류자가 여기에 다른 값을 넣으면 서버는 그것을 **양쪽 승인이 필요한
// 고영향 변경**(pending_partner, requiredCount 2)으로 만든다 — 합류하자마자 파트너에게
// 승인 요청이 날아가고, 본인은 저장되지 않은 화면을 본다. 첫 경험으로 최악이다.
//
// 합류자가 그 값들을 못 채우는 게 아니라, 채우는 자리가 온보딩이 아니라 웨딩 라운지라는
// 뜻이다. 웹도 같은 결정이다(스텝 2에서 바로 제출).
const JOIN_STEPS = Object.freeze([1, 2]);

/**
 * 이 사람에게 준비 현황을 물어도 되는가.
 *
 * 파트너가 이미 적어둔 커플 공유 데이터를 덮어쓰지 않기 위한 유일한 판단점이다.
 */
export function shouldAskPreparationProgress(coupleAction) {
  return coupleAction !== "join";
}

/** 이 사람이 실제로 보는 화면 번호들. 진행 표시와 앞뒤 이동이 모두 이 목록을 따른다. */
export function getOnboardingSteps(coupleAction) {
  return shouldAskPreparationProgress(coupleAction) ? CREATE_STEPS : JOIN_STEPS;
}

/**
 * 진행 표시에 쓸 `{ position, total }`.
 *
 * 목록에 없는 화면(합류가 도달할 수 없는 완료 화면 같은)은 마지막 칸으로 본다 —
 * 진행 표시가 0이나 음수로 튀는 것보다 낫다.
 */
export function getOnboardingStepPosition(step, coupleAction) {
  const steps = getOnboardingSteps(coupleAction);
  const index = steps.indexOf(step);
  return {
    position: index === -1 ? steps.length : index + 1,
    total: steps.length,
  };
}

/** 다음 화면 번호. 더 볼 화면이 없으면 null — 그 자리가 제출 지점이다. */
export function getNextOnboardingStep(step, coupleAction) {
  const steps = getOnboardingSteps(coupleAction);
  const index = steps.indexOf(step);
  if (index === -1 || index + 1 >= steps.length) return null;
  return steps[index + 1];
}

/** 이전 화면 번호. 건너뛴 화면은 목록에 없으므로 뒤로 가도 밟히지 않는다. */
export function getPreviousOnboardingStep(step, coupleAction) {
  const steps = getOnboardingSteps(coupleAction);
  const index = steps.indexOf(step);
  if (index <= 0) return null;
  return steps[index - 1];
}

/**
 * 서버로 보낼 `progress`를 만든다.
 *
 * 합류한 사람이면 단계도 19항목도 넣지 않는다. 화면에서 묻지 않았으니 보낼 것도
 * 없고, 혹시 앞선 화면에서 상태가 남아 있더라도 여기서 잘린다 — 사용자가 말하지
 * 않은 값이 커플 공유 데이터에 들어가는 경로를 한 곳에서 막는다.
 */
export function buildOnboardingProgressPayload({
  coupleAction,
  stage = null,
  preferences,
  categoryStatuses = null,
} = {}) {
  const asks = shouldAskPreparationProgress(coupleAction);
  return buildOnboardingProgress({
    stage: asks ? stage : null,
    preferences,
    categoryStatuses: asks ? categoryStatuses : null,
  });
}

/**
 * 계획 변경이 파트너 확인을 기다릴 때 덧붙이는 한 줄. 웹 온보딩과 같은 문구다.
 */
const PENDING_PLAN_TAIL =
  "아직 계획에는 반영되지 않았어요. 두 사람이 모두 확인하면 자동으로 반영됩니다.";

function readStatusText(value, status, field) {
  if (!value || typeof value !== "object") return "";
  if (value.status !== status) return "";
  return typeof value[field] === "string" ? value[field] : "";
}

/**
 * 제출 응답에서 "저장되지 않은 것"을 사람이 읽을 한 덩어리로 만든다. 알릴 게 없으면
 * null이고, 그때만 다음 화면으로 넘어간다.
 *
 * 서버는 200을 주면서도 입력을 미뤄둘 수 있다. 이미 연결된 커플의 준비 현황은 한쪽
 * 입력으로 덮을 수 없어 보류되고(`routineProgress.deferred`), 결혼 예정일처럼 둘 다
 * 걸린 값은 파트너 확인을 기다린다(`planChange.pending_partner`). 응답이 200이라는
 * 이유로 그냥 넘기면 사람은 저장된 줄 알고 화면을 떠난다 — 두 경우 모두 먼저 알린다.
 */
export function describeOnboardingSubmitNotice(data) {
  const record = data && typeof data === "object" ? data : {};
  const pendingSummary = readStatusText(
    record.planChange,
    "pending_partner",
    "summary",
  );
  const deferredMessage = readStatusText(
    record.routineProgress,
    "deferred",
    "message",
  );
  if (!pendingSummary && !deferredMessage) return null;

  const lines = [];
  if (pendingSummary) {
    lines.push(pendingSummary, PENDING_PLAN_TAIL);
  }
  if (deferredMessage) {
    lines.push(deferredMessage);
  }
  return {
    title: pendingSummary
      ? "파트너 확인을 요청했어요"
      : "저장되지 않은 입력이 있어요",
    message: lines.join("\n\n"),
  };
}
