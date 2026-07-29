import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { cache } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  ClipboardCheck,
  ClipboardList,
  Coins,
  FileSearch,
  HeartHandshake,
  ScrollText,
  Search,
  ShieldOff,
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
 * 기능을 현재형으로 약속하고 있었다. 그래서 미링크·미색인으로 봉인돼 있었고 —
 * 결과적으로 **첫 방문자에게 서비스를 설명하는 화면이 아예 없었다.** 커뮤니티 피드가
 * 첫 화면을 대신했는데, 그건 이미 이 서비스를 아는 사람에게나 쓸모 있는 화면이다.
 *
 * 규칙(전부 PRINCIPLES.md P1·P5에서 나온다):
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
 * 세 표면(첫 화면·공시 허브·이 랜딩)의 값 일치는
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

const shell = "mx-auto w-full max-w-[1120px] px-5 sm:px-6 lg:px-8";

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
    <div className="min-h-screen bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_46%,#fbf8ee_100%)] text-[#061a34]">
      <SiteHeader />
      <Hero vendorCards={vendorCards} spread={spread} />
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
    { label: "커뮤니티", href: weddingPath() },
    { label: "서비스 소개", href: "#what-we-do" },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[#eadfc9] bg-[#fffdf7]/92 backdrop-blur">
      <div className={`${shell} flex h-16 items-center justify-between gap-4`}>
        <Link href="/landing" className="font-serif-kr text-[19px] font-medium tracking-tight text-[#071629]">
          웨딩한방
        </Link>
        <nav className="hidden items-center gap-7 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[13.5px] font-semibold text-[#5d6879] transition-colors hover:text-[#36534E]"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <Link
          href="/price"
          className="inline-flex min-h-10 items-center rounded-full bg-[#36534E] px-5 text-[13px] font-semibold text-white transition-colors hover:bg-[#2d4642]"
        >
          공시가 보기
        </Link>
      </div>
    </header>
  );
}

function Hero({
  vendorCards,
  spread,
}: {
  vendorCards: number;
  spread: Awaited<ReturnType<typeof loadLandingAgencySpread>>;
}) {
  const hasSpread = spread.differingVendors > 0 && spread.comparableVendors > 0;
  const topSpread = spread.highlights[0] ?? null;

  return (
    <section className={`${shell} pb-10 pt-10 md:pt-14`}>
      <div className="relative overflow-hidden rounded-[26px] bg-[linear-gradient(135deg,#12302b_0%,#1f4a42_54%,#0e2723_100%)] px-6 py-9 shadow-[0_22px_54px_rgba(8,34,28,0.22)] md:px-12 md:py-14">
        {/* 사진은 오른쪽 뒤로 깔고 왼쪽은 초록으로 덮는다 — 글자 대비를 지키면서
            히어로가 색면 하나로만 남지 않게 한다. 이미 최적화·용량 예산이 걸려 있는
            공용 에셋을 그대로 쓴다(`heroAssetBudget.test.ts`). */}
        <Image
          src="/images/amora-hero-bouquet-custom.webp"
          alt=""
          aria-hidden="true"
          fill
          priority
          sizes="(min-width: 1120px) 1120px, 100vw"
          className="pointer-events-none select-none object-cover object-right opacity-30"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,#0e2723_0%,rgba(18,48,43,0.95)_44%,rgba(14,39,35,0.55)_100%)]" />

        <div className="relative">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8c79a]/35 bg-white/[0.07] px-3 py-1 text-[11px] font-semibold text-[#e8dcb8]">
          <ClipboardCheck className="h-3.5 w-3.5" />
          한국소비자원 참가격 · {disclosureRoundLabel()} 공시 기준
        </span>

        {/* 파운더가 직접 쓴 미션 문장 그대로. 여기서만 쓸 수 있는 말이다. */}
        <h1 className="mt-4 max-w-3xl font-serif-kr text-[30px] font-medium leading-[1.28] text-white md:text-[46px]">
          웨딩의 &lsquo;웨&rsquo;자를 몰라도,
          <br />
          추가금에 안 당하고, 결혼식까지
        </h1>
        <p className="mt-5 max-w-2xl text-[14.5px] font-medium leading-[1.8] text-[#dbe7e0] md:text-[16px]">
          웨딩 시장은 플래너와 업체가 정하는 대로 따라가게 설계돼 있습니다. 웨딩한방은
          업체가 <b className="font-semibold text-white">공시한 가격과 위약금 원문</b>을 그대로 펼쳐 두고,
          예산·일정·업체 정리는 AI 웨딩 플래너 <b className="font-semibold text-white">아모라</b>가 옆에서
          같이 합니다.
        </p>

        <dl className="mt-8 grid gap-3 sm:grid-cols-3">
          <HeroStat
            value={vendorCards > 0 ? `${vendorCards.toLocaleString("ko-KR")}곳` : "준비 중"}
            label="가격을 공시한 스튜디오·드레스·메이크업·예식장"
          />
          <HeroStat
            value={`${PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건`}
            label={`취소 위약금·환불 규정 원문 (업체 ${PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}곳)`}
          />
          <HeroStat
            value={hasSpread ? `${spread.differingVendors.toLocaleString("ko-KR")}곳` : "확인 중"}
            label={
              hasSpread
                ? `대행사 2곳 이상이 공시한 ${spread.comparableVendors.toLocaleString("ko-KR")}곳 중, 대행사마다 기본가가 달랐던 업체`
                : "대행사 간 공시가 비교"
            }
          />
        </dl>

        {hasSpread && topSpread && (
          // 주장 대신 실제 계산값 한 줄. 이 페이지에서 가장 강한 문장이라 히어로 안에 둔다.
          <p className="mt-5 inline-flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-[14px] border border-white/12 bg-white/[0.06] px-4 py-3 text-[13px] font-medium text-[#dbe7e0]">
            <span>
              예를 들면 {PRICE_CATEGORY_LABELS[topSpread.category]} 한 곳은 대행사{" "}
              {topSpread.agencyCount}곳이
            </span>
            <b className="font-serif-kr text-[18px] font-medium text-white">
              {formatKrwManwon(topSpread.lowKrw)}
            </b>
            <span>부터</span>
            <b className="font-serif-kr text-[18px] font-medium text-white">
              {formatKrwManwon(topSpread.highKrw)}
            </b>
            <span>까지 공시했습니다.</span>
          </p>
        )}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/price"
            className="group inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-[#f2e8c8] px-8 text-[15px] font-bold text-[#12302b] shadow-[0_14px_30px_rgba(0,0,0,0.22)] transition-transform hover:-translate-y-0.5"
          >
            공시가·위약금 원문 보기
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href={weddingPath("/chat")}
            className="inline-flex min-h-[54px] items-center justify-center rounded-full border border-white/25 px-8 text-[14px] font-semibold text-white transition-colors hover:border-[#d8c79a]/60 hover:bg-white/[0.06]"
          >
            아모라와 시작하기
          </Link>
        </div>
        <p className="mt-3 text-[11.5px] font-semibold text-[#9fb8ae]">
          공시가·위약금·커뮤니티는 로그인 없이 볼 수 있어요. 아모라는 내 예식일과 준비
          상황을 바탕으로 답해야 해서 로그인이 필요하고, 무료예요.
        </p>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-[16px] border border-white/12 bg-white/[0.05] px-4 py-3.5">
      <dt className="font-serif-kr text-[26px] font-medium leading-none text-[#f2e8c8]">{value}</dt>
      <dd className="mt-2 text-[11.5px] font-medium leading-[1.55] text-[#a9c0b7]">{label}</dd>
    </div>
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
    <section className={`${shell} py-12`}>
      <SectionHeading
        eyebrow="왜 만들었나"
        title="정보를 가진 쪽이 조건을 정하는 시장이라서"
      />
      <ul className="mt-7 grid gap-4 md:grid-cols-3">
        {PROBLEMS.map((problem) => (
          <li
            key={problem.title}
            className="rounded-[18px] border border-[#eadfc9] bg-white/85 px-5 py-5 shadow-[0_8px_24px_rgba(8,22,38,0.04)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#fbefd6]">
              <problem.icon className="h-5 w-5 stroke-[1.7] text-[#9d6f36]" />
            </span>
            <h3 className="mt-3.5 font-serif-kr text-[19px] font-medium leading-[1.35] text-[#071629]">
              {problem.title}
            </h3>
            <p className="mt-2 text-[13px] font-medium leading-[1.75] text-[#5d6879]">{problem.body}</p>
          </li>
        ))}
      </ul>
      <p className="mt-5 text-[11.5px] font-medium leading-[1.7] text-[#7a8290]">
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

  return (
    <section id="what-we-do" className={`${shell} scroll-mt-20 py-12`}>
      <SectionHeading
        eyebrow="웨딩한방이 하는 일"
        title="셋으로 나뉩니다"
        description="기능을 넓게 늘리는 대신, 이 셋을 깊게 합니다."
      />

      <div className="mt-8 space-y-4">
        <AxisCard
          index="01"
          icon={FileSearch}
          title="눈탱이 방지 — 공시된 사실을 원문 그대로"
          body={
            vendorCards > 0
              ? `가격을 공시한 ${vendorCards.toLocaleString("ko-KR")}곳(${categoryLine})의 기본가와 추가 항목, 그리고 취소 위약금·환불 규정 원문 ${PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR")}건을 그대로 싣습니다. 요약하지 않고, 점수·등급도 매기지 않습니다.`
              : "업체가 공시한 기본가와 추가 항목, 취소 위약금·환불 규정 원문을 그대로 싣습니다. 요약하지 않고, 점수·등급도 매기지 않습니다."
          }
          items={[
            { label: "업체별 공시가·추가금 비교", href: "/price" },
            { label: "대행사별 위약금 원문", href: "/price" },
            { label: "찜하고 조합해 총액 보기", href: "/price/wishlist" },
          ]}
          note="로그인 없이"
        />

        <AxisCard
          index="02"
          icon={ClipboardList}
          title="셀프 준비 — 플래너 없이 둘이서"
          body="발품을 대신 팔아주지는 않습니다. 대신 발품 판 결과가 흩어지지 않게 담아 둡니다. 예산은 20개 항목으로 나눠 추적하고, 일정은 체크리스트와 타임라인으로 봅니다."
          items={[
            { label: "예산 20개 항목·분담 추적", href: weddingPath("/budget") },
            { label: "체크리스트·타임라인·캘린더", href: weddingPath("/schedule") },
            { label: "받은 견적서 점검", href: weddingPath("/community/quote-check") },
            { label: "축의금 관리", href: weddingPath("/money") },
          ]}
          note="예산·일정·축의금은 로그인 필요 · 견적서 점검은 로그인 없이"
        />

        <AxisCard
          index="03"
          icon={HeartHandshake}
          title="동반자 — 준비하는 내내 옆에"
          body="한 번 말한 조건을 다시 묻지 않고, 상견례나 예식처럼 챙길 것이 많은 날 앞에서는 먼저 말을 겁니다. 비슷한 시기에 준비하는 사람들이 모인 동기방도 분기별로 열려 있습니다."
          items={[
            { label: "아모라 상담", href: weddingPath("/chat") },
            { label: "분기별 동기방", href: weddingPath("/community/cohort") },
            { label: "후기·질문 커뮤니티", href: weddingPath() },
          ]}
          note="커뮤니티 읽기는 로그인 없이 · 아모라·동기방은 로그인 필요"
        />
      </div>
    </section>
  );
}

function AxisCard({
  index,
  icon: Icon,
  title,
  body,
  items,
  note,
}: {
  index: string;
  icon: LucideIcon;
  title: string;
  body: string;
  items: Array<{ label: string; href: string }>;
  note: string;
}) {
  return (
    <article className="rounded-[20px] border border-[#eadfc9] bg-white/88 px-5 py-6 shadow-[0_10px_28px_rgba(8,22,38,0.045)] md:px-8 md:py-7">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:gap-10">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <span className="font-serif-kr text-[13px] font-medium text-[#b68a3a]">{index}</span>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef4f1]">
              <Icon className="h-4 w-4 stroke-[1.7] text-[#36534E]" />
            </span>
          </div>
          <h3 className="mt-3 font-serif-kr text-[22px] font-medium leading-[1.35] text-[#071629] md:text-[25px]">
            {title}
          </h3>
          <p className="mt-2.5 text-[13.5px] font-medium leading-[1.8] text-[#5d6879]">{body}</p>
        </div>
        <div className="min-w-0">
          <ul className="grid gap-2">
            {items.map((item) => (
              <li key={item.label}>
                <Link
                  href={item.href}
                  className="group flex min-h-11 items-center justify-between gap-3 rounded-[13px] border border-[#eadfc9] bg-[#fffdf7] px-4 text-[13px] font-semibold text-[#34445a] transition-colors hover:border-[#36534E]/40 hover:bg-white"
                >
                  {item.label}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[#9d6f36] transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2.5 text-[11px] font-semibold text-[#9d6f36]">{note}</p>
        </div>
      </div>
    </article>
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
    <section className={`${shell} py-12`}>
      <article className="overflow-hidden rounded-[22px] border border-[#d8bb86] bg-[linear-gradient(135deg,#fffdf8_0%,#ffffff_58%,#eef4f1_100%)] px-6 py-8 shadow-[0_12px_34px_rgba(8,22,38,0.05)] md:px-10 md:py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12">
          <div className="min-w-0">
            <span className="inline-flex rounded-full bg-[#fbefd6] px-3 py-1 text-[11px] font-semibold text-[#9d6f36]">
              AI 웨딩 플래너 아모라
            </span>
            <h2 className="mt-3 font-serif-kr text-[26px] font-medium leading-[1.32] text-[#071629] md:text-[32px]">
              대신 결정하지 않습니다.
              <br />
              같이 정리합니다.
            </h2>
            <p className="mt-3.5 text-[13.5px] font-medium leading-[1.8] text-[#5d6879]">
              아모라는 결혼 준비를 대신 결정하는 챗봇이 아닙니다. 일정과 예산을 바꿀 때는
              바뀔 내용을 먼저 보여주고{" "}
              <b className="font-bold text-[#071629]">사용자가 승인한 내용만 반영</b>합니다.
              모르는 가격이나 계약 해석을 아는 척하지 않고, 출처와 기준 시점을 구분해서 말합니다.
            </p>
            <p className="mt-2.5 text-[12.5px] font-medium leading-[1.75] text-[#7a8290]">
              장기기억은 기본이 꺼져 있습니다. 개인 기억은 본인이, 커플 공유 기억은 두 사람이
              모두 동의해야 켜지고, 한 명이 철회하면 즉시 꺼집니다. 기억은 언제든 열어 보고
              고치거나 지울 수 있습니다.
            </p>
            <Link
              href={weddingPath("/chat")}
              className="group mt-5 inline-flex min-h-[50px] items-center gap-2 rounded-full bg-[#36534E] px-7 text-[14px] font-semibold text-white shadow-[0_12px_26px_rgba(54,83,78,0.2)] transition-colors hover:bg-[#2d4642]"
            >
              아모라와 시작하기
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <p className="mt-2 text-[11.5px] font-semibold text-[#9d6f36]">로그인이 필요해요 · 무료</p>
          </div>

          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {AMORA_ABILITIES.map((ability) => (
              <li
                key={ability.when}
                className="rounded-[16px] border border-[#eadfc9] bg-white/75 px-4 py-4"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#eef4f1]">
                  <ability.icon className="h-4 w-4 stroke-[1.7] text-[#36534E]" />
                </span>
                <b className="mt-3 block text-[13px] font-bold text-[#071629]">{ability.when}</b>
                <span className="mt-1 block text-[12.5px] font-medium leading-[1.7] text-[#5d6879]">
                  {ability.then}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </article>
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
    <section className={`${shell} py-12`}>
      <SectionHeading
        eyebrow="하지 않는 것"
        title="무엇을 안 하는지가 이 서비스의 정의입니다"
        description="소비자 신뢰가 단기 매출보다 항상 앞선다는 것이 첫 번째 원칙입니다."
      />
      <ul className="mt-7 grid gap-3 md:grid-cols-2">
        {REFUSALS.map((refusal) => (
          <li
            key={refusal.title}
            className="flex gap-3.5 rounded-[18px] border border-[#eadfc9] bg-white/85 px-5 py-5"
          >
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f6ead9]">
              <ShieldOff className="h-4 w-4 stroke-[1.7] text-[#9d6f36]" />
            </span>
            <span className="min-w-0">
              <b className="block text-[14.5px] font-bold leading-[1.45] text-[#071629]">{refusal.title}</b>
              <span className="mt-1.5 block text-[12.5px] font-medium leading-[1.75] text-[#5d6879]">
                {refusal.body}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function HonestScope() {
  return (
    <section className={`${shell} py-12`}>
      <div className="rounded-[20px] border border-[#eadfc9] bg-[#fffdf7] px-6 py-6 md:px-8 md:py-7">
        <h2 className="font-serif-kr text-[21px] font-medium leading-[1.35] text-[#071629] md:text-[23px]">
          지금 어디까지 와 있는지도 적어 둡니다
        </h2>
        <ul className="mt-4 grid gap-2.5 text-[13px] font-medium leading-[1.75] text-[#5d6879] md:grid-cols-3">
          <li className="rounded-[14px] bg-white/80 px-4 py-3.5">
            공시 자료는 <b className="font-bold text-[#071629]">{disclosureRoundLabel()} 라운드</b> 기준입니다.
            계약 시점·시즌·선택 옵션에 따라 실제 금액은 달라질 수 있어 계약 전 업체 확인이 필요합니다.
          </li>
          <li className="rounded-[14px] bg-white/80 px-4 py-3.5">
            지역별 공급이 고르지 않습니다. 공시한 업체만 싣기 때문에 실제 그 지역의 업체 수와
            다르며, 목록에서 지역별 수를 숨기지 않고 그대로 보여줍니다.
          </li>
          <li className="rounded-[14px] bg-white/80 px-4 py-3.5">
            업체 예약·결제·계약을 대행하지 않습니다. 계약은 사용자가 업체와 직접 합니다.
            웨딩한방은 그 전에 필요한 사실과 절차만 제공합니다.
          </li>
        </ul>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section className={`${shell} pb-14 pt-4`}>
      <div className="overflow-hidden rounded-[22px] bg-[linear-gradient(135deg,#12302b_0%,#1f4a42_58%,#0e2723_100%)] px-6 py-9 text-center md:px-12 md:py-12">
        <h2 className="mx-auto max-w-2xl font-serif-kr text-[25px] font-medium leading-[1.35] text-white md:text-[32px]">
          아직 아무것도 안 알아봤어도 괜찮아요
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[13.5px] font-medium leading-[1.8] text-[#dbe7e0]">
          공시된 가격부터 열어 보거나, 예식일만 알려주고 순서를 잡는 것부터 시작해 보세요.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/price"
            className="inline-flex min-h-[52px] items-center justify-center rounded-full bg-[#f2e8c8] px-8 text-[14.5px] font-bold text-[#12302b] transition-transform hover:-translate-y-0.5"
          >
            공시가·위약금 보기
          </Link>
          <Link
            href="/start-here"
            className="inline-flex min-h-[52px] items-center justify-center rounded-full border border-white/25 px-8 text-[14px] font-semibold text-white transition-colors hover:bg-white/[0.06]"
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
      <span className="text-[11.5px] font-bold tracking-[0.14em] text-[#b68a3a]">{eyebrow}</span>
      <h2 className="mt-2 font-serif-kr text-[25px] font-medium leading-[1.32] text-[#071629] md:text-[31px]">
        {title}
      </h2>
      {description && (
        <p className="mt-2.5 text-[13.5px] font-medium leading-[1.75] text-[#5d6879]">{description}</p>
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
    <footer className="bg-[linear-gradient(135deg,#183832_0%,#2f5f55_58%,#12302b_100%)] text-white">
      <div className={`${shell} grid gap-8 py-10 md:grid-cols-[1.4fr_1fr_1fr]`}>
        <div>
          <span className="font-serif-kr text-[20px] font-medium text-white">웨딩한방</span>
          <p className="mt-3 max-w-sm text-[12.5px] font-medium leading-[1.8] text-white/70">
            업체가 공시한 가격과 위약금 원문을 그대로 보여주고, 준비하는 내내 옆에 있는
            소비자 편 서비스입니다.
          </p>
        </div>
        <FooterColumn title="서비스" items={FOOTER_SERVICE_LINKS} />
        <FooterColumn title="정책" items={FOOTER_POLICY_LINKS} />
      </div>
      <div className={`${shell} border-t border-white/10 py-4 text-[11.5px] text-white/55`}>
        © 2026 Wedding Hanbang. 가격 출처: 한국소비자원 참가격 · {disclosureRoundLabel()} 공시 기준.
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-white">{title}</h3>
      <ul className="mt-3 flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.label}>
            <Link href={item.href} className="text-[12.5px] font-medium text-white/65 hover:text-[#f2e8c8]">
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
