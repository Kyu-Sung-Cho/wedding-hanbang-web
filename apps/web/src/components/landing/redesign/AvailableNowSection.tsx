import Link from "next/link";

import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, eyebrowText, noteText, sectionTitle, shell, TitleLines } from "./notebook";

/** 링크 목적을 보여 주는 장식 그림. 카드 순서를 바꿔도 목적과 그림이 함께 움직인다. */
function ToolIllustration({ href }: { href: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 90 64" fill="none" className="h-auto w-full">
      {href === "/wedding/community/quote-check" ? (
        <>
          <rect x="10" y="6" width="46" height="52" rx="4" fill="var(--color-paper-card)" stroke="var(--color-paper-edge)" strokeWidth="1.3" />
          <path d="M20 20h26M20 29h26M20 38h14" stroke="var(--color-paper-divider)" strokeWidth="1.8" strokeLinecap="round" />
          <circle cx="58" cy="43" r="13" fill="var(--color-ivory-50)" stroke="var(--color-rose-500)" strokeWidth="1.6" />
          <path d="m67.5 52.5 8.5 8.5" stroke="var(--color-rose-500)" strokeWidth="1.8" strokeLinecap="round" />
          <path d="m53 43 3.5 3.5L64 39" stroke="var(--color-rose-500)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : href === "/wedding-code" ? (
        <>
          <circle cx="34" cy="34" r="19" fill="var(--color-rose-pale)" stroke="var(--color-rose-light)" strokeWidth="1.4" />
          <circle cx="56" cy="34" r="19" stroke="var(--color-sage-500)" strokeWidth="1.4" />
          <path d="M45 20a19 19 0 0 0 0 28" stroke="var(--color-rose-500)" strokeWidth="1.4" strokeDasharray="3 3" />
        </>
      ) : href === "/price" ? (
        <>
          <path d="M12 30 34 8h26a5 5 0 0 1 5 5v26a5 5 0 0 1-5 5H34L12 22Z" fill="var(--color-paper-card)" stroke="var(--color-paper-edge)" strokeWidth="1.3" />
          <circle cx="54" cy="20" r="4" fill="var(--color-rose-pale)" stroke="var(--color-rose-light)" strokeWidth="1.3" />
          <path d="M30 52h44M38 58h28" stroke="var(--color-paper-divider)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : (
        <>
          <rect x="14" y="12" width="58" height="40" rx="4" fill="var(--color-paper-card)" stroke="var(--color-paper-edge)" strokeWidth="1.3" />
          <path d="m14 16 29 20 29-20" stroke="var(--color-paper-edge)" strokeWidth="1.3" strokeLinejoin="round" />
          <g transform="translate(43 33) scale(.62)">
            {[0, 72, 144, 216, 288].map((rotation) => (
              <ellipse key={rotation} cx="0" cy="-10" rx="5.4" ry="9" transform={`rotate(${rotation})`} fill="var(--color-rose-pale)" stroke="var(--color-rose-light)" strokeWidth="1.6" />
            ))}
            <circle r="3.4" fill="var(--color-rose-light)" stroke="var(--color-rose-500)" strokeWidth="1.6" />
          </g>
        </>
      )}
    </svg>
  );
}

/** 기능별 한계와 개인정보 고지는 카드 안에 남겨 링크와 함께 읽히게 한다. */
export default function AvailableNowSection() {
  const { availableNow } = landingContent;

  return (
    <section
      id="now"
      className={`${band} border-t border-[var(--color-paper-edge)] bg-[var(--color-ivory-warm)] !pb-0`}
      aria-labelledby="now-title"
    >
      <div className={shell}>
        <p className="mb-[10px] lg:mb-3 lg:text-center">
          <span className={eyebrowText}>{availableNow.eyebrow}</span>
        </p>

        <h2 id="now-title" className={`${sectionTitle} lg:text-center`}>
          <TitleLines value={availableNow.title} mobileLastWord />
        </h2>

        <div className="mt-[22px] grid gap-[10px] lg:mt-[46px] lg:grid-cols-4 lg:gap-[18px]">
          {availableNow.cards.map((card) => (
            <TrackedLandingLink
              key={card.no}
              source={card.href === "/wedding-code" ? "landing_now_wedding_code" : "landing_now_card"}
              href={card.href}
              className="flex min-h-11 items-center gap-[14px] rounded-[14px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] px-[18px] py-4 transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:block lg:rounded-[16px] lg:px-[22px] lg:py-[26px]"
            >
              <span className="block w-16 shrink-0 lg:mb-4 lg:w-[90px]">
                <ToolIllustration href={card.href} />
              </span>
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold leading-[1.45] text-[var(--color-paper-ink)] lg:text-[15.5px]">
                  {card.title}
                </span>
                <span className="mt-[5px] block text-[12.5px] leading-[1.65] text-[var(--color-paper-ink-soft)] lg:mt-2 lg:text-[13px]">
                  {card.body}
                </span>
                <span className={`mt-[10px] block lg:mt-4 ${noteText}`}>{card.note}</span>
              </span>
            </TrackedLandingLink>
          ))}
        </div>

        <p className={`mt-4 lg:mt-[22px] ${noteText}`}>
          {availableNow.footLead}
          {availableNow.footLinks.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? "과 " : ""}
              <Link
                href={link.href}
                className="landing-pen font-medium text-[var(--color-paper-ink)] focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2"
              >
                {link.label}
              </Link>
              {/* ⚠️ 여기 `{index === 0 ? " " : ""}` 가 있었다. 링크 뒤에 공백을 넣으면
                  다음 조각 "과 " 가 앞말에서 떨어져 **"원문 과 커뮤니티 도"** 로 나갔다
                  (2026-08-29 라이브 실측). 한국어 조사는 앞말에 붙는다 — 조각을 이어
                  붙이는 자리에서는 조사 쪽에 공백을 두지 않는다. */}
            </span>
          ))}
          {availableNow.footTail}
        </p>
      </div>
    </section>
  );
}
