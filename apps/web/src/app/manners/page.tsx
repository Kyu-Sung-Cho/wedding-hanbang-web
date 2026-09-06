import type { Metadata } from "next";
import Link from "next/link";

import { readingMinutesOf } from "@/lib/manners/readingTime";
import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { weddingLinkProps } from "@/lib/weddingPaths";
import MannersMobileHeader from "@/components/manners/MannersMobileHeader";

export const metadata: Metadata = {
  title: "결혼 예절 안내 — 웨딩한방",
  description:
    "첫인사·상견례·예단·청첩장·본식 당일·폐백·축의금부터 결혼 뒤 첫 명절과 호칭까지, 준비 순서대로 25편에 정리했어요. 지역·집안마다 다를 수 있는 관행이라는 점을 함께 적었습니다.",
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

export default function MannersIndexPage() {
  const bySlug = new Map(MANNERS_PARTS.map((part) => [part.slug, part]));

  return (
    <>
    <MannersMobileHeader index />
    <div className="mx-auto w-full max-w-[1220px] px-[18px] pb-14 pt-[22px] md:px-9 xl:px-16 xl:pt-[30px]">
      <header>
        <p className="text-[12px] font-semibold text-[var(--amora-rose-deep)]">준비 순서대로 읽는 {MANNERS_PARTS.length}편의 안내</p>
        <h1 className="planning-display mt-2 text-[26px] leading-[1.35] text-[var(--amora-ink)] sm:text-[32px]">
          결혼 예절 가이드
        </h1>
        <p className="mt-3 max-w-[760px] text-[13px] leading-[1.7] text-[var(--amora-soft)] sm:text-[14px]">
          첫인사와 상견례부터 축의금·본식 당일, 결혼 뒤 첫 명절과 호칭까지 준비 순서대로
          정리했어요. 여기서는 읽고 이해하고, 실제 준비는 웨딩 체크리스트에서 따로 관리합니다.
        </p>
        <Link
          {...weddingLinkProps("/checklist")}
          className="mt-4 inline-flex min-h-11 items-center rounded-[11px] bg-[var(--amora-ink)] px-4 py-2.5 text-[13px] font-semibold text-white"
        >
          웨딩 체크리스트 열기
        </Link>
        {/*
          이 고지는 10편 시절 "수치에는 출처와 확인 날짜를 적어 뒀다"고 단정했다. 2026-08-19에
          레거시 15편을 같은 목록으로 옮기면서 그 문장이 거짓이 됐다 — 지금 25편 중 15편은
          출처가 0건이고, 표 32개 중 22개가 출처 없음이다. 이 코퍼스가 2026-07-17에 지워진
          사유가 정확히 "수치에 출처 0건"이었으므로, 문구를 실제 상태에 맞춘다.
          각 편 상단과 표마다 출처 유무가 다시 표시되므로 여기서는 갈린다는 사실만 말한다.
        */}
        <p className="mt-[18px] rounded-[12px] border border-[var(--amora-line)] bg-[var(--amora-warm)] p-3.5 text-[12.5px] leading-[1.65] text-[var(--amora-soft)] sm:rounded-[14px] sm:px-[18px] sm:py-4 sm:text-[13px]">
          여기 적힌 건 정답이 아니라 흔한 관행이에요. 지역·집안·모임마다 다릅니다. 공개된
          자료로 확인한 편에는 어디서 확인했는지와 확인한 날짜를 적어 뒀고, 아직 확인하지
          못한 편에는 각 글 위에 그렇게 표시해 뒀어요.
        </p>
      </header>

      <div className="mt-7 space-y-7 sm:mt-8 sm:space-y-8">
        {MANNERS_CATEGORIES.map((category) => {
          const parts = category.slugs
            .map((slug) => bySlug.get(slug))
            .filter((part): part is NonNullable<typeof part> => part !== undefined);
          if (parts.length === 0) return null;

          return (
            <section key={category.label}>
              <h2 className="text-[13px] font-semibold text-[var(--amora-rose-deep)]">
                {category.label}
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {parts.map((part) => (
                  <li key={part.slug}>
                    <Link
                      href={`/wedding/manners/${part.slug}`}
                      prefetch={false}
                      className="block h-full rounded-[16px] border border-[var(--amora-line)] bg-white px-[18px] py-5 transition-colors hover:border-[var(--amora-rose)] sm:rounded-[18px] sm:px-6 sm:py-6"
                    >
                      <p className="text-[11.5px] font-semibold text-[var(--hb-text-muted)]">
                        {AUDIENCE_LABEL[part.audience]}
                      </p>
                      <h3 className="mt-1 text-[15.5px] font-semibold leading-snug text-[var(--amora-ink)] sm:text-[18px]">
                        {part.title}
                      </h3>
                      <p className="mt-1.5 text-[13px] leading-[1.65] text-[var(--amora-soft)]">
                        {part.subtitle}
                      </p>
                      {/*
                        분량을 **문 앞에서** 알려준다. 예전에는 카드에 오디언스·제목·부제뿐이라
                        3분짜리와 18분짜리가 똑같이 생겼고, 사람은 모르고 들어갔다가 나왔다.
                        본문과 같은 함수를 쓴다 — 두 화면이 다른 숫자를 말하면 안 된다.
                      */}
                      <p className="mt-2 text-[12px] text-[var(--hb-text-muted)]">
                        {readingMinutesOf(part.sections)}분 · {part.sections.length}개 절
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <p className="mt-9 text-[13px] leading-[1.75] text-[var(--amora-muted)]">
        우리 상황에서는 어떻게 적용할지 막히면, 가족 구성과 고민을 아모라에게 그대로 말해 보세요.{" "}
        <Link {...weddingLinkProps("/chat")} className="font-medium text-[var(--amora-accent)] underline underline-offset-2">
          아모라에게 물어보기
        </Link>
      </p>
    </div>
    </>
  );
}
