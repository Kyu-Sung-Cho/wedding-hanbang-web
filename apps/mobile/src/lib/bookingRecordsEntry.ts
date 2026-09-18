/**
 * 상담 요청 기록 화면의 빈 상태 문구와, 불러오지 못한 것을 빈 상태와 가르는 판정.
 *
 * ## 왜 따로 두는가
 *
 * 업체 상담·예약 요청은 2026-07-15부터 꺼져 있다(웹은 `create_booking`을 모델에 주지 않고,
 * 앱에는 요청을 만드는 화면이 처음부터 없다). 그런데 이 화면의 빈 상태는 "업체 상세에서
 * 상담 날짜와 상품 후보를 고르면 … 여기에 모여요"라고 적어 두었다 — 앱 어디에도 그렇게
 * 고를 곳이 없어서, 그 안내를 따라간 사람은 막다른 길을 만났다.
 *
 * 이 화면은 지우지 않는다. 이미 남긴 기록(다녀온 뒤 결과 기록 포함)은 계속 볼 수 있어야
 * 하기 때문이다. 바꾸는 것은 말뿐이다 — 새 요청은 지금 남길 수 없고, 여기서는 지난 기록을
 * 본다고 그대로 적는다. 다음 행동은 요청할 업체를 찾으러 가는 길이 아니라 읽을거리
 * (업체가 공개한 가격·위약금 원문)다.
 *
 * 이 모듈은 아무것도 import하지 않는다. 테스트가 그대로 컴파일해 문구를 잰다.
 */
export const BOOKING_RECORDS_EMPTY_STATE = {
  title: "예약 요청 기록이 없어요",
  description:
    "새 상담 요청은 지금 남길 수 없어요. 예전에 남긴 요청 기록이 있으면 여기에서 볼 수 있어요.",
  actionLabel: "공시가·위약금 보기",
} as const;

/**
 * 기록을 불러오지 못했을 때 한 줄. "없다"고 말하지 않는다 — 모르는 것이지 없는 것이 아니다.
 */
export const BOOKING_RECORDS_LOAD_ERROR_MESSAGE = "예약 요청 기록을 불러오지 못했어요";

export type BookingRecordsBody = "load-error" | "empty" | "filtered-empty" | "list";

/**
 * 기록 화면 본문에 무엇을 둘 것인가.
 *
 * 예전에는 목록 길이만 보고 빈 상태를 골랐다. 불러오기가 실패해도 목록은 빈 채로 남으므로
 * 실패가 "예약 요청 기록이 없어요"로 보였다. 라운지 타일은 기록이 **있다고 확인된** 사람에게만
 * 보이니, 타일로 들어온 사람에게 그 빈 상태는 거의 언제나 실패였다.
 *
 * - 받은 기록이 없고 마지막 불러오기가 실패했다 → `"load-error"`(다시 시도).
 * - 받은 기록이 없고 불러오기는 성공했다 → `"empty"`(위 빈 상태 문구).
 * - 받은 기록은 있다 → 새로고침이 실패했어도 그 기록은 참이므로 그대로 보여준다.
 */
export function resolveBookingRecordsBody(input: {
  loadError: boolean;
  totalCount: number;
  visibleCount: number;
}): BookingRecordsBody {
  if (input.totalCount === 0) return input.loadError === true ? "load-error" : "empty";
  return input.visibleCount === 0 ? "filtered-empty" : "list";
}
