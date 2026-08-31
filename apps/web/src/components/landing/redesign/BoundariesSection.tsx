import Link from "next/link";

import { landingContent } from "./landingContent";
import { band, noteText, sectionTitle, shell } from "./notebook";

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
 */
export default function BoundariesSection() {
  const { boundaries } = landingContent;

  return (
    <section
      id="trust"
      className={`${band} bg-[var(--color-paper-tint)]`}
      aria-labelledby="trust-title"
    >
      <div className={shell}>
        <p className="mb-4">
          <span className="landing-hand text-[19px] text-[var(--color-paper-mark)]">
            {boundaries.eyebrow}
          </span>
        </p>

        <h2 id="trust-title" className={sectionTitle}>
          {boundaries.title}
        </h2>

        <div className="mt-10 grid gap-x-12 gap-y-8 sm:grid-cols-2">
          {boundaries.items.map((item) => (
            <div
              key={item.title}
              className="border-t border-[var(--color-paper-edge)] pt-5"
            >
              <p className="text-[16px] font-semibold text-[var(--color-paper-ink)]">
                {item.title}
              </p>
              <p className={`mt-2 ${noteText}`}>{item.note}</p>
            </div>
          ))}
        </div>

        <p className="mt-9">
          <Link
            href={boundaries.policyLink.href}
            className="landing-pen inline-flex min-h-11 items-center text-[16px] font-medium text-[var(--color-paper-ink)]"
          >
            {boundaries.policyLink.label}
          </Link>
        </p>
      </div>
    </section>
  );
}
