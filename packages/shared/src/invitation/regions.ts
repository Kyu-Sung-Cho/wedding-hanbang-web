/**
 * 지역의 정본 목록(시·도). 첫 대화의 지역 고르기, 결혼 조건 저장, 운영자 웨딩홀 입력, DB 검사 제약이
 * 모두 이 목록을 쓴다. 그래서 커플 조건의 지역과 홀의 지역이 글자 그대로 맞고, 비교는 같은 글자끼리만 찾는다.
 *
 * 값은 짧은 이름이다("서울"). 순서는 행정구역 표준 순서다. 웨딩홀 비교는 시·도 단위로 찾으므로
 * 서울 자치구까지 나누지 않는다. 홀이 있는 동네는 홀 자료의 area_label("마포구 하우스웨딩")이 보여 준다.
 * 이 목록을 바꾸면 20261117090000 마이그레이션의 hall_listings_region_check 도 같이 바꾼다(시험이 맞춰 본다).
 */
export const INVITATION_REGIONS = [
  "서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주",
] as const;

export type InvitationRegion = (typeof INVITATION_REGIONS)[number];

export function isInvitationRegion(value: unknown): value is InvitationRegion {
  return typeof value === "string" && (INVITATION_REGIONS as readonly string[]).includes(value);
}

/**
 * 공식 이름("서울특별시", "경기도", 옛 이름 "강원도")을 짧은 이름으로 바꾼다. 둘로 읽힐 수 있는 말은 받지 않는다.
 * "광주시"는 경기도에도 있어서 받지 않고, 시·군·구 이름도 받지 않는다. 짐작해서 고르지 않기 위해서다.
 */
const REGION_ALIASES: Readonly<Record<string, InvitationRegion>> = {
  서울시: "서울",
  서울특별시: "서울",
  부산시: "부산",
  부산광역시: "부산",
  대구시: "대구",
  대구광역시: "대구",
  인천시: "인천",
  인천광역시: "인천",
  광주광역시: "광주",
  대전시: "대전",
  대전광역시: "대전",
  울산시: "울산",
  울산광역시: "울산",
  세종시: "세종",
  세종특별자치시: "세종",
  경기도: "경기",
  강원도: "강원",
  강원특별자치도: "강원",
  충청북도: "충북",
  충청남도: "충남",
  전라북도: "전북",
  전북특별자치도: "전북",
  전라남도: "전남",
  경상북도: "경북",
  경상남도: "경남",
  제주도: "제주",
  제주특별자치도: "제주",
};

/** 목록의 짧은 이름이나 공식 이름이면 짧은 이름을, 아니면 null 을 준다. 띄어쓰기는 보지 않는다. */
export function normalizeInvitationRegion(value: unknown): InvitationRegion | null {
  if (typeof value !== "string") return null;
  const compact = value.normalize("NFC").replace(/\s+/g, "");
  if (isInvitationRegion(compact)) return compact;
  return Object.prototype.hasOwnProperty.call(REGION_ALIASES, compact) ? REGION_ALIASES[compact] : null;
}
