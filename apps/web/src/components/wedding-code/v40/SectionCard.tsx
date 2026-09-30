"use client";

import { useEffect, useId, type ReactNode } from "react";
import { card, cx } from "./styles";

/**
 * 시작과 질문 흐름 화면(시작, 받는 사람, 질문, 쉬는 카드, 마지막 정리, 안내 화면)이 함께 쓰는 틀.
 *
 * 이 파일의 SectionCard 는 「구간 이름 카드」라는 쪽이 아니다. 설계는 구간 이름 카드를 두지 않는다(구간 이름은 진행 막대와 쉬는 카드에만 붙는다,
 * README 7절 7번). 여기서는 제목이 붙은 상자 하나, 곧 이전 웨딩코드 카드, 하던 답 카드, 초대 링크 충돌 카드, 쉬는 카드 같은
 * 안내 상자가 같은 모양을 쓰게 하는 바탕이다.
 *
 * 색은 역할 변수만 쓰고 뜻은 글과 모양이 전한다. 문구는 이 파일에 없다(제목과 본문은 호출자가 copy.ts 에서 가져와 넘긴다).
 */

/**
 * 화면 뿌리의 폭과 안쪽 여백. 좁은 화면(320에서 430)에서 양옆 16픽셀을 두고, 넓은 화면에서는 읽기 좋은 폭에서 멈춘다.
 * 화면이 바뀔 때 초점을 받는 뿌리라서 초점 윤곽선은 없앤다(초점 자체는 낭독기가 화면 이름을 읽게 하려는 것이다).
 * 한국어 문장이 낱말 가운데서 줄이 바뀌지 않도록 낱말 단위 줄바꿈을 뿌리에서 물려준다(전역 규칙이 아주 긴 낱말은 그래도 자른다).
 */
export function screenRootClass(embedded: boolean): string {
  return cx(
    "mx-auto w-full max-w-[560px] scroll-mt-20 break-keep px-4 pt-5 outline-none sm:px-6 md:scroll-mt-28",
    // 라운지(embedded) 안에서는 하단 탭 뒤로 끝 줄이 숨지 않게 아래 여백을 더 둔다.
    embedded ? "pb-10" : "pb-6",
  );
}

/**
 * 글이 몇 줄뿐인 카드(쉬는 카드, 마지막 정리 카드)의 뿌리. 글이 짧으면 단추 줄이 글 바로 밑에 떠서, 질문 화면에서 다음 단추가 늘 있던 화면 아래 자리에서
 * 벗어나 엄지가 닿는 자리를 놓친다. 뿌리를 화면 높이만큼 세로로 늘려 단추 줄 앞의 빈틈(PinBarSpacer)이 남는 높이를 먹게 하면 단추 줄이 화면 아래에 붙는다.
 * 글이 화면보다 길면 아무 일도 없다(빈틈은 0). 라운지 안(embedded)은 바깥 화면이 높이를 정하므로 그대로 둔다.
 */
export function pinnedScreenRootClass(embedded: boolean): string {
  return cx(screenRootClass(embedded), !embedded && "flex min-h-dvh flex-col");
}

/** pinnedScreenRootClass 뿌리 안에서 단추 줄 바로 앞에 놓아 남는 높이를 먹는 빈틈. 라운지 안에서는 그리지 않는다. */
export function PinBarSpacer({ embedded }: { readonly embedded: boolean }) {
  return embedded ? null : <div aria-hidden="true" data-pin-bar-spacer="" className="flex-1" />;
}

export interface SectionCardProps {
  readonly title: string;
  readonly children: ReactNode;
  /** 제목의 수준. 기본 2. */
  readonly level?: 1 | 2 | 3;
  readonly className?: string;
  readonly id?: string;
  /** 시험과 화면 빌더가 카드를 찾는 표시(예: legacy, resume). */
  readonly dataCard?: string;
}

/** 제목이 붙은 안내 상자. 영역(region)이 되어 제목이 이름이다. */
export function SectionCard({ title, children, level = 2, className, id, dataCard }: SectionCardProps) {
  const autoId = useId();
  const headingId = `${id ?? autoId}-title`;
  const Heading = level === 1 ? "h1" : level === 3 ? "h3" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      data-section-card={dataCard ?? ""}
      className={cx(card, "p-4 sm:p-5", className)}
    >
      <Heading id={headingId} className="text-base font-semibold leading-snug text-[var(--hb-text-strong)]">
        {title}
      </Heading>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-[var(--hb-text-body)]">{children}</div>
    </section>
  );
}

/**
 * 단추 줄이 화면 아래를 덮는 높이만큼 문서에 아래쪽 스크롤 여백을 둔다. 키보드 초점이 아래쪽 컨트롤로 가면 브라우저는 그 컨트롤을
 * 화면 아래 끝에 맞춰 스크롤하는데, 여백이 없으면 붙어 있는 단추 줄 밑에 컨트롤이 깔려 초점을 받고도 보이지 않는다(WCAG 2.2 초점이 가려지지 않음).
 * 문항 틀에 준 아래쪽 스크롤 여백은 초점을 받는 컨트롤이 아니라 그 바깥 틀의 값이라 초점 이동에는 듣지 않는다. 그래서 스크롤하는 쪽(문서)에 준다.
 * 단추 줄 높이는 320 폭에서 69픽셀 안팎(4.3rem)이다. 그 위로 초점 링과 숨 쉴 틈을 더해 7rem, 라운지(embedded) 모바일은 하단 탭(75픽셀)이 더 덮어 12rem.
 */
const STICKY_BAR_SCROLL_PADDING = "calc(7rem + env(safe-area-inset-bottom))";
const STICKY_BAR_SCROLL_PADDING_EMBEDDED = "calc(12rem + env(safe-area-inset-bottom))";

export interface ActionBarProps {
  readonly children: ReactNode;
  /** 라운지(앱 셸) 안이면 모바일에서 하단 탭 위에 붙인다. */
  readonly embedded?: boolean;
}

/**
 * 화면 아래에 붙는 단추 줄. 글이 길어도 단추가 첫 화면 밖으로 밀리지 않는다.
 * 앱 셸 안(embedded)의 모바일에서는 하단 탭 높이(74픽셀)와 안전 영역만큼 위로 띄워 탭이 단추를 덮지 않게 한다.
 * 그 밖에는 화면 맨 아래에 붙고 안전 영역만큼 안쪽 여백을 둔다.
 */
export function ActionBar({ children, embedded = false }: ActionBarProps) {
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollPaddingBottom;
    root.style.scrollPaddingBottom = embedded ? STICKY_BAR_SCROLL_PADDING_EMBEDDED : STICKY_BAR_SCROLL_PADDING;
    // 이 단추 줄이 사라지면(화면이 바뀌면) 원래 값으로 돌린다. 한 번에 바뀔 때는 옛 화면의 정리가 새 화면의 설정보다 먼저 돈다.
    return () => {
      root.style.scrollPaddingBottom = previous;
    };
  }, [embedded]);
  return (
    <div
      data-action-bar=""
      data-embedded={embedded ? "" : undefined}
      className={cx(
        "sticky z-10 mt-6 border-t border-[var(--hb-hairline)] pt-3",
        // 단추 줄 바탕은 그 뒤 화면 바탕과 같은 색이어야 한다(다르면 짧은 화면 아래에 띠가 생긴다): 독립 페이지는 body 바탕, 라운지 안은 앱 셸의 페이지 바탕.
        embedded
          ? "bottom-0 bg-[var(--hb-surface-page)] pb-3 max-md:bottom-[calc(75px+env(safe-area-inset-bottom))]"
          : "bottom-0 bg-[var(--ivory-50)] pb-[max(0.75rem,env(safe-area-inset-bottom))]",
      )}
    >
      {children}
    </div>
  );
}
