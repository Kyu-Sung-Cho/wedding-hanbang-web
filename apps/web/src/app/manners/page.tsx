import type { Metadata } from "next";
import Link from "next/link";

import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { weddingLinkProps } from "@/lib/weddingPaths";

export const metadata: Metadata = {
  title: "결혼 예절 안내 — 웨딩한방",
  description:
    "첫인사, 상견례, 가족 지원, 축의금, 하객 매너처럼 결혼 전후에 자주 막히는 일을 실제로 할 수 있는 말과 함께 정리했어요.",
  // 정본 주소는 `/wedding/manners`다. `/manners`는 next.config의 리라이트 목록
  // (weddingAppRoutes)에 따라 여기로 리다이렉트되므로 canonical을 그쪽으로 두면
  // 색인이 리다이렉트 원본을 가리키게 된다.
  alternates: { canonical: "https://hanbang.ai/wedding/manners" },
};

const AUDIENCE_LABEL = {
  guest: "초대받은 분께",
  couple: "준비하는 두 분께",
  both: "모두에게",
} as const;

const QUICK_PATHS = [
  { label: "첫인사·상견례", slug: "family-meeting" },
  { label: "예단·함·폐백", slug: "gifts-and-traditions" },
  { label: "청첩장·하객", slug: "invitation-sending" },
  { label: "본식 당일", slug: "wedding-day" },
  { label: "축의·감사", slug: "gift-money" },
  { label: "혼인신고", slug: "marriage-registration" },
] as const;

const GUIDE_PRINCIPLES = [
  "두 사람이 먼저 합의하고, 각자 자기 가족과 소통해요.",
  "돈·역할·일정은 말로만 두지 말고 함께 확인할 수 있게 남겨요.",
  "예단·함·폐백·호칭 같은 관행은 의무가 아니라 선택이에요.",
  "법·계약·건강 정보는 이 글보다 연결된 공식 안내와 전문가 확인을 우선해요.",
] as const;

export default function MannersIndexPage() {
  const bySlug = new Map(MANNERS_PARTS.map((part) => [part.slug, part]));

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-9 sm:px-6 sm:py-12">
      <header>
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[#8F5150]">WEDDING MANNERS GUIDE</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-snug text-[#1b1c1c] sm:text-[36px]">
          결혼 예절 가이드
        </h1>
        <p className="mt-3 max-w-[620px] text-[14.5px] leading-[1.85] text-[#3d4a45]">
          첫인사, 상견례, 가족 지원, 축의금처럼 정답이 하나가 아닌 문제를 근거와 실제 대화문으로 정리했어요.
          여기서는 읽고 이해하고, 실제 준비는 웨딩 체크리스트에서 따로 관리합니다.
        </p>
        <section
          aria-labelledby="guide-summary-heading"
          className="mt-6 border-y border-[#c7d1c2] bg-[#f7faf5] px-4 py-5 sm:px-5"
        >
          <p className="text-[11.5px] font-semibold tracking-[0.12em] text-[#6d806e]">60초 요약</p>
          <h2 id="guide-summary-heading" className="mt-1.5 text-[18px] font-semibold leading-snug text-[#243832]">
            예절에는 하나의 정답이 없어요
          </h2>
          <p className="mt-2 text-[13.5px] leading-6 text-[#3d4a45]">
            전통은 선택으로, 가족 관행은 두 사람의 합의로, 법과 계약은 공식 근거로 확인하는 것이 이 가이드의 기준입니다.
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {GUIDE_PRINCIPLES.map((principle) => (
              <li key={principle} className="flex gap-2 text-[13px] leading-6 text-[#31423d]">
                <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d806e]" />
                <span>{principle}</span>
              </li>
            ))}
          </ul>
        </section>

        <nav aria-label="상황별 빠른 안내" className="mt-5">
          <p className="text-[12px] font-semibold tracking-wide text-[#36534e]">지금 필요한 것부터 보기</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {QUICK_PATHS.map((path) => (
              <Link
                key={path.slug}
                href={`/wedding/manners/${path.slug}`}
                prefetch={false}
                className="rounded-full border border-[#c7d1c2] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#36534e] transition-colors hover:border-[#6d806e] hover:bg-[#f7faf5]"
              >
                {path.label}
              </Link>
            ))}
          </div>
        </nav>
        <Link
          {...weddingLinkProps("/checklist")}
          className="mt-5 inline-flex rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541]"
        >
          웨딩 체크리스트 열기
        </Link>
        <p className="mt-4 rounded-xl border border-[#243832]/12 bg-[#243832]/[0.035] px-4 py-3 text-[13px] leading-[1.7] text-[#3d4a45]">
          여기 적힌 건 정답이 아니라 흔한 관행이에요. 지역·집안·모임마다 다르고, 수치가
          있는 내용에는 어디서 확인했는지와 확인한 날짜를 함께 적어 뒀어요.
        </p>
      </header>

      <div className="mt-10 space-y-9">
        {MANNERS_CATEGORIES.map((category) => {
          const parts = category.slugs
            .map((slug) => bySlug.get(slug))
            .filter((part): part is NonNullable<typeof part> => part !== undefined);
          if (parts.length === 0) return null;

          return (
            <section key={category.label}>
              <h2 className="text-[13px] font-semibold tracking-wide text-[#8F5150]">
                {category.label}
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {parts.map((part) => (
                  <li key={part.slug}>
                    <Link
                      href={`/wedding/manners/${part.slug}`}
                      prefetch={false}
                      className="block h-full rounded-2xl border border-[#243832]/12 bg-white/70 px-4 py-4 transition-colors hover:border-[#8F5150]/40"
                    >
                      <p className="text-[11.5px] font-semibold tracking-wide text-[#243832]/55">
                        {AUDIENCE_LABEL[part.audience]}
                      </p>
                      <p className="mt-1 text-[15.5px] font-semibold leading-snug text-[#243832]">
                        {part.title}
                      </p>
                      <p className="mt-1.5 text-[13px] leading-[1.65] text-[#3d4a45]/85">
                        {part.subtitle}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-12 text-[13px] leading-[1.75] text-[#3d4a45]/80">
        우리 상황에서는 어떻게 적용할지 막히면, 가족 구성과 고민을 아모라에게 그대로 말해 보세요.{" "}
        <Link {...weddingLinkProps("/chat")} className="font-medium text-[#8F5150] underline underline-offset-2">
          아모라에게 물어보기
        </Link>
      </p>
    </div>
  );
}
