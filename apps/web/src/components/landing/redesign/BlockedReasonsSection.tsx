import { landingContent } from "./landingContent";
import { band, eyebrowText, noteText, quoteText, sectionTitle, shell } from "./notebook";

/** 승인된 질문 카드 배치를 유지한다. 인용은 고객 후기가 아닌 질문 예시다. */
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
              {/* 질문 예시를 구분하는 인용 부호이며 실제 고객 후기를 뜻하지 않는다. */}
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
