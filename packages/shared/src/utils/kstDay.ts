/**
 * 한국 날짜 하나를 구하는 자리.
 *
 * ## 왜 필요했나
 *
 * `new Date().toISOString().slice(0, 10)` 은 **어디서 돌든 UTC 날짜**를 준다. 서버(Vercel)
 * 든 사용자의 브라우저·폰이든 마찬가지다. 한국은 UTC+9 이므로 **한국 시각 00:00~09:00
 * 동안 이 값은 어제**가 된다. 하루 24시간 중 9시간이다.
 *
 * 이 저장소는 그 사고를 이미 한 번 겪었다. `apps/web/src/lib/utils/kstDate.ts` 머리말이
 * 기록해 두었고, 규칙도 세워 뒀다 — "모든 사용자-노출 날짜 계산은 이 헬퍼를 통과시킨다".
 * 그런데 그 헬퍼는 웹 전용이라 모바일과 공유 코드가 쓸 수 없었고, `KST_OFFSET_MS` 가
 * 저장소에 여러 벌로 흩어져 있었다.
 *
 * ## 고정 오프셋을 쓰는 이유
 *
 * 한국은 서머타임이 없다. UTC+09:00 이 언제나 정확하므로 `Intl` 없이 더해도 틀릴 구석이
 * 없다. `coupleConnection.ts` 가 같은 이유로 같은 방식을 쓴다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * 한국 기준 오늘 날짜를 `YYYY-MM-DD` 로 준다.
 *
 * @param now 밀리초 타임스탬프. 넣지 않으면 현재 시각.
 */
export function todayYmdInKst(now: number = Date.now()): string {
  // +9시간을 더한 뒤 **UTC 필드로 읽으면** 그것이 곧 한국의 달력 날짜다.
  // 로컬 필드(getFullYear 등)로 읽으면 실행 환경의 시간대가 한 번 더 섞인다.
  const shifted = new Date(now + KST_OFFSET_MS);
  return `${shifted.getUTCFullYear()}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

/**
 * 한국 기준 오늘부터 `count` 일치의 날짜를 `YYYY-MM-DD` 로 준다.
 *
 * 하루씩 더할 때 `setDate` 로 로컬 달력을 밟지 않는다 — 실행 환경의 시간대가 섞이고,
 * 서머타임이 있는 지역에서는 하루가 23시간이나 25시간이 되기도 한다. 여기서는 이미
 * 한국 자정으로 맞춘 값에 24시간씩 더한다(한국은 서머타임이 없어 항상 24시간이다).
 */
export function upcomingYmdInKst(count: number, now: number = Date.now()): string[] {
  if (!Number.isInteger(count) || count <= 0) return [];
  const days: string[] = [];
  for (let index = 0; index < count; index += 1) {
    days.push(todayYmdInKst(now + index * 24 * 60 * 60 * 1000));
  }
  return days;
}
