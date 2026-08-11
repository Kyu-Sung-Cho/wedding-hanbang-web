import { CATEGORY_CHECKLISTS } from "@/constants/checklists";

/**
 * 결혼식 날짜 하나로 "지금 알아볼 준비 3가지"를 고른다.
 *
 * 이 계산은 `/start-here` 화면 안에만 있었다. 그래서 랜딩은 같은 것을 **말로만**
 * 약속하고("날짜를 넣으면 준비 3가지가 나와요") 결과는 다른 페이지에 가야 볼 수
 * 있었다. 계산 자체는 상수와 D-day만 쓰는 순수 함수라 서버도 DB도 인증도 필요
 * 없다 — 랜딩에서 그 자리에 보여주지 못할 이유가 없었다.
 *
 * 두 화면이 같은 함수를 쓰게 해서, 한쪽만 규칙이 바뀌어 서로 다른 3가지를
 * 보여주는 드리프트를 막는다.
 *
 * **날짜는 이 함수 밖으로 나가지 않는다.** 인자로 받은 D-day만 쓰고 네트워크를
 * 타지 않으므로, 호출부가 브라우저에서 실행하는 한 날짜는 서버로 전송되지 않는다
 * (`scripts/landing-date-handoff-qa.mjs`가 그 계약을 실제 Chrome에서 검증한다).
 */

export interface PreparationPriority {
  key: string;
  label: string;
  tip: string;
  /** 이 항목에서 가장 먼저 할 일 최대 3개. */
  firstSteps: string[];
  daysUntilDeadline: number;
  daysUntilStart: number;
  /** 기본 확인 시작점을 이미 지났는지. 아직이면 화면에서 구분해 표시한다. */
  started: boolean;
}

export interface PreparationPriorityResult {
  /** 이미 확인 시작점을 지난 항목만. 없을 수 있다. */
  activeNow: PreparationPriority[];
  /** 화면에 보여줄 3개. 시작한 항목을 앞에 두고 모자라면 다가오는 항목으로 채운다. */
  visiblePriorities: PreparationPriority[];
}

const EMPTY: PreparationPriorityResult = { activeNow: [], visiblePriorities: [] };

/**
 * 시작점을 지난 항목의 순서 — **마감에 가장 가까운 것부터**.
 *
 * `daysUntilDeadline` 단순 오름차순으로 두면 안 된다. 이 값은 `dday - ddayDeadline`이고
 * `dday`는 모든 후보에 **같은 값**이라 비교에서 상쇄된다 — 정렬이 `ddayDeadline`
 * 내림차순 상수가 되어, 어떤 날짜를 넣어도 화면에 같은 3개가 나왔다. 결혼식 사흘 전
 * 커플에게도 "양쪽 부모님 첫 만남 날짜 조율"이 1순위로 나갔다.
 * (그 상수성을 브라우저로 확인하고 정상으로 오해한 기록이 랜딩 히어로 주석에 남아 있었다.
 * 날짜를 여러 개 넣어봐도 결과가 같으면 그건 검증이 아니라 증상이다.)
 *
 * 그렇다고 "아직 안 지난 것"을 무조건 앞세워도 안 된다. 그러면 마감이 이제 막 7일 지난
 * 상견례가, 여유가 143일이나 남은 항목 뒤로 밀린다. 놓친 지 얼마 안 된 일이야말로 지금
 * 손대야 하는 일이다.
 *
 * 그래서 **마감까지의 거리(절댓값)** 로 정렬한다. 곧 닥칠 일과 막 지난 일이 함께 앞에 오고,
 * 한참 전에 지나간 일과 아직 한참 남은 일이 함께 뒤로 간다. 거리가 같으면 아직 지나지
 * 않은 쪽을 앞에 둔다 — 되돌릴 수 있는 쪽이 먼저다.
 */
function compareStartedByUrgency(
  left: { daysUntilDeadline: number },
  right: { daysUntilDeadline: number },
): number {
  const byDistance = Math.abs(left.daysUntilDeadline) - Math.abs(right.daysUntilDeadline);
  if (byDistance !== 0) return byDistance;
  const leftPassed = left.daysUntilDeadline < 0 ? 1 : 0;
  const rightPassed = right.daysUntilDeadline < 0 ? 1 : 0;
  return leftPassed - rightPassed;
}

/**
 * @param dday 결혼식까지 남은 일수. `daysUntilWedding()`의 반환값을 그대로 넣는다.
 *             `null`(날짜 없음)이거나 음수(이미 지난 날짜)면 빈 결과를 준다 —
 *             지난 날짜에 "지금 알아볼 것"을 말하면 틀린 안내가 된다.
 * @param skipped 사용자가 "우린 안 해요"로 뺀 항목. 랜딩에는 이 선택이 없다.
 */
export function computePreparationPriorities(
  dday: number | null,
  { skipped }: { skipped?: ReadonlySet<string> } = {},
): PreparationPriorityResult {
  if (dday === null || dday < 0) return EMPTY;

  const candidates = CATEGORY_CHECKLISTS
    .filter((category) => !skipped?.has(category.key))
    .map((category) => ({
      key: category.key,
      label: category.label,
      tip: category.tip,
      firstSteps: category.items.slice(0, 3).map((item) => item.label),
      daysUntilDeadline: dday - category.ddayDeadline,
      daysUntilStart: dday - category.ddayStart,
      started: dday <= category.ddayStart,
    }));

  const active = candidates
    .filter((category) => category.started)
    .sort(compareStartedByUrgency)
    .slice(0, 3);

  const upcoming = candidates
    .filter((category) => !category.started)
    .sort((left, right) => (
      left.daysUntilStart - right.daysUntilStart
      || left.daysUntilDeadline - right.daysUntilDeadline
    ));

  return {
    activeNow: active,
    visiblePriorities: [...active, ...upcoming].slice(0, 3),
  };
}
