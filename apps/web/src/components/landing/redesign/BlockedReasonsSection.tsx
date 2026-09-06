import { landingContent } from "./landingContent";
import { band, eyebrowText, noteText, quoteText, sectionTitle, shell } from "./notebook";

/**
 * ② 결혼 준비가 자꾸 막히는 이유.
 *
 * 2026-09-03 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)에서 새로 생긴 섹션이다.
 * 히어로가 "둘의 기준"을 말한 직후, 그 기준이 없을 때 실제로 무슨 생각이 드는지를
 * **커플의 말로** 보여 준다. 설명이 아니라 인용이라 처음 온 사람이 자기 문장을 알아본다.
 *
 * ## 왜 눈썹이 테이프가 아닌가
 *
 * 시안의 섹션 눈썹은 12px 굵은 산세리프에 흐린 로즈브라운이다(픽셀 실측 #896765 ≈
 * `--color-rose-600`). 테이프 이름표는 히어로 한 장에만 남는다 — 페이지에 이름표가
 * 여럿이면 무엇이 제목인지가 흐려진다.
 */
export default function BlockedReasonsSection() {
  const { blockedReasons } = landingContent;

  return (
    <section
      id="reasons"
      className={`${band} bg-[var(--color-paper-tint)]`}
      aria-labelledby="reasons-title"
    >
      <div className={shell}>
        <p className="mb-[10px] lg:mb-3">
          <span className={eyebrowText}>
            {blockedReasons.eyebrow}
          </span>
        </p>

        <h2 id="reasons-title" className={sectionTitle}>
          {blockedReasons.title.split("\n").map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>

        <ul className="mt-6 grid gap-[10px] lg:mt-[46px] lg:grid-cols-3 lg:gap-5">
          {blockedReasons.quotes.map((quote) => (
            <li
              key={quote}
              className="rounded-[14px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-5 lg:rounded-[16px] lg:px-7 lg:py-[30px]"
            >
              {/* 여는 따옴표는 장식이 아니라 "이건 우리가 아니라 커플이 한 말" 이라는
                  표시다. 그래서 로즈로 칠하고 본문과 분리해 둔다. */}
              <p aria-hidden className="landing-display text-[26px] leading-none text-[var(--color-rose-light)] lg:text-[34px]">
                “
              </p>
              <p className={`mt-2 lg:mt-[10px] ${quoteText} text-[var(--color-paper-ink)]`}>
                {quote.split("\n").map((line) => (
                  <span key={line} className="lg:block">
                    {line}{" "}
                  </span>
                ))}
              </p>
            </li>
          ))}
        </ul>

        <p className={`mt-5 max-w-[660px] lg:mt-[34px] ${noteText}`}>
          {blockedReasons.noteLead}
          <strong className="font-semibold text-[var(--color-paper-ink-soft)]">
            {blockedReasons.noteMark}
          </strong>
          {blockedReasons.noteTail}
        </p>
      </div>
    </section>
  );
}
