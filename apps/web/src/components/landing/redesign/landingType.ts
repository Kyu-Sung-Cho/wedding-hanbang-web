/**
 * 랜딩 디스플레이 타입 시스템.
 *
 * DESIGN.md는 Paperlogy 한 종류로 "웨이트·크기·색·간격만으로 위계를 만든다"고 정한다.
 * 그런데 8개 섹션이 각자 다른 clamp 곡선과 각자 다른 leading·tracking을 쓰고 있었다.
 *
 *   히어로 H1  clamp(2.4rem, 10.5vw, 4.25rem)  leading .96   tracking -.058em
 *   문제 거울  clamp(2.25rem, 7.5vw, 4rem)     leading 1.03  tracking -.055em
 *   준비 결과  clamp(2.25rem, 7vw, 3.8rem)     leading 1.04  tracking -.045em
 *   연속성     clamp(2.3rem, 7vw, 4.15rem)     leading 1.04  tracking -.05em
 *   공유/개인  clamp(2.2rem, 6.8vw, 3.8rem)    leading 1.06  tracking -.04em
 *   커뮤니티   clamp(1.35rem, 3.5vw, 1.75rem)  leading 1.3   tracking -.03em
 *   신뢰       clamp(2.4rem, 7vw, 4.5rem)      leading 1.02  tracking -.05em
 *   마무리     clamp(2.4rem, 7vw, 4.6rem)      leading 1.04  tracking -.05em
 *
 * 8개 곡선이 전부 달랐고, 그 결과 1280px 실측에서 신뢰(72px)와 마무리(73.6px)가
 * H1(68px)보다 커지는 위계 역전이 생겼다. 랜딩에서 가장 큰 타입은 H1이어야 한다.
 *
 * 아래 세 단계만 사용한다. 새 섹션이 자기만의 곡선을 만들지 않게 하는 것이 목적이다.
 * `text-balance`는 한글 헤드라인의 고아 글자를 막는다 — `word-break: keep-all`(globals.css)이
 * 어절 단위로만 끊어 주지만, 마지막 줄에 한 어절만 남는 것("… 해야 할 / 일.")까지는
 * 막지 못한다.
 */

/** H1 전용. 페이지에서 가장 큰 타입이며 히어로 첫 화면 높이에 맞춰 조정돼 있다. */
export const displayHero =
  "text-balance text-[clamp(2.4rem,10.5vw,4.25rem)] font-semibold leading-[0.96] tracking-[-0.058em]";

/** 주요 섹션 h2. 최대값이 H1보다 항상 작다(3.9rem < 4.25rem). */
export const displaySection =
  "text-balance text-[clamp(2.25rem,7vw,3.9rem)] font-semibold leading-[1.04] tracking-[-0.05em]";

/** 의도적으로 낮춘 섹션. 현재는 운영 공개 전 커뮤니티 안내 스트립만 사용한다. */
export const displayMuted =
  "text-balance text-[clamp(1.35rem,3.5vw,1.75rem)] font-semibold leading-[1.3] tracking-[-0.03em]";

/**
 * 웨이트 사다리.
 *
 * DESIGN.md는 "Paperlogy weight, size, color, and spacing으로 위계를 만든다"고 정하고
 * globals.css는 100~900을 자가호스팅한다. 그런데 랜딩 10개 컴포넌트의 실제 사용은
 * `font-semibold` 72회 + `font-medium` 8회뿐이었다(bold·light 0회).
 *
 * 웨이트가 사실상 하나면 위계 채널이 크기밖에 남지 않는다. 그래서 12px 라벨과 73.6px
 * 헤드라인이 같은 600을 쓰고, 그 사이를 메우려고 13·15·17·19·21·22·23·26·27px가
 * 발명됐다(스케일 밖 49곳). 크기를 스케일로 되돌리려면 웨이트를 먼저 열어야 한다.
 *
 *   normal    본문
 *   medium    본문 안의 값·강조
 *   semibold  제목·버튼·구조 라벨
 *   bold      eyebrow와 데이터 숫자 — 작아도 먼저 읽혀야 하는 것
 */

/**
 * 섹션 라벨의 타이포그래피만. 색을 자식 span이 각자 정하는 히어로처럼, 색을
 * 붙일 수 없는 자리에서 쓴다. 크기·웨이트·자간이 흩어지지 않게 하는 것이 목적이다.
 */
export const sectionEyebrowTypography = "text-[12px] font-bold tracking-[0.01em]";

/**
 * 섹션 라벨. 12px(xs)로 내리고 bold로 존재감을 되찾는다.
 * 색은 rose-600이 아니라 rose-700이다 — 12px는 WCAG상 4.5:1이 필요한데
 * rose-600(#8F6662)은 ivory-blush(#F3E9DD) 위에서 4.13:1로 미달했다(실측).
 */
export const sectionEyebrow = `${sectionEyebrowTypography} text-rose-700`;
/** 어두운 배경 위의 같은 라벨. */
export const sectionEyebrowOnDark = `${sectionEyebrowTypography} text-gold-light`;

/**
 * 섹션 본문 lede. 이전에는 15→16, 15→17, 16→17, 14→15의 7가지 램프가 섞여 모바일에서
 * 같은 역할이 16/15/15/15/14/15/15px로 흔들렸다. 한 가지만 쓴다.
 * 줄 길이는 히어로 본문(1280에서 44자)을 기준으로 `max-w-[34rem]` 안에 둔다.
 */
export const sectionLede = "text-[16px] leading-[1.75] sm:text-[18px] sm:leading-[1.7]";
/** 낮춘 섹션의 본문. */
export const sectionLedeCompact = "text-[14px] leading-[1.7] sm:text-[16px]";

/**
 * 보조 링크 한 벌.
 *
 * 같은 역할이 2가지 크기 × 4가지 밑줄 알파 × 2가지 웨이트 × 2가지 포커스 처리로
 * 갈려 있었다. 포커스 offset 규칙은 이미 페이지에 있다 — 카드·폼 안이면 2, 열린
 * 지면이면 4, 문단 안 인라인이면 없음. 그 규칙만 지킨다.
 */
export const secondaryLink =
  "inline-flex min-h-11 items-center text-[14px] font-semibold text-noir-800 underline decoration-noir-800/30 underline-offset-4 transition-colors duration-200 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600";
/** 어두운 배경 위의 같은 링크. */
export const secondaryLinkOnDark =
  "inline-flex min-h-11 items-center text-[14px] font-semibold text-gold-light underline decoration-gold-light/40 underline-offset-4 transition-colors duration-200 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-light";

/**
 * 문장 안에 흐르는 링크.
 *
 * 위 두 개와 달리 44px 최소 높이를 주지 않는다. 문단 안 inline 요소에 44px를 주면
 * line box가 44px로 벌어져 링크가 혼자 줄을 차지하고 위아래에 빈 칸이 생긴다.
 * WCAG 2.5.8은 문장 안에 있는(inline) 대상을 크기 요건에서 명시적으로 제외한다.
 * 문장 밖에 홀로 서는 링크는 반드시 `secondaryLink*`를 쓴다.
 */
export const inlineLink =
  "underline decoration-current/30 underline-offset-4 transition-colors duration-200 hover:text-noir-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-600";

/**
 * 섹션 세로 리듬.
 *
 * 이전에는 본문 섹션이 `py-16 sm:py-20 lg:py-24`와 `py-14 sm:py-16 lg:py-20`으로
 * 갈렸고 커뮤니티 띠만 `py-8 sm:py-10`이었다. 그 결과 섹션 사이 간격이 390px에서
 * 5종, 1280px에서 6종이 됐다. 56 대 64는 의도된 위계로 읽히기엔 너무 작고
 * 같다고 보기엔 너무 큰 차이다. 두 단계만 쓴다.
 */
export const sectionRhythm = "py-16 sm:py-20 lg:py-24";

/**
 * 의도적으로 낮춘 섹션의 리듬. 이웃의 1/4 깊이였던 커뮤니티 띠를 끌어올려
 * 중간 광고 삽입물처럼 보이지 않게 하되, 본문 섹션보다는 확실히 얕게 둔다.
 */
export const sectionRhythmCompact = "py-12 sm:py-14 lg:py-16";

/**
 * 기본 행동 버튼.
 *
 * 같은 "아모라와 시작하기"가 헤더 `rounded-full`/14px/44px, 히어로
 * `rounded-xl`(12px)/14px/48px, 마무리 `rounded-[16px]`/15px/56px로 세 가지
 * 실루엣이었다. 하나의 행동은 하나의 물체로 읽혀야 한다. 모양과 전이는 고정하고
 * 크기만 위치에 따라 고른다. 15px는 타입 스케일 밖이라 14/16으로 정렬한다.
 *
 * `translate`를 전이 목록에 넣는 이유: Tailwind v4의 `-translate-y-*`는
 * `transform`이 아니라 독립 `translate` 속성을 쓴다. 빠뜨리면 배경색만 부드럽게
 * 바뀌고 들어올림은 즉시 튄다. `active:`는 hover가 없는 터치 기기의 유일한
 * 누름 피드백이고, `motion-safe:`는 reduced motion에서 이동을 적용하지 않는다.
 */
/* 정렬(`justify-*`)과 포커스 링 색은 배치마다 달라야 하므로 여기 넣지 않는다.
 * 어두운 히어로와 밝은 마무리 섹션은 링 색·offset이 서로 달라야 보인다. */
const primaryActionBase =
  "group inline-flex items-center gap-3 rounded-full bg-rose-600 font-semibold text-white transition-[background-color,translate] duration-200 motion-safe:hover:-translate-y-0.5 hover:bg-rose-700 active:translate-y-0 active:bg-rose-700 focus-visible:outline-none focus-visible:ring-2";

/** 헤더처럼 좁은 자리. */
export const primaryActionSm = `${primaryActionBase} min-h-11 px-4 text-[14px] sm:px-5`;
/** 히어로 폼처럼 본문 안. */
export const primaryActionMd = `${primaryActionBase} min-h-12 px-4 text-[14px]`;
/** 페이지 마지막 행동. */
export const primaryActionLg = `${primaryActionBase} min-h-14 px-6 text-[16px] sm:px-8`;
