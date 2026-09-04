/**
 * 체크리스트 항목 → 그 안내의 근거가 되는 예절 절.
 *
 * ## 왜 shared 인가
 *
 * 시안 여덟 장 모두 항목 밑에 「근거 · [절 제목]」 칩을 그린다. 웹은 이 표를
 * `apps/web/src/lib/etiquette/noteSources.ts` 에 두고 있었는데 **모바일은 그 파일을
 * 읽을 수 없어** 칩이 아예 없었다. 사본을 만들면 한쪽이 낡으므로 표를 여기로 올린다.
 *
 * ## 절 번호를 함께 싣는 이유
 *
 * 링크는 `/wedding/manners/<slug>#section-N` 으로 가야 그 절이 열린다. N 은 편 안에서
 * 절의 순서인데, 그 순서는 편 **내용**(웹 전용 `data.ts`)에만 있다. 모바일이 웹뷰
 * 주소를 만들려면 번호가 필요해서 여기에 같이 적었다.
 *
 * **이 번호는 사본이라 낡을 수 있다.** 절을 추가·이동하면 어긋난다. 그래서
 * `scripts/tests/manners-guide-map-matches-parts.test.mjs` 가 편 내용에서 다시 세어
 * 대조한다 — 어긋나면 빨간불이다.
 *
 * ## 없는데 지어내지 않는다
 *
 * 설계 문서: 「항목 설명에 다른 가이드의 절 제목이 나오면 근거 칩을 답니다 — 없는데
 * 지어내지 않아요.」 172개 항목 중 59개에만 있다.
 */

export interface ChecklistNoteSource {
  /** 예절 편 slug. */
  part: string;
  /** 절 제목. 화면에 그대로 나간다(앞의 `5. ` 같은 번호는 표시할 때만 벗긴다). */
  heading: string;
  /** 편 안에서 이 절의 순서(1부터). 링크의 `#section-N` 이 된다. */
  sectionIndex: number;
}

export const CHECKLIST_NOTE_SOURCES: Readonly<Record<string, ChecklistNoteSource>> = {
  venue_04: { part: "cost-saving", heading: "3. 견적서에서 돈이 새는 자리", sectionIndex: 3 },
  venue_06: { part: "cost-saving", heading: "4. 가장 크게 새는 돈 — 취소·변경 위약금", sectionIndex: 4 },
  venue_09: { part: "cost-saving", heading: "5. 항목별로 줄일 수 있는 자리 — 숫자 대신 질문 목록", sectionIndex: 5 },
  venue_07: { part: "small-wedding", heading: "초대와 안내 — 부르는 쪽이 먼저 정리할 것", sectionIndex: 2 },
  venue_08: { part: "wedding-day", heading: "시작하기 전에 — 당일에 이미 정해져 있는 것", sectionIndex: 1 },
  studio_09: { part: "cost-saving", heading: "2. 2025년 11월부터 달라진 것 — 가격 공개는 '부탁'이 아니라 '의무'", sectionIndex: 2 },
  studio_06: { part: "cost-saving", heading: "2. 2025년 11월부터 달라진 것 — 가격 공개는 '부탁'이 아니라 '의무'", sectionIndex: 2 },
  studio_05: { part: "photo-manners", heading: "스튜디오 촬영 전에 챙길 것", sectionIndex: 2 },
  ring_10: { part: "gifts-and-traditions", heading: "예물 — 두 사람이 오래 쓸 것", sectionIndex: 1 },
  ring_06: { part: "gifts-and-traditions", heading: "예물 — 두 사람이 오래 쓸 것", sectionIndex: 1 },
  snap_05: { part: "photo-manners", heading: "사진을 나누고 올릴 때", sectionIndex: 8 },
  housing_04: { part: "home-conversation", heading: "분담 이야기 — 오래된 공식과 요즘", sectionIndex: 2 },
  housing_05: { part: "home-conversation", heading: "언제, 어떤 순서로 꺼내나", sectionIndex: 1 },
  invitation_03: { part: "invitation-sending", heading: "1. 청첩장에 무엇을 담을지 먼저 정하기", sectionIndex: 1 },
  invitation_05: { part: "invitation-sending", heading: "3. 언제부터 보낼까", sectionIndex: 3 },
  invitation_04: { part: "invitation-sending", heading: "3. 언제부터 보낼까", sectionIndex: 3 },
  invitation_06: { part: "invitation-sending", heading: "1. 청첩장에 무엇을 담을지 먼저 정하기", sectionIndex: 1 },
  invitation_07: { part: "invitation-sending", heading: "9. 모바일 청첩장 링크와 스미싱", sectionIndex: 9 },
  makeup_06: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  gift_04: { part: "return-gift", heading: "답례품 고르기", sectionIndex: 4 },
  gift_06: { part: "return-gift", heading: "답례품 고르기", sectionIndex: 4 },
  pyebaek_05: { part: "traditional-greetings", heading: "미리 확인해 둘 것", sectionIndex: 3 },
  registration_01: { part: "marriage-registration", heading: "결혼식과 혼인신고는 다른 일입니다", sectionIndex: 1 },
  registration_03: { part: "marriage-registration", heading: "자녀의 성과 본 — 혼인신고서에서만 정할 수 있는 항목", sectionIndex: 7 },
  registration_04: { part: "marriage-registration", heading: "가져갈 것", sectionIndex: 3 },
  registration_05: { part: "marriage-registration", heading: "가져갈 것", sectionIndex: 3 },
  registration_06: { part: "marriage-registration", heading: "어디에 내나요", sectionIndex: 4 },
  registration_09: { part: "marriage-registration", heading: "신고를 마친 뒤 챙길 것", sectionIndex: 8 },
  registration_10: { part: "marriage-registration", heading: "신고를 마친 뒤 챙길 것", sectionIndex: 8 },
  pyebaek_03: { part: "traditional-greetings", heading: "준비물 — 음식과 의상", sectionIndex: 2 },
  greeting_04: { part: "first-family-visit", heading: "선물 — 무엇을 얼마나", sectionIndex: 2 },
  meeting_02: { part: "family-meeting", heading: "장소와 일정 정하기", sectionIndex: 1 },
  meeting_05: { part: "planning-conflicts", heading: "양가 어른의 의견이 들어올 때", sectionIndex: 4 },
  meeting_06: { part: "planning-conflicts", heading: "부딪힐 때 도움이 되는 다섯 가지", sectionIndex: 9 },
  dress_07: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  dress_08: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  shoes_01: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  shoes_02: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  shoes_04: { part: "wedding-day", heading: "두 사람 — 식이 끝난 뒤", sectionIndex: 5 },
  bouquet_02: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  bouquet_05: { part: "wedding-day", heading: "두 사람 — 식 전 준비", sectionIndex: 3 },
  bouquet_06: { part: "small-wedding", heading: "계약 전에 종이로 남길 것", sectionIndex: 4 },
  hanbok_01: { part: "traditional-greetings", heading: "준비물 — 음식과 의상", sectionIndex: 2 },
  hanbok_05: { part: "traditional-greetings", heading: "준비물 — 음식과 의상", sectionIndex: 2 },
  hanbok_07: { part: "traditional-greetings", heading: "준비물 — 음식과 의상", sectionIndex: 2 },
  yedan_01: { part: "gifts-and-traditions", heading: "예단 — 무엇을 주고받아 왔나", sectionIndex: 2 },
  yedan_02: { part: "gifts-and-traditions", heading: "예단 — 무엇을 주고받아 왔나", sectionIndex: 2 },
  yedan_05: { part: "gifts-and-traditions", heading: "예단 — 무엇을 주고받아 왔나", sectionIndex: 2 },
  yedan_06: { part: "gifts-and-traditions", heading: "예단 — 무엇을 주고받아 왔나", sectionIndex: 2 },
  ham_02: { part: "gifts-and-traditions", heading: "함 — 요즘은 어떻게 하나", sectionIndex: 3 },
  ham_03: { part: "gifts-and-traditions", heading: "함 — 요즘은 어떻게 하나", sectionIndex: 3 },
  ham_04: { part: "gifts-and-traditions", heading: "함 — 요즘은 어떻게 하나", sectionIndex: 3 },
  ham_06: { part: "gifts-and-traditions", heading: "함 — 요즘은 어떻게 하나", sectionIndex: 3 },
  honeymoon_02: { part: "cost-saving", heading: "5. 항목별로 줄일 수 있는 자리 — 숫자 대신 질문 목록", sectionIndex: 5 },
  honeymoon_04: { part: "cost-saving", heading: "5. 항목별로 줄일 수 있는 자리 — 숫자 대신 질문 목록", sectionIndex: 5 },
  houseware_01: { part: "home-conversation", heading: "분담 이야기 — 오래된 공식과 요즘", sectionIndex: 2 },
  houseware_03: { part: "cost-saving", heading: "5. 항목별로 줄일 수 있는 자리 — 숫자 대신 질문 목록", sectionIndex: 5 },
  houseware_04: { part: "shared-home-items", heading: "이런 데서 자주 부딪힙니다", sectionIndex: 4 },
  houseware_05: { part: "shared-home-items", heading: "이런 데서 자주 부딪힙니다", sectionIndex: 4 },
};

/**
 * 편 slug → 제목. 25편 전부.
 *
 * 정본은 웹의 `data.ts` 다. 여기 있는 것은 **모바일이 칩·버튼에 쓸 사본**이고,
 * 어긋나면 위에 적은 가드가 잡는다. 25편 본문을 shared 로 옮기면 모바일 번들에
 * 안 읽는 글이 실린다.
 */
export const MANNERS_PART_TITLES: Readonly<Record<string, string>> = {
  "first-family-visit": "첫인사 예절",
  "family-meeting": "상견례 예절",
  "planning-timeline": "결혼 준비 타임라인",
  "planning-conflicts": "결혼 준비 중 갈등 관리",
  "gifts-and-traditions": "예물·예단·함 예절",
  "shared-home-items": "혼수 준비 예절",
  "home-conversation": "신혼집 논의 예절",
  "cost-saving": "결혼 비용 절약 가이드",
  "invitation-sending": "청첩장 발송 예절",
  "small-wedding": "스몰웨딩 & 야외 결혼식",
  "religious-weddings": "종교별 결혼식 예절",
  "wedding-day": "본식 당일 예절",
  "guest-manners": "하객 매너",
  "photo-manners": "웨딩 촬영 매너",
  "traditional-greetings": "폐백 예절",
  "gift-money": "축의금",
  "congratulatory-speech": "축사·축가 예절",
  "return-gift": "이바지·답례품 예절",
  "marriage-registration": "혼인신고와 법적 절차",
  "post-honeymoon-thanks": "신혼여행 후 인사 예절",
  "housewarming": "집들이 예절",
  "digital-manners": "결혼 후 SNS와 디지털 예절",
  "family-address": "양가 호칭 총정리",
  "first-holiday": "결혼 후 첫 명절 예절",
  "family-events": "결혼 후 경조사 예절",
};

/** 표시용으로만 앞의 `5. ` 같은 절 번호를 벗긴다. 조회 키로는 절대 쓰지 마라. */
export function mannersHeadingForDisplay(heading: string): string {
  return heading.replace(/^\d+\.\s*/, "");
}

/**
 * 이 항목의 근거 칩에 쓸 글자와 주소. 근거가 없으면 undefined.
 *
 * **같은 편이면 절 제목을, 다른 편이면 편 제목을 쓴다.** 근거 59개 중 46개는 분야
 * 카드가 이미 여는 그 편을 가리킨다. 거기에 편 제목을 달면 한 화면에 같은 줄이
 * 일곱 번 반복된다(혼인신고가 그랬다).
 *
 * @param categoryPartSlug 이 분야 카드가 여는 편. 모르면 넘기지 않아도 된다.
 */
export function checklistNoteSourceChip(
  itemId: string,
  categoryPartSlug?: string,
): { label: string; path: string } | undefined {
  const source = CHECKLIST_NOTE_SOURCES[itemId];
  if (!source) return undefined;

  const sameAsCategoryCard = source.part === categoryPartSlug;
  const title = MANNERS_PART_TITLES[source.part];
  if (!sameAsCategoryCard && !title) return undefined;

  return {
    label: sameAsCategoryCard
      ? `근거 · ${mannersHeadingForDisplay(source.heading)}`
      : `근거 · ${title}`,
    path: `/manners/${source.part}#section-${source.sectionIndex}`,
  };
}
