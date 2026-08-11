import type { Metadata } from "next";
import Link from "next/link";

import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";

export const metadata: Metadata = {
  title: "결혼 예절 안내 — 웨딩한방",
  description:
    "축의금, 하객 매너, 축사처럼 결혼식에서 자주 헷갈리는 것들을 실제로 할 수 있는 말과 함께 정리했어요. 지역·모임마다 다를 수 있는 관행이라는 점을 함께 적었습니다.",
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
    <div className="mx-auto w-full max-w-[900px] px-4 py-9 sm:px-6 sm:py-12">
      <header>
        <h1 className="font-serif-kr text-[28px] font-normal leading-snug text-[#1b1c1c] sm:text-[34px]">
          결혼 예절, 헷갈리는 것만 모았어요
        </h1>
        <p className="mt-3 max-w-[620px] text-[14.5px] leading-[1.85] text-[#3d4a45]">
          축의금은 얼마가 흔한지, 하객으로 갈 때 뭘 조심하면 되는지, 축사에서 무슨 말을
          피해야 하는지. 실제로 할 수 있는 말과 함께 적었어요.
        </p>
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
        우리 상황에서는 어떻게 하면 좋을지 막히면, 아모라에게 그대로 말해 보세요.{" "}
        <Link href="/demo" prefetch={false} className="font-medium text-[#8F5150] underline underline-offset-2">
          아모라 체험하기
        </Link>
      </p>
    </div>
  );
}
