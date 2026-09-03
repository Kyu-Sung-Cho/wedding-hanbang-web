import Link from "next/link";

import { landingContent } from "./landingContent";
import { band, noteTextOnInk, sectionTitleOnInk, shell, TitleLines } from "./notebook";

/**
 * 하지 않는 것 넷.
 *
 * 정본 시안 `docs/landing/NotebookBest.html` 의 `#trust` 섹션이다.
 *
 * ## 이 섹션만은 부정문이 맞다
 *
 * 랜딩 전체에서 제목을 부정문으로 쓰지 않기로 했지만(2026-08-28), **여기는 예외다.**
 * 이 섹션의 내용 자체가 "안 하는 것" 이고, 그것이 신뢰의 근거다. 업체에 점수를
 * 안 매기고 계약을 해석하지 않는다는 것은 능력의 한계가 아니라 **선택**이며,
 * 그 선택이 우리가 업체 편이 아니라는 유일한 증거다.
 *
 * ## 필수 고지가 여기 산다
 *
 * 세 번째 항목("AI가 만든 답변임을 표시해요")이 AI 기본법 고지를 진다. 모델 이름까지
 * 적는다 — `/ai-policy` 가 같은 것을 공개하고 있어 두 곳이 어긋나면 안 된다.
 *
 * ## 2026-09-03: 다크 밴드
 *
 * 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)은 이 섹션과 마무리를 **한 덩어리
 * 어두운 띠**로 묶는다. 페이지에서 색이 뒤집히는 곳은 여기 한 번뿐이고, 그래서
 * "여기부터는 약속"이라는 것이 스크롤만으로 읽힌다.
 *
 * 두 섹션이 각자 자기 배경을 칠한다 — 사이에 여백이 생기면 띠가 두 조각으로 갈린다.
 * 그래서 아래쪽 `padding` 을 이 섹션에서 없애고 마무리가 이어받는다.
 */
export default function BoundariesSection() {
  const { boundaries } = landingContent;

  return (
    <section
      id="trust"
      className={`${band} bg-[var(--color-paper-ink)]`}
      aria-labelledby="trust-title"
    >
      <div className={shell}>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-16">
          <div>
            <h2 id="trust-title" className={sectionTitleOnInk}>
              <TitleLines value={boundaries.title} />
            </h2>
          </div>

          <div>
          {/* 시안은 항목 사이에 가는 선만 긋는다 — 첫 항목 위에는 선이 없다. */}
          <ul className="grid gap-0">
            {boundaries.items.map((item, index) => (
              <li
                key={item.title}
                className={
                  index === 0
                    ? "py-4"
                    : "border-t border-[var(--color-paper-on-ink-rule)] py-4"
                }
              >
                <p className="flex gap-3 text-[16px] font-medium text-[var(--color-paper-on-ink-soft)]">
                  {/* 체크 표시는 장식이다 — 스크린리더는 목록으로 읽으면 된다. */}
                  <span aria-hidden className="text-[var(--color-paper-on-ink-faint)]">
                    ✓
                  </span>
                  <span>{item.title}</span>
                </p>
                <p className={`mt-1.5 pl-[27px] ${noteTextOnInk}`}>
                  {item.note}
                </p>
              </li>
            ))}
          </ul>

            <p className="mt-4">
              <Link
                href={boundaries.policyLink.href}
                className="inline-flex min-h-11 items-center text-[14px] font-medium text-[var(--color-paper-on-ink-faint)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-on-ink)] motion-reduce:transition-none"
              >
                {boundaries.policyLink.label}
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
