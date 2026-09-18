// 아모라 답변의 `[etiquette:N]` 번호 → 결혼 예절 안내 편(slug·제목·부제) (2026-09-18, wave 2 · 2.7).
//
// 아모라는 예절 안내를 **더 읽을 곳**으로 가리킬 때 답 끝에 `[etiquette:N]` 을 붙인다. 웹은 그 번호를 편
// 카드로 바꿔 `/manners/<slug>` 로 잇는다. 앱은 번호를 편으로 바꿀 자료가 웹 안에만 있어 편 수만 말했다.
// 여기에 번호·slug·제목·부제만 둔다 — 본문은 옮기지 않는다(앱은 편을 웹 화면으로 연다).
//
// 정본은 계속 `scripts/manners/parts.json`(웹 `MANNERS_PARTS`)이다. 이 표는 **검사받는 사본**이다 —
// `scripts/tests/manners-guide-map-matches-parts.test.mjs` 가 25편 전부의 slug·제목·부제를 정본과 맞춘다.

/** 번호 → 편. 1..25, 빠짐·중복 없음. */
export const MANNERS_PART_LINKS = Object.freeze({
  1: Object.freeze({ slug: "first-family-visit", title: "첫인사 예절", subtitle: "연인의 부모님을 처음 뵙는 날" }),
  2: Object.freeze({ slug: "family-meeting", title: "상견례 예절", subtitle: "양가가 처음 만나는 자리" }),
  3: Object.freeze({ slug: "gifts-and-traditions", title: "예물·예단·함 예절", subtitle: "전통과 요즘 방식 사이에서" }),
  4: Object.freeze({ slug: "invitation-sending", title: "청첩장 발송 예절", subtitle: "부담 주지 않고 소식을 전하는 법" }),
  5: Object.freeze({ slug: "wedding-day", title: "본식 당일 예절", subtitle: "당일 동선과 인사를 미리 한 번 훑어보기" }),
  6: Object.freeze({ slug: "post-honeymoon-thanks", title: "신혼여행 후 인사 예절", subtitle: "새로운 시작을 알리는 인사" }),
  7: Object.freeze({ slug: "traditional-greetings", title: "폐백 예절", subtitle: "예식 직후 어른들께 올리는 첫 인사" }),
  8: Object.freeze({ slug: "shared-home-items", title: "혼수 준비 예절", subtitle: "신혼 살림의 첫걸음" }),
  9: Object.freeze({ slug: "gift-money", title: "축의금", subtitle: "형편에 맞게 마음을 전하고 기록하기" }),
  10: Object.freeze({ slug: "first-holiday", title: "결혼 후 첫 명절 예절", subtitle: "새 가족과 처음 맞는 명절" }),
  11: Object.freeze({ slug: "housewarming", title: "집들이 예절", subtitle: "새 보금자리에 초대하는 법" }),
  12: Object.freeze({ slug: "photo-manners", title: "웨딩 촬영 매너", subtitle: "카메라 앞에서, 카메라 뒤에서" }),
  13: Object.freeze({ slug: "guest-manners", title: "하객 매너", subtitle: "축하하는 마음이 잘 전해지도록" }),
  14: Object.freeze({ slug: "congratulatory-speech", title: "축사·축가 예절", subtitle: "결혼식을 빛내는 한마디" }),
  15: Object.freeze({ slug: "return-gift", title: "이바지·답례품 예절", subtitle: "감사를 표현하는 방법" }),
  16: Object.freeze({ slug: "family-address", title: "양가 호칭 총정리", subtitle: "결혼하면 부르는 이름이 바뀐다" }),
  17: Object.freeze({ slug: "marriage-registration", title: "혼인신고와 법적 절차", subtitle: "법적으로 부부가 되는 과정" }),
  18: Object.freeze({ slug: "family-events", title: "결혼 후 경조사 예절", subtitle: "새 가족의 일원으로서" }),
  19: Object.freeze({ slug: "home-conversation", title: "신혼집 논의 예절", subtitle: "가장 예민한 돈 이야기" }),
  20: Object.freeze({ slug: "digital-manners", title: "결혼 후 SNS와 디지털 예절", subtitle: "온라인 시대의 부부 매너" }),
  21: Object.freeze({ slug: "planning-timeline", title: "결혼 준비 타임라인", subtitle: "D-day 기준으로 언제 무엇을 하는지" }),
  22: Object.freeze({ slug: "religious-weddings", title: "종교별 결혼식 예절", subtitle: "기독교·천주교·불교, 그리고 양가 종교가 다를 때" }),
  23: Object.freeze({ slug: "small-wedding", title: "스몰웨딩 & 야외 결혼식", subtitle: "소규모·야외 예식, 초대부터 당일 아침까지" }),
  24: Object.freeze({ slug: "planning-conflicts", title: "결혼 준비 중 갈등 관리", subtitle: "싸우지 않는 법이 아니라, 싸운 뒤에 돌아오는 법" }),
  25: Object.freeze({ slug: "cost-saving", title: "결혼 비용 절약 가이드", subtitle: "깎기 전에, 새는 곳부터 막기" }),
});

/**
 * 인용 번호를 편으로. 표에 있는 정수(1..25)에만 행을 돌려준다. 범위는 표의 키가 정한다 — 따로 숫자로
 * 다시 적지 않는다. 자기 키만 본다(프로토타입 이름은 보지 않는다).
 * @param {unknown} value
 */
export function mannersPartForCitation(value) {
  // 숫자만 받는다 — "9" 같은 문자열 번호도 편으로 읽지 않는다. 정수·범위는 표의 키가 가른다(9.5·0·26 은
  // 키가 아니다). 자기 키 검사는 방어용이다: 숫자만 들어오므로 프로토타입 이름에 닿을 길은 없다.
  if (typeof value !== "number") return undefined;
  return Object.prototype.hasOwnProperty.call(MANNERS_PART_LINKS, value) ? MANNERS_PART_LINKS[value] : undefined;
}
