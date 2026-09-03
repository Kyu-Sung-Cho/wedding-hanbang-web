import type { ReactNode } from "react";

/**
 * 랜딩의 노트 문법 — 공통 껍데기.
 *
 * 색·서체·장식 클래스는 `globals.css` 의 `랜딩 — 결혼 준비 노트` 블록에 있다.
 * 여기 있는 건 배치뿐이다.
 *
 * ## 왜 컴포넌트로 묶나
 *
 * 이 저장소엔 공유 UI 프리미티브가 0개다(Button/Card/Input 파일이 없다). 그래서
 * 색이 517종, 타입이 43종으로 갈라졌다. 랜딩 8개 섹션도 각자 다른 max-width 와
 * 각자 다른 세로 여백을 쓰고 있었다. 새 섹션이 자기 값을 발명하지 않게 여기서 막는다.
 */

/**
 * 모든 섹션이 같은 폭을 쓴다.
 *
 * 2026-09-03: 1080 → 1240. 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)의 1440px
 * 화면에서 글이 x=122 에서 시작해 x=1318 에서 끝난다(내용 폭 1194px). 1080 이면
 * 히어로가 2단이 되는 순간 왼쪽 단이 좁아 H1 이 두 줄로 안 떨어진다 — 실제로 네 줄이
 * 됐다. 좌우 여백 32px 을 더해 1240 이 시안의 내용 폭과 맞는다.
 */
export const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8";

/** 섹션 세로 리듬 — 한 단계만 쓴다. */
/**
 * 섹션 세로 리듬 — 한 단계만 쓴다.
 *
 * 처음엔 py-24(96px)였다. 섹션 둘이 만나면 192px 이 생기고, 2단 배치에서 짧은 쪽
 * 아래가 비는 것과 겹쳐 1280px 실측에서 450px 짜리 구멍이 났다. 76px 로 줄인다.
 */
export const band = "py-14 sm:py-[76px]";

/**
 * 같은 리듬을 위아래로 나눠 쓸 때.
 *
 * 2026-09-03 시안의 끝 다크 밴드는 두 섹션(경계·마무리)이 **한 덩어리 어두운 띠**로
 * 이어진다. 둘 다 `band` 를 쓰면 사이에 152px 이 생겨 띠가 두 조각으로 읽히므로,
 * 위 섹션이 `bandTop` 을 아래 섹션이 `bandBottom` 을 갖고 가운데는 가는 선 하나가 나눈다.
 * **값은 같은 한 걸음이다** — 여기서 새 리듬을 만들지 마라.
 */
export const bandTop = "pt-14 sm:pt-[76px]";
export const bandBottom = "pb-14 sm:pb-[76px]";

type SectionProps = {
  id?: string;
  /** 테이프 이름표에 들어갈 짧은 말. 손글씨로 나간다. */
  eyebrow?: string;
  /** h2. 줄바꿈은 \n 으로 넣는다. */
  title: string;
  children?: ReactNode;
  /** 종이 톤을 한 단계 깊게 칠해 섹션 경계를 만든다. 페이지 바탕과 달라야 한다. */
  tinted?: boolean;
  className?: string;
};

/**
 * 섹션 제목 크기.
 *
 * H1(clamp 2.4→3.6rem)보다 항상 작아야 한다. 이전 랜딩에서 신뢰·마무리 섹션이
 * H1보다 커져 위계가 뒤집힌 적이 있다. 최대값 2.9rem 이 그 사고를 구조적으로 막는다.
 */
const sectionTitleShape =
  // 최대값 2.9rem → 2.45rem(2026-09-03). 시안의 섹션 제목 첫 줄("할 일을 몰라서가
  // 아니에요.")을 재니 398px 이고, Paperlogy 600 에 자간 -0.035em 이면 39px 에서
  // 394px 이다. 잉크 높이로 재면 35px 이 나오는데 시안 서체가 우리보다 좁아 생기는
  // 차이라, **줄이 어디서 끊기는지를 정하는 폭**을 기준으로 삼았다.
  "text-balance text-[clamp(1.75rem,4.6vw,2.45rem)] font-semibold leading-[1.18] tracking-[-0.035em]";

export const sectionTitle = `${sectionTitleShape} text-[var(--color-paper-ink)]`;

/**
 * 같은 곡선, 잉크 위에 얹는 색.
 *
 * 2026-09-03 시안의 끝 다크 밴드(경계 + 마무리)가 쓴다. 색만 다른 상수를 따로 두는
 * 대신 곡선을 나눠 갖는다 — `sectionTitle` 에 색 유틸리티를 하나 더 겹치면 같은
 * 속성을 두 번 선언하게 되고, 어느 쪽이 이기는지가 클래스 순서에 달린다.
 */
export const sectionTitleOnInk = `${sectionTitleShape} text-[var(--color-paper-on-ink)]`;

/**
 * 정본의 `\n` 을 줄로 그린다.
 *
 * `<Section>` 을 쓰지 않고 자기 `<section>` 을 여는 자리(경계·마무리)가 쓴다.
 * 값을 프로프로 받는 이유가 하나 더 있다 — 여러 가드가 `{blockName.title}` 이라는
 * **글자**로 "화면이 정본을 그리는지"를 판정한다. 여기서 `value.split(…)` 를 손으로
 * 적으면 그 글자가 사라져 "카피에만 있고 아무도 안 그린다" 로 읽힌다.
 */
export function TitleLines({ value }: { value: string }) {
  return (
    <>
      {value.split("\n").map((line) => (
        <span key={line} className="block">
          {line}
        </span>
      ))}
    </>
  );
}

/**
 * 카드 안에서 한 단계 큰 인용문 — 장면 문항처럼 "읽으라고 뽑아 놓은" 문장.
 * 섹션 제목보다 작고 본문보다 크다. 자기 곡선을 만들지 않게 여기에 둔다.
 */
export const quoteText =
  "text-[clamp(1.05rem,2.4vw,1.25rem)] font-medium leading-8";

export const bodyText =
  "text-[clamp(1rem,1.9vw,1.125rem)] leading-[1.85] text-[var(--color-paper-ink-soft)]";

export const noteText = "text-[14px] leading-[1.75] text-[var(--color-paper-ink-faint)]";

/**
 * 같은 문체, 잉크 위에 얹는 색. 끝 다크 밴드의 작은 글씨(고지·단서)가 쓴다.
 *
 * 작은 글씨는 이 랜딩에서 **고지가 사는 자리**다. 지면이 하나 늘었다고 그 문체가
 * 섹션마다 갈리면 고지가 장식처럼 읽힌다 — 그래서 색만 바꾸고 크기·행간은 같다.
 */
export const noteTextOnInk = "text-[14px] leading-[1.75] text-[var(--color-paper-on-ink-faint)]";

export function Section({ id, eyebrow, title, children, tinted, className = "" }: SectionProps) {
  return (
    <section
      id={id}
      className={`${band} ${tinted ? "bg-[var(--color-paper-tint)]" : ""} ${className}`}
      // 제목을 섹션 이름으로 읽어 준다. 랜드마크가 8개인데 이름이 없으면
      // 스크린리더 목록에서 "section" 만 여덟 줄 나온다.
      aria-labelledby={id ? `${id}-title` : undefined}
    >
      <div className={shell}>
        {eyebrow ? (
          <p className="mb-6">
            <span className="landing-tape landing-hand">{eyebrow}</span>
          </p>
        ) : null}
        <h2 id={id ? `${id}-title` : undefined} className={sectionTitle}>
          {title.split("\n").map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>
        {children}
      </div>
    </section>
  );
}

/**
 * 줄 그은 노트 카드.
 *
 * 줄 간격이 32px 이라 안쪽 글줄도 그 배수로 앉혀야 줄 위에 글이 얹힌 것처럼 보인다.
 * 안 맞추면 줄과 글자가 어긋나 그냥 배경 무늬가 된다.
 */
/**
 * 노트 카드 안의 글줄.
 *
 * 카드의 줄이 32px 간격이므로 글줄도 32px 이어야 **줄 위에 글이 얹힌 것처럼** 보인다.
 * 안 맞추면 줄과 글자가 어긋나 그냥 배경 무늬가 된다 — 처음에 leading-[1.7](25.5px)로
 * 뒀다가 실제로 그렇게 보였다.
 */
export const ruled = "text-[16px] leading-8 text-[var(--color-paper-ink-soft)]";

export function NoteCard({
  children,
  className = "",
  tilt = 0,
}: {
  children: ReactNode;
  className?: string;
  /** 살짝 기울여 손으로 놓은 종이처럼 보이게 한다. -1.5 ~ 1.5 정도만. */
  tilt?: number;
}) {
  return (
    <div
      className={`landing-note px-6 py-8 sm:px-8 ${className}`}
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
    >
      {children}
    </div>
  );
}

// ⚠️ 2026-08-29에 `Pen` 을 지웠다.
//
// 그 컴포넌트는 `landing-pen`(파란 펜 밑줄)을 `<span>` 에 씌우고 주석에
// "문장 안의 짧은 강조에만" 이라고 적어 두었다. **호출자는 0개였는데** 그 설명이
// 규칙을 반대로 가르쳤다.
//
// 이 랜딩에서 파란 펜 밑줄은 **"누를 수 있다"** 는 뜻 하나다. 정본 시안
// (`docs/landing/NotebookBest.html`)도 `.pen` 을 실제 링크 두 곳에만 썼고,
// `landingDesignSystem.test.ts` 의 "파란 펜 밑줄은 누를 수 있는 것에만 붙는다" 가
// 이를 고정한다.
//
// 실제로 같은 날 `CommunitySection` 의 카테고리 이름 다섯이 이 밑줄을 달고 링크가
// 아닌 채로 화면에 나가 있었다. 강조가 필요하면 굵기와 색으로 한다 — 밑줄을 다시
// 씌우는 헬퍼를 만들지 마라.

/** 빨간 펜 동그라미 — 페이지 전체에서 다섯 번을 넘기지 않는다. */
export function Circled({ children }: { children: ReactNode }) {
  return <span className="landing-circle landing-hand text-[1.05em]">{children}</span>;
}
