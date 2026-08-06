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
    .sort((left, right) => left.daysUntilDeadline - right.daysUntilDeadline)
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
