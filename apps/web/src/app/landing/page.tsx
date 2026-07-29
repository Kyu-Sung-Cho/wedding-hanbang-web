import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cache } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  Bell,
  CalendarCheck,
  Coins,
  ScrollText,
  Search,
  Users,
  Wallet,
} from "lucide-react";

import { formatKrwManwon } from "@/lib/price/agencySpread";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { loadLandingAgencySpread } from "@/lib/price/landingAgencySpread";
import { disclosureRoundLabel } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";
import { weddingPath } from "@/lib/weddingPaths";

/**
 * 웨딩한방을 처음 보는 사람에게 **서비스 전체**를 설명하는 페이지.
 *
 * 이 자리에 있던 이전 랜딩은 2026-06-11 대수술 이전 화면이었다. 아모라 이야기만 있고
 * 이 서비스가 유일하게 가진 공시가·위약금은 한 번도 나오지 않았으며, 그 뒤 삭제된
 * 기능을 현재형으로 약속하고 있어 미링크로 봉인돼 있었다 — 결과적으로 **첫 방문자에게
 * 서비스를 설명하는 화면이 아예 없었다.**
 *
 * ## 시각 판단은 DESIGN.md를 따른다
 *
 * 이 페이지는 앱이 아니라 **마케팅 표면**이다. DESIGN.md의 Layout 규칙이
 * "Marketing: Editorial composition, emotional first viewport, richer imagery"라고
 * 따로 적어 둔 자리다. 그래서 첫 화면은 숫자 카드를 늘어놓지 않는다 — 사진과 문장
 * 하나로 먼저 걸고, 증거(공시 수치)는 바로 다음 띠에서 크게 말한다.
 *
 * 색·타입·라운드는 전부 DESIGN.md 값만 쓴다. Eucalyptus Ink(#243832·#36534E)로
 * 신뢰 구간을, Dusty Mauve(#A77B74)로 주 행동을, Pearl Ivory(#FBF8F2·#F7F1E8)로
 * 바탕을 만든다. Champagne Taupe(#B89785·#E2D3C8)는 드문 하이라이트에만 쓴다
 * ("not primary buttons everywhere"). 폰트는 Paperlogy 하나이고 굵기·크기로만
 * 위계를 만든다. 카드 안에 카드를 넣지 않는다.
 *
 * ## 문구 규칙 (PRINCIPLES.md P1·P5)
 *
 *  - **없는 기능을 쓰지 않는다.** 여기 적힌 것은 전부 지금 라우트가 존재한다.
 *  - **숫자는 살아 있는 값을 쓴다.** 공시 규모와 대행사 간 차이는 렌더 시점에
 *    공시 카탈로그에서 계산한다. 손으로 적으면 분기 갱신 때 어긋난다.
 *  - **사용자 수·후기 수를 말하지 않는다.** 실사용자가 사실상 0명이라 어떤 숫자를
 *    적어도 허수가 된다. 과거 랜딩의 "후기 120만+"이 그 사고였다.
 *  - **판정하지 않는다.** 어느 업체가 낫다·안전하다는 문장을 만들지 않는다.
 *  - **한계를 눈에 띄는 자리에 먼저 적는다.** 들어와서 스스로 알아채면 그때는
 *    "숨겼다"가 되고, 그건 이 서비스가 파는 것과 정확히 반대다.
 */

export const revalidate = 86_400;

/**
 * 위약금·환불 원문 규모. 분기 공시 갱신 때 함께 바뀐다.
 * 갱신 확인: `pnpm audit:production` (=== 1-c. 공시 규모 표기 ===)
 * 네 표면(첫 화면·공시 허브·이 랜딩·감사)의 값 일치는
 * `scripts/tests/disclosure-count-consistency.test.mjs`가 강제한다.
 */
const PUBLISHED_POLICY_COUNT = 831;
const PUBLISHED_VENDOR_COUNT = 412;

const loadCatalogCounts = cache(() => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
  ))
));

export async function generateMetadata(): Promise<Metadata> {
  const title = "웨딩한방 — 공시된 가격·위약금 원문과 AI 웨딩 플래너 아모라";
  const description =
    "업체가 공시한 스드메·예식장 기본가와 추가금, 취소 위약금 규정을 원문 그대로 봅니다. "
    + "예산·일정·업체 준비는 AI 아모라가 같이 잡습니다. 요약도, 어디가 낫다는 판정도 하지 않습니다.";
  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    openGraph: { title, description, url: "/landing", type: "website" },
  };
}

const shell = "mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10";

export default async function LandingPage() {
  const [catalog, spread] = await Promise.all([
    loadCatalogCounts(),
    loadLandingAgencySpread(),
  ]);
  const vendorCards = PRICE_CATEGORIES.reduce(
    (sum, category) => sum + (catalog.counts[category] ?? 0),
    0,
  );

  return (
    <div className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      <SiteHeader />
      <Hero />
      <ProofBand vendorCards={vendorCards} spread={spread} />
      <WhyWeExist />
      <ThreeAxes vendorCards={vendorCards} counts={catalog.counts} />
      <AmoraSection />
      <WhatWeRefuse />
      <HonestScope />
      <ClosingCta />
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const navItems = [
    { label: "공시가·위약금", href: "/price" },
    { label: "서비스 소개", href: "#what-we-do" },
    { label: "커뮤니티", href: weddingPath() },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[#243832]/8 bg-[#FBF8F2]/90 backdrop-blur">
      <div className={`${shell} flex h-16 items-center justify-between gap-6`}>
        <Link href="/landing" className="text-[20px] font-semibold tracking-[-0.02em] text-[#243832]">
          웨딩한방
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[14px] font-medium text-[#36534E]/75 transition-colors hover:text-[#243832]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/price"
          className="inline-flex min-h-10 items-center rounded-full bg-[#A77B74] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#8F6662]"
        >
          공시가 보기
        </Link>
      </div>
    </header>
  );
}

/**
 * 감정이 먼저 오는 첫 화면(DESIGN.md: "emotional first viewport, richer imagery").
 * 숫자는 여기 두지 않는다 — 바로 아래 증거 띠가 통째로 맡는다.
 */
function Hero() {
  return (
    <section className={`${shell} pb-14 pt-12 md:pb-20 md:pt-20`}>
      <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div className="animate-fade-in min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#B89785]">
            Wedding Hanbang
          </p>
          <h1 className="mt-6 text-[36px] font-medium leading-[1.24] tracking-[-0.03em] text-[#243832] md:text-[48px]">
            웨딩의 &lsquo;웨&rsquo;자를 몰라도,
            <br />
            <span className="text-[#36534E]">추가금에 안 당하고,</span>
            <br />
            결혼식까지.
          </h1>
          <p className="mt-7 max-w-lg text-[16px] font-normal leading-[1.8] text-[#36534E]/80">
            웨딩 시장은 플래너와 업체가 정하는 대로 따라가게 설계돼 있습니다.
            웨딩한방은 업체가 공시한 가격과 위약금을 원문 그대로 펼쳐 두고,
            예산·일정·업체 정리는 AI 웨딩 플래너 아모라가 옆에서 같이 합니다.
          </p>

          <div className="mt-9 flex flex-col gap-4 sm:flex-row sm:items-center">
            <Link
              href="/price"
              className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-[#A77B74] px-8 text-[16px] font-semibold text-white transition-colors duration-200 hover:bg-[#8F6662]"
            >
              공시가·위약금 보기
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <Link
              href={weddingPath("/chat")}
              className="group inline-flex min-h-[52px] items-center gap-1.5 text-[16px] font-semibold text-[#36534E] transition-colors hover:text-[#243832]"
            >
              아모라와 시작하기
              <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <p className="mt-5 text-[12px] font-medium leading-[1.7] text-[#36534E]/55">
            공시가·위약금·커뮤니티는 로그인 없이 볼 수 있어요. 아모라는 내 예식일과
            준비 상황을 바탕으로 답해야 해서 로그인이 필요하고, 무료예요.
          </p>
        </div>

        {/* 사진을 배경 워시로 깔지 않고 한 장으로 세운다. 마케팅 표면에서 이미지는
            분위기 장치가 아니라 첫인상 그 자체다. */}
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[28px] bg-[#F7F1E8] sm:aspect-[16/11] lg:aspect-[4/5]">
          <Image
            src="/images/amora-hero-bouquet-custom.webp"
            alt="결혼 준비를 시작하는 예비부부의 부케"
            fill
            priority
            sizes="(min-width: 1024px) 520px, 100vw"
            className="object-cover"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * 증거 띠. Eucalyptus Ink 위에 큰 숫자만 놓는다 — 상자를 겹치지 않는다
 * (DESIGN.md: 카드 안에 카드 금지, "Dense lists need rhythm, not more borders").
 */
function ProofBand({
  vendorCards,
  spread,
}: {
  vendorCards: number;
  spread: Awaited<ReturnType<typeof loadLandingAgencySpread>>;
}) {
  const hasSpread = spread.differingVendors > 0 && spread.comparableVendors > 0;
  const topSpread = spread.highlights[0] ?? null;

  const stats = [
    {
      value: vendorCards > 0 ? vendorCards.toLocaleString("ko-KR") : "—",
      unit: "곳",
      label: "가격을 공시한 스튜디오·드레스·메이크업·예식장",
    },
    {
      value: PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR"),
      unit: "건",
      label: `취소 위약금·환불 규정 원문 (업체 ${PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}곳)`,
    },
    {
      value: hasSpread ? spread.differingVendors.toLocaleString("ko-KR") : "—",
      unit: "곳",
      label: hasSpread
        ? `대행사 2곳 이상이 공시한 ${spread.comparableVendors.toLocaleString("ko-KR")}곳 중, 대행사마다 기본가가 달랐던 업체`
        : "대행사 간 공시가 비교",
    },
  ];

  return (
    <section className="bg-[#243832] text-white">
      <div className={`${shell} py-14 md:py-20`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#E2D3C8]">
          한국소비자원 참가격 · {disclosureRoundLabel()} 공시 기준
        </p>
        <h2 className="mt-5 max-w-2xl text-[30px] font-medium leading-[1.34] tracking-[-0.02em] md:text-[36px]">
          같은 업체인데, 어느 대행사를 통하느냐에 따라 가격이 다릅니다
        </h2>

        <dl className="mt-12 grid gap-10 border-t border-white/12 pt-10 md:grid-cols-3 md:gap-8">
          {stats.map((stat) => (
            <div key={stat.label}>
              <dt className="flex items-baseline gap-1">
                <span className="text-[48px] font-medium leading-none tracking-[-0.03em] text-white">
                  {stat.value}
                </span>
                <span className="text-[20px] font-normal text-[#E2D3C8]">{stat.unit}</span>
              </dt>
              <dd className="mt-4 max-w-[26ch] text-[14px] font-normal leading-[1.7] text-white/60">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>

        {hasSpread && topSpread && (
          <p className="mt-12 border-t border-white/12 pt-8 text-[16px] font-normal leading-[1.8] text-white/75">
            예를 들면 {PRICE_CATEGORY_LABELS[topSpread.category]} 한 곳은 대행사{" "}
            {topSpread.agencyCount}곳이{" "}
            <b className="font-medium text-[#E2D3C8]">{formatKrwManwon(topSpread.lowKrw)}</b>
            부터{" "}
            <b className="font-medium text-[#E2D3C8]">{formatKrwManwon(topSpread.highKrw)}</b>
            까지 공시했습니다. 요약도, 어디가 낫다는 판정도 하지 않고 원문 그대로 보여드립니다.
          </p>
        )}
      </div>
    </section>
  );
}

const PROBLEMS: Array<{ icon: LucideIcon; title: string; body: string }> = [
  {
    icon: Search,
    title: "비교할 기준 자체가 없다",
    body:
      "가격을 공개하지 않는 업체가 많아, 받은 견적이 어느 수준인지 확인할 방법이 없습니다. "
      + "그래서 대부분 플래너가 보여주는 목록 안에서만 고르게 됩니다.",
  },
  {
    icon: Coins,
    title: "계약하고 나서 금액이 벌어진다",
    body:
      "앨범 페이지, 원본·수정본, 헬퍼비, 얼리스타트처럼 나중에 붙는 항목이 계약 전에는 "
      + "잘 보이지 않습니다. 처음 들은 금액과 최종 금액이 달라지는 자리입니다.",
  },
  {
    icon: ScrollText,
    title: "취소 조건은 계약 직전에야 본다",
    body:
      "같은 샵인데도 어느 대행사를 통하느냐에 따라 위약금 문구가 다릅니다. "
      + "촬영 60일 전 취소 기준으로 한쪽은 상품가의 20%, 다른 쪽은 100%인 경우가 있었습니다.",
  },
];

function WhyWeExist() {
  return (
    <section className={`${shell} py-16 md:py-24`}>
      <SectionHeading eyebrow="왜 만들었나" title="정보를 가진 쪽이 조건을 정하는 시장이라서" />
      <ul className="mt-12 grid gap-12 md:grid-cols-3 md:gap-10">
        {PROBLEMS.map((problem) => (
          <li key={problem.title} className="border-t border-[#243832]/12 pt-7">
            <problem.icon className="h-6 w-6 stroke-[1.4] text-[#A77B74]" />
            <h3 className="mt-5 text-[20px] font-medium leading-[1.4] tracking-[-0.02em] text-[#243832]">
              {problem.title}
            </h3>
            <p className="mt-3 text-[15px] font-normal leading-[1.8] text-[#36534E]/75">{problem.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-12 max-w-3xl text-[13px] font-normal leading-[1.8] text-[#36534E]/55">
        위약금 사례는 한국소비자원 참가격 {disclosureRoundLabel()} 공시 원문을 대조해 확인한
        내용입니다. 모든 업체가 이렇다는 뜻은 아니며, 어느 쪽이 낫다는 판정은 하지 않습니다.
      </p>
    </section>
  );
}

function ThreeAxes({
  vendorCards,
  counts,
}: {
  vendorCards: number;
  counts: Awaited<ReturnType<typeof loadCatalogCounts>>["counts"];
}) {
  const categoryLine = PRICE_CATEGORIES
    .map((category) => `${PRICE_CATEGORY_LABELS[category]} ${(counts[category] ?? 0).toLocaleString("ko-KR")}`)
    .join(" · ");

  const axes = [
    {
      index: "01",
      title: "눈탱이 방지",
      lede: "공시된 사실을 원문 그대로",
      body:
        vendorCards > 0
          ? `가격을 공시한 ${vendorCards.toLocaleString("ko-KR")}곳(${categoryLine})의 기본가와 추가 항목, 그리고 취소 위약금·환불 규정 원문 ${PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건을 그대로 싣습니다. 요약하지 않고, 점수·등급도 매기지 않습니다.`
          : "업체가 공시한 기본가와 추가 항목, 취소 위약금·환불 규정 원문을 그대로 싣습니다. 요약하지 않고, 점수·등급도 매기지 않습니다.",
      items: [
        { label: "업체별 공시가·추가금 비교", href: "/price" },
        { label: "대행사별 위약금 원문", href: "/price" },
        { label: "찜하고 조합해 총액 보기", href: "/price/wishlist" },
      ],
      note: "로그인 없이",
    },
    {
      index: "02",
      title: "셀프 준비",
      lede: "플래너 없이 둘이서",
      body:
        "발품을 대신 팔아주지는 않습니다. 대신 발품 판 결과가 흩어지지 않게 담아 둡니다. "
        + "예산은 20개 항목으로 나눠 추적하고, 일정은 체크리스트와 타임라인으로 봅니다.",
      items: [
        { label: "예산 20개 항목·분담 추적", href: weddingPath("/budget") },
        { label: "체크리스트·타임라인·캘린더", href: weddingPath("/schedule") },
        { label: "받은 견적서 점검", href: weddingPath("/community/quote-check") },
        { label: "축의금 관리", href: weddingPath("/money") },
      ],
      note: "예산·일정·축의금은 로그인 필요 · 견적서 점검은 로그인 없이",
    },
    {
      index: "03",
      title: "동반자",
      lede: "준비하는 내내 옆에",
      body:
        "한 번 말한 조건을 다시 묻지 않고, 상견례나 예식처럼 챙길 것이 많은 날 앞에서는 "
        + "먼저 말을 겁니다. 비슷한 시기에 준비하는 사람들이 모인 동기방도 분기별로 열려 있습니다.",
      items: [
        { label: "아모라 상담", href: weddingPath("/chat") },
        { label: "분기별 동기방", href: weddingPath("/community/cohort") },
        { label: "후기·질문 커뮤니티", href: weddingPath() },
      ],
      note: "커뮤니티 읽기는 로그인 없이 · 아모라·동기방은 로그인 필요",
    },
  ];

  return (
    <section id="what-we-do" className="scroll-mt-16 bg-[#F7F1E8]">
      <div className={`${shell} py-16 md:py-24`}>
        <SectionHeading
          eyebrow="웨딩한방이 하는 일"
          title="셋으로 나뉩니다"
          description="기능을 넓게 늘리는 대신, 이 셋을 깊게 합니다."
        />

        <div className="mt-12 divide-y divide-[#243832]/12 border-y border-[#243832]/12">
          {axes.map((axis) => (
            <div
              key={axis.index}
              className="grid gap-6 py-10 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.8fr)] lg:gap-12"
            >
              <span className="text-[14px] font-semibold tracking-[0.1em] text-[#B89785] lg:pt-1.5">
                {axis.index}
              </span>
              <div className="min-w-0">
                <h3 className="text-[24px] font-medium leading-[1.35] tracking-[-0.02em] text-[#243832] md:text-[30px]">
                  {axis.title}
                  <span className="ml-2.5 text-[16px] font-normal text-[#36534E]/60 md:text-[18px]">
                    {axis.lede}
                  </span>
                </h3>
                <p className="mt-4 max-w-xl text-[15px] font-normal leading-[1.85] text-[#36534E]/78">
                  {axis.body}
                </p>
              </div>
              <div className="min-w-0">
                <ul className="flex flex-col">
                  {axis.items.map((item) => (
                    <li key={item.label}>
                      <Link
                        href={item.href}
                        className="group flex min-h-12 items-center justify-between gap-4 border-b border-[#243832]/10 text-[15px] font-medium text-[#36534E] transition-colors hover:text-[#A77B74]"
                      >
                        {item.label}
                        <ArrowRight className="h-4 w-4 shrink-0 text-[#B89785] transition-transform duration-200 group-hover:translate-x-1" />
                      </Link>
                    </li>
                  ))}
                </ul>
                <p className="mt-4 text-[12px] font-medium leading-[1.7] text-[#36534E]/55">{axis.note}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const AMORA_ABILITIES: Array<{ icon: LucideIcon; when: string; then: string }> = [
  {
    icon: CalendarCheck,
    when: "예식일만 알려주면",
    then: "지금 열어야 하는 항목과 다음 한 걸음을 순서로 잡아줍니다.",
  },
  {
    icon: Wallet,
    when: "총예산만 말하면",
    then: "20개 항목으로 나눈 초안을 만들고, 조건이 바뀌면 같이 고칩니다.",
  },
  {
    icon: Bell,
    when: "상견례·예식이 다가오면",
    then: "먼저 말을 걸어 그날 챙길 것을 짚어줍니다.",
  },
  {
    icon: Users,
    when: "둘의 의견이 갈리면",
    then: "두 사람이 각각 같은 안에 동의한 뒤에만 공동 결정으로 남깁니다.",
  },
];

function AmoraSection() {
  return (
    <section className={`${shell} py-16 md:py-24`}>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-20">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#B89785]">
            AI 웨딩 플래너 아모라
          </p>
          <h2 className="mt-5 text-[30px] font-medium leading-[1.32] tracking-[-0.025em] text-[#243832] md:text-[36px]">
            대신 결정하지 않습니다.
            <br />
            <span className="text-[#36534E]">같이 정리합니다.</span>
          </h2>
          <p className="mt-6 max-w-lg text-[15px] font-normal leading-[1.85] text-[#36534E]/78">
            아모라는 결혼 준비를 대신 결정하는 챗봇이 아닙니다. 일정과 예산을 바꿀 때는
            바뀔 내용을 먼저 보여주고{" "}
            <b className="font-semibold text-[#243832]">사용자가 승인한 내용만 반영</b>합니다.
            모르는 가격이나 계약 해석을 아는 척하지 않고, 출처와 기준 시점을 구분해 말합니다.
          </p>
          <p className="mt-4 max-w-lg text-[14px] font-normal leading-[1.8] text-[#36534E]/60">
            장기기억은 기본이 꺼져 있습니다. 개인 기억은 본인이, 커플 공유 기억은 두 사람이
            모두 동의해야 켜지고, 한 명이 철회하면 즉시 꺼집니다. 기억은 언제든 열어 보고
            고치거나 지울 수 있습니다.
          </p>
          <Link
            href={weddingPath("/chat")}
            className="group mt-8 inline-flex min-h-[52px] items-center gap-2 rounded-full bg-[#36534E] px-8 text-[16px] font-semibold text-white transition-colors duration-200 hover:bg-[#243832]"
          >
            아모라와 시작하기
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
          <p className="mt-4 text-[12px] font-medium text-[#36534E]/55">로그인이 필요해요 · 무료</p>
        </div>

        <ul className="grid gap-x-10 gap-y-9 sm:grid-cols-2">
          {AMORA_ABILITIES.map((ability) => (
            <li key={ability.when} className="border-t border-[#243832]/12 pt-6">
              <ability.icon className="h-5 w-5 stroke-[1.5] text-[#6D806E]" />
              <b className="mt-4 block text-[16px] font-semibold leading-[1.5] text-[#243832]">
                {ability.when}
              </b>
              <span className="mt-2 block text-[14px] font-normal leading-[1.8] text-[#36534E]/72">
                {ability.then}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

const REFUSALS: Array<{ title: string; body: string }> = [
  {
    title: "돈 받고 순위를 올려주지 않습니다",
    body: "유료 노출·프리미엄 순위는 영구히 만들지 않습니다. 광고를 싣게 되더라도 추천과는 완전히 분리해 표시합니다.",
  },
  {
    title: "AI가 일반 사용자인 척하지 않습니다",
    body: "커뮤니티에서 AI가 사람인 것처럼 글이나 댓글을 쓰지 않습니다. AI가 만든 것은 AI가 만들었다고 밝힙니다.",
  },
  {
    title: "견적과 시세에 점수를 매기지 않습니다",
    body: "구성을 모르는 채로 안전·위험을 판정하면 틀립니다. 확인되지 않은 항목이 무엇인지와, 계약 전 물어볼 질문까지만 드립니다.",
  },
  {
    title: "계약서를 법률적으로 판단하지 않습니다",
    body: "독소조항 판정이나 승소 가능성 같은 이야기는 하지 않습니다. 확인할 문구를 짚고 쉬운 말로 옮기는 데까지입니다.",
  },
];

function WhatWeRefuse() {
  return (
    <section className="bg-[#243832] text-white">
      <div className={`${shell} py-16 md:py-24`}>
        <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#E2D3C8]">
          하지 않는 것
        </p>
        <h2 className="mt-5 max-w-2xl text-[30px] font-medium leading-[1.34] tracking-[-0.025em] md:text-[36px]">
          무엇을 안 하는지가 이 서비스의 정의입니다
        </h2>
        <p className="mt-5 max-w-xl text-[15px] font-normal leading-[1.85] text-white/60">
          소비자 신뢰가 단기 매출보다 항상 앞선다는 것이 첫 번째 원칙입니다.
        </p>

        <ul className="mt-12 grid gap-10 border-t border-white/12 pt-10 md:grid-cols-2 md:gap-x-16">
          {REFUSALS.map((refusal, index) => (
            <li key={refusal.title}>
              <span className="text-[13px] font-semibold tracking-[0.1em] text-[#B89785]">
                {String(index + 1).padStart(2, "0")}
              </span>
              <b className="mt-3 block text-[20px] font-medium leading-[1.45] tracking-[-0.02em] text-white">
                {refusal.title}
              </b>
              <span className="mt-3 block max-w-md text-[14px] font-normal leading-[1.8] text-white/60">
                {refusal.body}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function HonestScope() {
  const notes = [
    `공시 자료는 ${disclosureRoundLabel()} 라운드 기준입니다. 계약 시점·시즌·선택 옵션에 따라 실제 금액은 달라질 수 있어 계약 전 업체 확인이 필요합니다.`,
    "지역별 공급이 고르지 않습니다. 공시한 업체만 싣기 때문에 실제 그 지역의 업체 수와 다르며, 목록에서 지역별 수를 숨기지 않고 그대로 보여줍니다.",
    "업체 예약·결제·계약을 대행하지 않습니다. 계약은 사용자가 업체와 직접 합니다. 웨딩한방은 그 전에 필요한 사실과 절차만 제공합니다.",
  ];

  return (
    <section className={`${shell} py-16 md:py-20`}>
      <h2 className="text-[24px] font-medium leading-[1.4] tracking-[-0.02em] text-[#243832] md:text-[30px]">
        지금 어디까지 와 있는지도 적어 둡니다
      </h2>
      <ul className="mt-8 grid gap-8 border-t border-[#243832]/12 pt-8 md:grid-cols-3 md:gap-10">
        {notes.map((note) => (
          <li key={note} className="text-[14px] font-normal leading-[1.85] text-[#36534E]/72">
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className={`${shell} pb-20 pt-4`}>
      <div className="overflow-hidden rounded-[28px] bg-[#36534E] px-8 py-16 text-center md:px-16 md:py-20">
        <h2 className="mx-auto max-w-2xl text-[30px] font-medium leading-[1.34] tracking-[-0.025em] text-white md:text-[36px]">
          아직 아무것도 안 알아봤어도 괜찮아요
        </h2>
        <p className="mx-auto mt-5 max-w-lg text-[16px] font-normal leading-[1.8] text-white/70">
          공시된 가격부터 열어 보거나, 예식일만 알려주고 순서를 잡는 것부터 시작해 보세요.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/price"
            className="group inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full bg-[#A77B74] px-8 text-[16px] font-semibold text-white transition-colors duration-200 hover:bg-[#8F6662]"
          >
            공시가·위약금 보기
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
          <Link
            href="/start-here"
            className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-white/25 px-8 text-[16px] font-medium text-white transition-colors hover:border-white/50"
          >
            지금 뭐부터 할지 보기
          </Link>
        </div>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="text-[12px] font-semibold uppercase tracking-[0.22em] text-[#B89785]">{eyebrow}</p>
      <h2 className="mt-5 text-[30px] font-medium leading-[1.32] tracking-[-0.025em] text-[#243832] md:text-[36px]">
        {title}
      </h2>
      {description && (
        <p className="mt-5 text-[16px] font-normal leading-[1.8] text-[#36534E]/75">{description}</p>
      )}
    </div>
  );
}

const FOOTER_SERVICE_LINKS = [
  { label: "공시가·위약금", href: "/price" },
  { label: "커뮤니티", href: weddingPath() },
  { label: "견적서 점검", href: weddingPath("/community/quote-check") },
  { label: "아모라 상담", href: weddingPath("/chat") },
];

const FOOTER_POLICY_LINKS = [
  { label: "이용약관", href: "/terms" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "AI 서비스 정책", href: "/ai-policy" },
];

function SiteFooter() {
  return (
    <footer className="border-t border-[#243832]/10 bg-[#F7F1E8]">
      <div className={`${shell} grid gap-10 py-14 md:grid-cols-[1.5fr_1fr_1fr]`}>
        <div>
          <span className="text-[20px] font-semibold tracking-[-0.02em] text-[#243832]">웨딩한방</span>
          <p className="mt-4 max-w-sm text-[14px] font-normal leading-[1.85] text-[#36534E]/70">
            업체가 공시한 가격과 위약금 원문을 그대로 보여주고, 준비하는 내내 옆에 있는
            소비자 편 서비스입니다.
          </p>
        </div>
        <FooterColumn title="서비스" items={FOOTER_SERVICE_LINKS} />
        <FooterColumn title="정책" items={FOOTER_POLICY_LINKS} />
      </div>
      <div className={`${shell} border-t border-[#243832]/10 py-6 text-[12px] font-normal text-[#36534E]/55`}>
        © 2026 Wedding Hanbang. 가격 출처: 한국소비자원 참가격 · {disclosureRoundLabel()} 공시 기준.
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <h3 className="text-[14px] font-semibold text-[#243832]">{title}</h3>
      <ul className="mt-4 flex flex-col gap-3">
        {items.map((item) => (
          <li key={item.label}>
            <Link
              href={item.href}
              className="text-[14px] font-normal text-[#36534E]/70 transition-colors hover:text-[#A77B74]"
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
