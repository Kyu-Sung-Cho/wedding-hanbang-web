// 웨딩 라운지 첫 도착 화면을 언제 보이고 언제 거둘 것인가.
//
// ## 왜 "봤다" 플래그를 두지 않는가
//
// 첫 도착을 봤다는 사실을 따로 적어두면 그 기록과 실제 데이터는 언젠가 어긋난다.
// 기기를 바꾸거나 기록만 지워지면 준비가 한창인 커플이 "아직 아무것도 없어요" 화면을
// 다시 본다. 반대로 기록이 먼저 남고 저장이 실패하면 아무것도 없는 사람이 빈 위젯만
// 본다. 그래서 판정은 오직 **지금 그릴 데이터**로만 한다 — 데이터가 생기면 다음
// 렌더에서 저절로 사라지고, 되돌릴 스위치가 없으니 어긋날 자리도 없다.
//
// ## 무엇을 "만든 데이터"로 보는가
//
// `wedding_journeys.progress` 한 덩어리에 성격이 다른 것들이 섞여 있다.
//   - `__stage`, `__preferences` — 온보딩에서 **말한 것**. 첫 도착 화면이 되읽어 주는
//     대상이지, 준비를 시작했다는 증거가 아니다. 이걸 데이터로 세면 첫 도착 화면은
//     온보딩을 마친 순간 이미 조건을 잃어 한 번도 뜨지 못한다.
//   - `__events` — 두 사람이 넣은 일정.
//   - 그 밖의 키 — 19개 준비 카테고리. 체크리스트 체크와 예산(budget/spent)이 여기 산다.
//     여기에 함정이 하나 있다: 온보딩 마지막 화면은 고른 단계의 **제안값**으로 19항목을
//     미리 채우고, "저장하고 시작하기"를 누르면 그 값이 그대로 저장된다. 그것까지 만든
//     데이터로 세면 `just_started`가 아닌 단계를 고른 사람 — 5개 중 4개 — 은 첫 도착
//     화면을 한 번도 못 본다. 그래서 "제안값 그대로인가"는 공유 계약
//     (`isOnlyStageSuggestion`)이 판정하고, 이 파일은 그 판정에 넣을 값을 만들어 준다.
//     웹도 같은 계약을 쓴다.
//
// 상담 요청 기록(vendor_bookings)도 함께 본다. 라운지가 이미 들고 있는 값이라 질의를
// 늘리지 않고, 하나라도 있으면 라운지에 보여줄 실물이 있다는 뜻이다.
//
// 총예산(`wedding_journeys.total_budget`)은 일부러 보지 않는다. 온보딩에서 받은 값이라
// 여기 있는 다른 것들과 달리 "만든 것"이 아니고, 이걸 세면 예산을 적어 낸 모든 커플이
// 첫 도착 화면을 못 본다.
import { isActiveScheduleEvent } from "./scheduleMutation.mjs";

/** 카테고리가 아닌 예약 키의 접두사. 19개 카테고리 키와 겹치지 않게 정해져 있다. */
const RESERVED_PROGRESS_PREFIX = "__";

/** 일정이 사는 예약 키. 예약 키지만 이건 두 사람이 만든 것이다. */
const SCHEDULE_EVENTS_KEY = "__events";

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * 온보딩에서 고른 웨딩 스타일 값. 없으면 null.
 *
 * null이면 부르는 쪽은 그 줄을 아예 그리지 않는다 — 고르지 않은 사람에게 "분위기: -"를
 * 보여주는 건 입력을 빠뜨렸다는 뜻으로 읽힌다.
 */
export function readWeddingStyleValue(progress) {
  if (!isRecord(progress)) return null;
  const preferences = progress.__preferences;
  if (!isRecord(preferences)) return null;
  const style = preferences.weddingStyle;
  return typeof style === "string" && style.length > 0 ? style : null;
}

/**
 * 카테고리별로 남아 있는 상태만 뽑아 `{ venue: "completed", ... }` 모양으로 준다.
 *
 * 공유 계약 `isOnlyStageSuggestion`이 이 모양을 받는다. 앱은 상태를 `{ status }` 객체로
 * 저장하고 웹은 같은 자리에 다른 필드도 함께 두기 때문에, 비교 전에 상태 한 줄만 남긴다 —
 * 두 플랫폼이 같은 계약에 같은 모양을 넣어야 같은 답이 나온다.
 *
 * 예약 키(`__stage`/`__preferences`/`__events`)는 카테고리가 아니라 제외한다.
 *
 * @returns {Record<string, string>}
 */
export function readRecordedCategoryStatuses(progress) {
  /** @type {Record<string, string>} */
  const recorded = {};
  if (!isRecord(progress)) return recorded;
  for (const [key, value] of Object.entries(progress)) {
    if (key.startsWith(RESERVED_PROGRESS_PREFIX)) continue;
    const status = isRecord(value) ? value.status : null;
    if (typeof status === "string" && status !== "" && status !== "not_started") {
      recorded[key] = status;
    }
  }
  return recorded;
}

/**
 * 이 커플이 라운지에 보여줄 것을 하나라도 만들었는가.
 *
 * true면 첫 도착 화면은 물러나고 평소 라운지가 된다.
 *
 * `ignoredCategoryKeys`는 온보딩 제안값 그대로라 "만든 것"으로 세지 않을 카테고리 키다.
 * 부르는 쪽이 공유 계약 `isOnlyStageSuggestion`으로 판정해서 넘긴다 — 그 판정이 여기
 * 있지 않은 이유는 하나다. 웹과 앱이 같은 답을 해야 하고, 그 답의 정본은
 * `@hanbang/shared`에 있다.
 *
 * 같은 키라도 상태 말고 다른 것(예: 예산)이 함께 적혀 있으면 넘기지 않는다. 제안값은
 * 상태 한 줄뿐이라, 그 옆에 붙은 값은 사람이 라운지에서 적은 것이다.
 */
export function hasCoupleMadeData({
  progress,
  bookingOutcomeTasks,
  ignoredCategoryKeys,
} = {}) {
  if (Array.isArray(bookingOutcomeTasks) && bookingOutcomeTasks.length > 0) {
    return true;
  }
  if (!isRecord(progress)) return false;

  const ignored = new Set(
    Array.isArray(ignoredCategoryKeys) ? ignoredCategoryKeys : [],
  );

  for (const [key, value] of Object.entries(progress)) {
    if (key === SCHEDULE_EVENTS_KEY) {
      // 취소된 일정은 화면에도 안 나온다. 그걸로 첫 도착 화면을 거두면
      // 사람은 아무것도 없는 라운지를 설명 없이 보게 된다.
      if (
        Array.isArray(value)
        && value.some((event) => isActiveScheduleEvent(event))
      ) {
        return true;
      }
      continue;
    }
    if (key.startsWith(RESERVED_PROGRESS_PREFIX)) continue;
    if (value === null || value === undefined) continue;
    if (
      ignored.has(key)
      && isRecord(value)
      && Object.keys(value).length === 1
      && typeof value.status === "string"
    ) {
      continue;
    }
    return true;
  }

  return false;
}
