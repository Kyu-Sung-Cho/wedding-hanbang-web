import { daysUntilWedding } from "@/lib/utils/weddingDate";

export const START_HERE_DATE_HANDOFF_KEY = "hanbang:start-here-date:v1";

/**
 * 히어로에서 넘어온 예식일을 **한 번만** 읽고 지운다.
 *
 * 왜 필요했나: 넘기는 쪽만 있고 받는 쪽이 없어서, 히어로에서 날짜를 넣고
 * 넘어온 사람이 도착 화면에서 같은 날짜를 다시 입력해야 했다. 랜딩이 그 자리에서
 * 결과까지 보여준 뒤라 더 이상하게 느껴진다.
 *
 * 두 경로를 모두 받는다 — 히어로는 sessionStorage를 쓰고, 저장소가 막힌
 * 브라우저에서만 `#date=` fragment로 넘긴다. fragment는 HTTP 요청에 실리지
 * 않으므로 어느 경로로도 날짜가 서버로 가지 않는다.
 *
 * 읽는 즉시 소비한다(저장소 삭제 + 주소창 fragment 제거). 남겨 두면 새로고침이나
 * 링크 공유 때 예전 날짜가 되살아나 사용자가 넣지도 않은 날짜로 계산된다.
 */
export function readStartHereDateHandoff(): string | null {
  if (typeof window === "undefined") return null;

  // **주소가 저장값을 이긴다.** 반대로 두면 `#date=`로 방금 지정하고 들어온 사람이
  // 오래된 저장값을 받는다 — 세션이 남아 있는 브라우저에서 링크로 다시 들어올 때
  // 실제로 그렇게 된다. 저장소는 fragment를 못 쓰는 환경의 경로다.
  let fragmentValue: string | null = null;
  const match = /[#&]date=([^&]+)/u.exec(window.location.hash);
  if (match) {
    try {
      fragmentValue = decodeURIComponent(match[1]);
    } catch {
      fragmentValue = null;
    }
  }

  let storedValue: string | null = null;
  try {
    storedValue = window.sessionStorage.getItem(START_HERE_DATE_HANDOFF_KEY);
  } catch {
    // 저장소가 막힌 환경이면 fragment 경로만 쓴다.
  }

  clearStartHereDateHandoff();
  if (window.location.hash.includes("date=")) {
    // 주소만 갈아끼운다 — 히스토리를 늘리면 뒤로가기가 같은 화면에 갇힌다.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }

  // 지난 날짜를 거르는 것은 **저장값에만** 적용한다. 세션이 오래 열려 있으면 어제
  // 넘긴 날짜가 오늘은 과거일 수 있어서다. 주소로 방금 지정한 날짜는 지났더라도
  // 그대로 넘긴다 — 도착 화면이 "이미 지난 날짜예요"라고 정정 상태를 보여주는 쪽이,
  // 사용자가 넣은 값을 말없이 버리는 것보다 낫다.
  if (fragmentValue) return fragmentValue;
  if (!storedValue) return null;
  const dday = daysUntilWedding(storedValue);
  return dday !== null && dday >= 0 ? storedValue : null;
}

export function clearStartHereDateHandoff(): void {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(START_HERE_DATE_HANDOFF_KEY);
  } catch {
    // 저장소 접근이 막힌 환경에서도 날짜 없는 시작 흐름은 계속 진행한다.
  }
}
