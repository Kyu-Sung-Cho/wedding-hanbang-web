/**
 * 준비 분야 → 읽을 예절 편 하나.
 *
 * ## 왜 shared 인가
 *
 * 체크리스트 화면이 웹과 모바일 둘 다에 있고, 둘 다 바닥에 「…예절 보기」 버튼을 그린다.
 * 편의 **내용**은 웹에만 있고(`apps/web/src/lib/manners/data.ts`, 25편) 모바일은 그것을
 * 웹뷰로 연다. 그래서 모바일이 필요한 것은 내용이 아니라 **어느 편으로 가는가**뿐이다.
 *
 * 지도를 양쪽에 하나씩 두면 한쪽만 고치는 날이 온다. 이 저장소는 그 병을 여러 번
 * 앓았다. 그래서 지도는 여기 하나고, 웹은 이것으로 편 객체를 찾고 모바일은 이것으로
 * 웹뷰 주소를 만든다.
 *
 * ## 제목을 여기에도 적는 이유
 *
 * 편 제목의 정본은 `data.ts` 다. 여기 적힌 것은 **모바일이 버튼에 쓸 사본**이고,
 * 둘이 어긋나면 `scripts/tests/manners-guide-map-matches-parts.test.mjs` 가 잡는다.
 * 사본을 두는 대신 25편 전체를 shared 로 옮기면 모바일 번들에 안 쓰는 본문이 들어간다.
 *
 * 여기 없는 분야는 버튼을 그리지 않는다 — 죽은 링크보다 낫다.
 */

export interface MannersGuideTarget {
  /** `/wedding/manners/<slug>` 의 마지막 조각. */
  slug: string;
  /** 편 제목. 화면에는 뒤에 `보기` 를 붙여 쓴다. */
  title: string;
}

export const MANNERS_GUIDE_BY_CATEGORY: Readonly<Record<string, MannersGuideTarget>> = {
  greeting: { slug: "first-family-visit", title: "첫인사 예절" },
  meeting: { slug: "family-meeting", title: "상견례 예절" },
  venue: { slug: "wedding-day", title: "본식 당일 예절" },
  studio: { slug: "photo-manners", title: "웨딩 촬영 매너" },
  dress: { slug: "wedding-day", title: "본식 당일 예절" },
  makeup: { slug: "wedding-day", title: "본식 당일 예절" },
  ring: { slug: "gifts-and-traditions", title: "예물·예단·함 예절" },
  hanbok: { slug: "traditional-greetings", title: "폐백 예절" },
  yedan: { slug: "gifts-and-traditions", title: "예물·예단·함 예절" },
  honeymoon: { slug: "post-honeymoon-thanks", title: "신혼여행 후 인사 예절" },
  houseware: { slug: "shared-home-items", title: "혼수 준비 예절" },
  housing: { slug: "home-conversation", title: "신혼집 논의 예절" },
  invitation: { slug: "invitation-sending", title: "청첩장 발송 예절" },
  snap: { slug: "photo-manners", title: "웨딩 촬영 매너" },
  shoes: { slug: "wedding-day", title: "본식 당일 예절" },
  bouquet: { slug: "wedding-day", title: "본식 당일 예절" },
  gift: { slug: "return-gift", title: "이바지·답례품 예절" },
  mc: { slug: "congratulatory-speech", title: "축사·축가 예절" },
  ham: { slug: "gifts-and-traditions", title: "예물·예단·함 예절" },
  pyebaek: { slug: "traditional-greetings", title: "폐백 예절" },
  registration: { slug: "marriage-registration", title: "혼인신고와 법적 절차" },
};

/** 이 분야가 여는 편. 없으면 undefined — 부르는 쪽이 버튼을 안 그린다. */
export function mannersGuideForCategory(
  categoryKey: string | null | undefined,
): MannersGuideTarget | undefined {
  if (!categoryKey) return undefined;
  return MANNERS_GUIDE_BY_CATEGORY[categoryKey];
}
