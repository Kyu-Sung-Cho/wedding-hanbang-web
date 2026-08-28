import Link from "next/link";

import { BloomGarland } from "./LandingBloom";
import { landingContent } from "./landingContent";
import { bodyText, noteText, sectionTitle, shell } from "./notebook";

/**
 * 마무리.
 *
 * 첫 화면과 **같은 행동**을 부른다 — 스무 장면. 다른 걸 부르면 페이지 전체가
 * 무엇을 시키려는 건지 흐려진다.
 *
 * 가입을 여기서 요구하지 않는다. 우리 후크는 로그인 없이 만져지는 것이고,
 * 가입은 그다음에 해도 늦지 않는다.
 *
 * 바탕은 흰 종이다. 바로 위 섹션이 tint 라 같은 색을 쓰면 경계가 사라진다
 * (실측으로 확인했다 — 8·9번 섹션이 둘 다 rgb(248,244,234) 였다).
 * 흰 종이를 써서 마지막에 새 장을 편 것처럼 만든다.
 */
export default function ClosingAction() {
  const { closing } = landingContent;

  return (
    <section
      className="relative overflow-hidden border-t border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] py-20 sm:py-28"
      aria-labelledby="closing-title"
    >
      <BloomGarland className="pointer-events-none absolute inset-x-0 top-0 h-[150px] w-full opacity-50" />
      <div className={`${shell} relative text-center`}>
        <h2 id="closing-title" className={sectionTitle}>
          {closing.title}
        </h2>
        <p className={`mx-auto mt-5 max-w-[42ch] ${bodyText}`}>
          {closing.body}
        </p>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href={closing.primary.href}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-8 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none sm:w-auto"
          >
            {closing.primary.label}
          </Link>
          <Link
            href={closing.secondary.href}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-8 text-[16px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] hover:text-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none sm:w-auto"
          >
            {closing.secondary.label}
          </Link>
        </div>

        <Link
          href={closing.tertiary.href}
          className={`mt-5 inline-flex min-h-11 items-center text-[14px] font-semibold text-[var(--color-paper-pen)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none`}
        >
          {closing.tertiary.label}
        </Link>

        <p className={`mx-auto mt-7 max-w-[52ch] ${noteText}`}>{closing.note}</p>
      </div>
    </section>
  );
}
