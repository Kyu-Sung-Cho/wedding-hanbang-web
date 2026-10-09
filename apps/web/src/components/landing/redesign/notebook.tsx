import type { ReactNode } from "react";

/**
 * 랜딩의 공통 배치·글자 크기. 색·서체는 globals.css의 landing-root 범위에 있다.
 * 2026-09-06 사용자 제공 Main.dc.html·LandingMobile.dc.html 기준이다.
 */

/**
 * 데스크톱 내용 폭 1200px + 양쪽 32px. 모바일은 양쪽 18px.
 */
export const shell = "mx-auto w-full max-w-[1264px] px-[18px] sm:px-8";

/** 모바일 44px, 데스크톱 92px. 연결되는 구역은 해당 섹션에서 여백을 줄인다. */
export const band = "py-11 lg:py-[92px]";

/**
 * 끝의 경계·마무리는 같은 어두운 띠다. 바깥 여백만 나누고 가운데는 선으로 연결한다.
 */
export const bandTop = "pt-11 lg:pt-[92px]";
export const bandBottom = "pb-12 lg:pb-24";

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
 * 섹션 제목은 모바일 24px·데스크톱 36px, 고운돋움 400을 사용한다.
 */
const sectionTitleShape =
  "landing-display text-[24px] leading-[1.48] lg:text-[36px] lg:leading-[1.42]";

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
export function TitleLines({ value, mobileLastWord = false }: { value: string; mobileLastWord?: boolean }) {
  // HTML 모바일 시안의 마지막 어절 줄바꿈. 데스크톱은 원래 한 문장으로 읽힌다.
  const lastSpace = value.lastIndexOf(" ");
  if (mobileLastWord && lastSpace > 0) {
    return <>{value.slice(0, lastSpace)}{" "}<span className="block lg:inline">{value.slice(lastSpace + 1)}</span></>;
  }
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
  "landing-display text-[16.5px] leading-[1.6] lg:text-[19px] lg:leading-[1.62]";

export const bodyText =
  "text-[14px] leading-[1.76] text-[var(--color-paper-ink-soft)] lg:text-[16px] lg:leading-[1.78]";

export const noteText = "text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)] lg:text-[13px] lg:leading-[1.65] lg:text-[var(--color-paper-ink-faint)]";

/**
 * 섹션 눈썹 — **한 격식.**
 *
 * 2026-09-03 시안은 섹션마다 갈려 있던 눈썹을 하나로 모았다. 이전에는 두 격식이었다:
 * `<Section>` 은 노란 테이프 이름표, 자기 `<section>` 을 여는 섹션은 손글씨 19px.
 * 시안은 전부 **12px 굵은 산세리프, 흐린 로즈브라운**이다.
 *
 * 작은 글씨의 대비를 위해 기존 `--color-rose-700`을 쓴다.
 * 자간은 0이다: 한글에 라틴 자간을 주면 글자가 흩어진다
 * (`koreanLabelsHaveNoLatinTracking.test.ts`).
 *
 * 테이프 이름표는 히어로 한 장에만 남는다. 페이지에 이름표가 여럿이면 무엇이 제목인지
 * 흐려진다 — 그래서 시안이 하나로 줄인 것이다.
 */
export const eyebrowText = "text-[12px] font-semibold text-[var(--color-rose-700)] lg:text-[13px]";

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
