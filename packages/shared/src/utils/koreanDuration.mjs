/**
 * 남은 기간을 사람이 읽는 말로.
 *
 * ## 왜 한 곳에 모으는가
 *
 * 이 저장소는 남은 기간을 **날짜 수**로 계산한다(`dday - ddayDeadline`,
 * `remainingDays`, `daysUntilDeadline`). 그런데 화면 여러 곳이 그 숫자를 받아
 * 각자 자기 자리에서 `${n}일` 을 만들어 붙였다. 그래서 두 가지가 생겼다.
 *
 * **하나.** 숫자에 상한이 없다. 예식이 1년 반 남은 커플의 라운지는
 * 「기본 확인 시점까지 255일」 처럼 사람이 감을 못 잡는 숫자를 보여준다.
 * 「약 8개월」 이 같은 사실을 더 정확히 전한다.
 *
 * **둘.** 단위가 값과 따로 논다. 단위를 부르는 쪽이 손으로 적으므로, 날짜 수를
 * 그대로 두고 단위만 「월」 로 바꾸면 「255월」 같은 글자가 화면에 나간다.
 * 숫자와 단위가 같은 계산에서 나오면 그런 조합 자체가 만들어지지 않는다.
 *
 * 그래서 **단위는 값에서 나온다.** 부르는 쪽은 단위를 고르지 않는다.
 *
 * ## 왜 `.mjs` 인가
 *
 * 이 규칙은 웹(TS)과 앱이 같이 써야 하는데, 앱의 라운지 데이터 조립부는
 * `node --test` 로 도는 `.mjs` 다(`apps/mobile/src/lib/dashboardExperience.mjs`).
 * 구현을 둘로 나누면 두 화면의 단위가 언젠가 갈라진다. 저장소에 이미 있는
 * `contracts/*.mjs` + `*.d.mts` 방식을 그대로 따라 하나만 둔다.
 *
 * ## 경계를 왜 60일과 365일로 두는가
 *
 * 60일 미만은 사람이 날짜로 센다 — "3주 뒤"보다 "19일"이 실제로 더 쓸모 있다.
 * 그 위로는 날짜 수가 감을 주지 못하므로 개월로 바꾸고, 1년을 넘으면 연도를
 * 앞에 세운다. 개월·연 표기에는 「약」 을 붙인다 — 30일을 한 달로 셈한 값이라
 * 정확한 날짜가 아니고, 화면이 그 사실을 숨기지 않는다.
 */

/** 이 밑으로는 날짜 수를 그대로 보여준다. */
const DAYS_SHOWN_AS_DAYS = 60;

/** 개월 환산에 쓰는 한 달. 정확한 달 길이가 아니라서 「약」 을 붙인다. */
const DAYS_PER_MONTH = 30;

const DAYS_PER_YEAR = 365;

function normalizeDays(days) {
  if (typeof days !== "number" || !Number.isFinite(days)) return null;
  return Math.trunc(days);
}

/**
 * 기간의 크기만 말한다(「후」·「전」 은 붙이지 않는다).
 *
 *   19  → `19일`
 *   255 → `약 9개월`
 *   430 → `약 1년 2개월`
 *
 * 음수를 넣어도 크기만 본다. 방향은 부르는 쪽 문장이 정한다
 * (「기본 확인 시점에서 ~ 지남」 처럼).
 */
export function formatKoreanDayCount(days) {
  const value = normalizeDays(days);
  if (value === null) return "";

  const magnitude = Math.abs(value);
  if (magnitude < DAYS_SHOWN_AS_DAYS) return `${magnitude}일`;

  if (magnitude < DAYS_PER_YEAR) {
    const months = Math.round(magnitude / DAYS_PER_MONTH);
    // 12개월로 반올림되는 구간(약 345일부터)은 「약 1년」 이라고 말한다.
    // 「약 12개월」 과 바로 다음 값 「약 1년」 이 나란히 나오면 읽는 사람이
    // 둘을 다른 크기로 읽는다.
    return months >= 12 ? "약 1년" : `약 ${months}개월`;
  }

  const years = Math.floor(magnitude / DAYS_PER_YEAR);
  const months = Math.round((magnitude - years * DAYS_PER_YEAR) / DAYS_PER_MONTH);
  // 12개월로 반올림되면 그건 한 해다. 「약 1년 12개월」 을 내보내지 않는다.
  if (months >= 12) return `약 ${years + 1}년`;
  return months > 0 ? `약 ${years}년 ${months}개월` : `약 ${years}년`;
}

/**
 * 오늘을 기준으로 앞뒤를 함께 말한다.
 *
 *   -3  → `3일 전`
 *    0  → `오늘`
 *    1  → `내일`
 *    8  → `8일 후`
 *   255 → `약 9개월 후`
 */
export function formatKoreanRelativeDays(days) {
  const value = normalizeDays(days);
  if (value === null) return "";
  if (value === 0) return "오늘";
  if (value === 1) return "내일";
  if (value === -1) return "어제";
  return `${formatKoreanDayCount(value)} ${value > 0 ? "후" : "전"}`;
}
