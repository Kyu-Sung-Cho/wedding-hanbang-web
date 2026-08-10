/**
 * 결혼 예절 안내(manners) 데이터 계약.
 *
 * 2026-07-17 `84b54e9f`가 예절 코퍼스 25파트를 지웠다. 지운 이유는 테스트 주석에만
 * 남아 있다 — "가족·지역마다 답이 달라서 일반 안내를 한 페이지로 주는 것보다
 * 아모라가 상황을 듣고 정리하는 쪽이 맞다".
 *
 * 그 우려는 실체가 있었다. 삭제된 원본 실측: 금액 표기 61건, 법률·세제 주장 26건,
 * 성별 역할 표현 128건, **출처 표기 0건**.
 *
 * 그래서 되살릴 때는 같은 데이터를 다시 넣는 게 아니라 계약을 먼저 만든다.
 *   - 수치·법률에는 {url, checkedAt, scope}가 붙은 출처가 **필수**다.
 *   - 출처를 못 찾은 수치는 `unsourced`로 표시하고 화면이 그렇게 알린다.
 *   - 모든 파트에 "정답이 아니라 관행"이라는 `caveat`가 붙는다.
 * 이 계약은 `__tests__/mannersSourceContract.test.ts`가 강제한다.
 *
 * 이름에 `etiquette`를 쓰지 않는다. 삭제된 라우트·파일·모바일 참조가 되살아나지
 * 않도록 `lib/etiquette/__tests__/publicEtiquetteSafety.test.ts`가 그 낱말을
 * 경로·파일명·모바일 소스 전역에서 막고 있고, 그 가드는 유지 대상이다
 * (`docs/PRODUCT_CONTRACT_PARTNER_2026-08-08.md` §9).
 */

/** 수치·법률 주장을 뒷받침하는 1차 출처. 블로그·카페는 출처로 쓰지 않는다. */
export type MannersSource = {
  /** 출처 이름. 예: "정부24 혼인신고 안내" */
  label: string;
  /** 원문 URL. 실제로 열어 확인한 것만 넣는다. */
  url: string;
  /** 확인한 날짜 YYYY-MM-DD. 관행은 시간이 지나면 달라진다. */
  checkedAt: string;
  /** 이 출처가 적용되는 범위. 예: "2025년 수도권 설문", "전국 공통 법정 절차" */
  scope: string;
  /**
   * 이 출처의 어느 대목이 무엇을 뒷받침하는지.
   *
   * 출처 세탁을 막는 자리다 — 진짜 URL을 붙였지만 그 페이지가 실제로는 그 수치를
   * 말하지 않는 경우가 가장 흔한 실패다. 여기에 적을 수 없으면 그 출처는 쓰면 안 된다.
   */
  supports: string;
};

export type MannersDialogueLine = {
  /** 실제로 할 수 있는 말. 이 제품의 값은 추상적 조언이 아니라 이 문장들이다. */
  say: string;
  /** 언제 쓰는 말인지, 왜 그렇게 말하는지 */
  note?: string;
};

export type MannersBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "checklist"; title?: string; items: string[] }
  | { kind: "tip"; title?: string; items: string[] }
  | { kind: "warning"; title?: string; items: string[] }
  | { kind: "dialogue"; title?: string; lines: MannersDialogueLine[] }
  | {
      kind: "table";
      title: string;
      /** 표 아래에 항상 보이는 한 줄. "정답이 아니라 관행"을 여기서 말한다. */
      caption: string;
      /**
       * 이 수치의 기준 시점. **표 안에서** 보여야 한다.
       *
       * 출처 각주에만 시점을 적었더니 표가 현재 값처럼 읽혔다. 사용자는 표만 캡처해
       * 옮기고, 옮겨진 표에는 각주가 따라가지 않는다. 예: "2025년 4월 조사 기준"
       */
      asOf: string;
      /**
       * **이 숫자가 말하지 않는 것.** 이 계약의 핵심이다.
       *
       * 출처·확인일·적용범위를 다 붙여도 오해가 남는다는 것을 2026-08-08에 확인했다 —
       * 한국소비자원 참가격의 1인당 식대 중간가격 58,000원은 전국 예식장 370곳을 합친
       * 값이고 **조사에 호텔·특급 예식장이 따로 구분돼 있지 않다**(원문 확인). 호텔에서
       * 하는 사용자가 이 값을 기준으로 삼으면 크게 어긋난다. 출처가 완벽해도 대표성
       * 한계를 말하지 않으면 잘못된 정보가 된다.
       *
       * 그래서 수치 표에는 한계를 반드시 적는다. 적을 게 없다고 판단되면 그 표는
       * 애초에 실을 만한 표가 아닐 가능성이 높다.
       */
      limits: string;
      columns: string[];
      rows: string[][];
      /** 출처를 찾지 못한 표. 화면이 그렇게 알리고, 계약 테스트가 개수를 감시한다. */
      unsourced?: boolean;
    };

export type MannersSection = {
  heading: string;
  blocks: MannersBlock[];
};

/** 이 파트를 읽는 사람. 1단계는 하객·지인 성격의 파트부터 낸다. */
export type MannersAudience = "guest" | "couple" | "both";

export type MannersPart = {
  /** URL 조각. 영문 소문자·하이픈. */
  slug: string;
  /** 삭제된 원본에서의 파트 번호. 되살린 출처를 추적할 수 있게 남긴다. */
  legacyNumber: number;
  title: string;
  subtitle: string;
  description: string;
  audience: MannersAudience;
  /** "지역·가족·모임마다 다를 수 있어요" 계열 고지. 화면 상단에 항상 보인다. */
  caveat: string;
  sections: MannersSection[];
  sources: MannersSource[];
};

export type MannersCategory = {
  label: string;
  slugs: string[];
};

/** 표 블록만 모아 준다 — 출처 계약 검사와 화면의 출처 표기가 같은 목록을 본다. */
export function mannersTables(part: MannersPart): Extract<MannersBlock, { kind: "table" }>[] {
  return part.sections
    .flatMap((section) => section.blocks)
    .filter((block): block is Extract<MannersBlock, { kind: "table" }> => block.kind === "table");
}

/** 이 파트가 수치를 주장하는가. 주장하면 출처 없이는 낼 수 없다. */
export function claimsNumbers(part: MannersPart): boolean {
  return mannersTables(part).length > 0;
}
