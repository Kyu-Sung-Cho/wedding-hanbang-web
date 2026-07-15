/**
 * 공개 베타에서 실제 업체 연결·최신 카탈로그·가용시간 왕복을 검증할 수 없어
 * 종료한 과거 도구 이름이다. 서버의 구형 tool call 차단과 저장된 결과의
 * 역사적 안내에만 사용하며, 실행 스키마나 업체 데이터 접근을 포함하지 않는다.
 */
export const RETIRED_VENDOR_BOOKING_TOOL_NAMES: ReadonlySet<string> = new Set([
  "search_vendors",
  "recommend_vendors",
  "check_vendor_availability",
  "get_vendor_detail",
  "get_available_slots",
  "create_booking",
  "get_my_bookings",
  "cancel_booking",
]);
