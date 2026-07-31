import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { ArrowRight, Menu } from "lucide-react";

import CelebrationHero from "@/components/landing/CelebrationHero";
import { CONTACT } from "@/lib/constants/contact";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES } from "@/lib/price/catalog";
import {
  DISCLOSURE_SOURCE_URL,
  disclosureRoundLabel,
} from "@/lib/price/period";
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
 * 따로 적어 둔 자리다. 그래서 첫 화면은 숫자 카드를 늘어놓지 않는다. 두 사람의
 * 실제 공동 대화와 정리 장면으로 제품을 먼저 보여준 뒤 증거(공시 수치)를 크게 말한다.
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
const PUBLISHED_VENDOR_COUNT = 414;

const loadCatalogCounts = cache(() => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
  ))
));

export async function generateMetadata(): Promise<Metadata> {
  const title = "웨딩한방 — 둘이 함께 쓰는 결혼 준비 AI 아모라";
  const description =
    "두 사람이 커플 공동 채팅에서 결혼 준비 AI 아모라와 이야기하고, 확인한 변경만 "
    + "예산·할 일·일정에 반영합니다. 필요한 아모라 답변은 저장해 둘이 함께 다시 볼 수 있습니다.";
  return {
    title,
    description,
    alternates: { canonical: "/landing" },
    openGraph: {
      title,
      description,
      url: "/landing",
      type: "website",
      images: [{
        url: "/images/landing-social-card.webp",
        width: 1200,
        height: 630,
        alt: "커플 공동 채팅에서 예산·할 일·일정을 함께 관리하는 웨딩한방",
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/images/landing-social-card.webp"],
    },
  };
}

const shell = "mx-auto w-full max-w-[1160px] px-6 sm:px-8 lg:px-10";
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4";
const focusRingOnDark =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]";
const amoraStartHref =
  "/login?mode=signup&redirect=%2Fwedding%2Fchat";

export default async function LandingPage() {
  const catalog = await loadCatalogCounts().catch(() => null);
  const vendorCards = catalog
    ? PRICE_CATEGORIES.reduce(
        (sum, category) => sum + (catalog.counts[category] ?? 0),
        0,
      )
    : 0;

  return (
    <div className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      <a
        href="#main-content"
        className="fixed left-4 top-4 z-[100] -translate-y-24 rounded-full bg-[#243832] px-5 py-3 text-[14px] font-semibold text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-2 focus:ring-[#8F6662] focus:ring-offset-2"
      >
        본문 바로가기
      </a>
      <SiteHeader />
      <main id="main-content" tabIndex={-1}>
        <CelebrationHero />
        <AmoraSection />
        <ProofBand vendorCards={vendorCards} />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}

function SiteHeader() {
  const navItems = [
    { label: "아모라", href: "#amora" },
    { label: "할 일·일정", href: weddingPath("/schedule") },
    { label: "예산", href: weddingPath("/budget") },
    { label: "커뮤니티", href: weddingPath() },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-[#243832]/8 bg-[#FBF8F2]/94 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className={`${shell} flex h-14 items-center justify-between gap-6 md:h-16`}>
        <Link
          href="/landing"
          className={`text-[#243832] ${focusRing} focus-visible:ring-offset-[#FBF8F2]`}
        >
          <span className="text-[20px] font-semibold tracking-normal">웨딩한방</span>
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`text-[14px] font-medium text-[#36534E]/85 transition-colors hover:text-[#243832] ${focusRing} focus-visible:ring-offset-[#FBF8F2]`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <details className="relative md:hidden">
            <summary
              aria-label="주요 메뉴 열기"
              title="메뉴"
              className={`flex h-10 w-10 cursor-pointer list-none items-center justify-center text-[#243832] [&::-webkit-details-marker]:hidden ${focusRing} focus-visible:ring-offset-[#FBF8F2]`}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </summary>
            <nav
              aria-label="모바일 주요 메뉴"
              className="absolute right-0 top-12 flex w-44 flex-col border border-[#243832]/12 bg-[#FBF8F2] p-2 shadow-[0_16px_40px_rgba(36,56,50,0.16)]"
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-3 text-[14px] font-semibold text-[#36534E] hover:bg-[#F3E9DD] ${focusRing} focus-visible:ring-offset-[#FBF8F2]`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </details>
          <Link
            href={amoraStartHref}
            className={`inline-flex min-h-10 items-center rounded-full bg-[#8F6662] px-5 text-[14px] font-semibold text-white transition-colors hover:bg-[#6F4F4B] ${focusRing} focus-visible:ring-offset-[#FBF8F2]`}
          >
            <span className="sm:hidden">아모라 대화</span>
            <span className="hidden sm:inline">아모라와 대화 시작</span>
          </Link>
        </div>
      </div>
    </header>
  );
}

/**
 * 증거 띠. Eucalyptus Ink 위에 큰 숫자만 놓는다 — 상자를 겹치지 않는다
 * (DESIGN.md: 카드 안에 카드 금지, "Dense lists need rhythm, not more borders").
 */
function ProofBand({ vendorCards }: { vendorCards: number }) {
  const stats = [
    {
      kind: "공개 가격 자료",
      value: vendorCards > 0 ? vendorCards.toLocaleString("ko-KR") : "집계 중",
      unit: vendorCards > 0 ? "개" : "",
      label: "한국소비자원 공개 자료의 업체별 가격 카드",
    },
    {
      kind: "취소·환불 규정",
      value: PUBLISHED_POLICY_COUNT.toLocaleString("ko-KR"),
      unit: "건",
      label: `${PUBLISHED_VENDOR_COUNT.toLocaleString("ko-KR")}개 업체의 취소·환불 규정 원문`,
    },
    {
      kind: "웨딩한방 추천 원칙",
      value: "0",
      unit: "개",
      label: "광고비로 순서를 바꾼 추천 영역",
    },
  ];

  const trustPromises = [
    "광고는 광고로 표시하고, 추천 순서에는 반영하지 않아요",
    "아모라 답변에는 AI가 만든 내용임을 표시해요",
    "출처 없는 가격을 만들지 않고, 계약의 안전·위험을 대신 판정하지 않아요",
  ];

  return (
    <section
      id="proof"
      className="scroll-mt-20 overflow-hidden bg-[#243832] text-white"
    >
      <div className={`${shell} py-20 md:py-28`}>
        <div className="grid gap-7 lg:grid-cols-[0.58fr_1.42fr] lg:gap-16">
          <div>
            <a
              href={DISCLOSURE_SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex text-[13px] font-medium text-white/85 underline decoration-white/35 underline-offset-4 transition-colors hover:text-white ${focusRingOnDark}`}
            >
              자료 출처 · 한국소비자원 참가격, {disclosureRoundLabel()} 게시 자료
            </a>
          </div>
          <div>
            <h2 className="max-w-3xl text-[34px] font-semibold leading-[1.08] tracking-[-0.02em] md:text-[48px]">
              준비는 함께,
              <br />
              선택은 공개된 근거로.
            </h2>
            <div className="mt-7 grid max-w-3xl gap-5 border-t border-white/14 pt-6 sm:grid-cols-2 sm:gap-8">
              <p className="text-[15px] font-normal leading-[1.75] text-white/82">
                <b className="mb-1.5 block font-semibold text-white">두 사람에게</b>
                출처와 게시 월이 붙은 가격·조건·취소·환불 규정으로 비교할 근거를
                보여드려요.
              </p>
              <p className="text-[15px] font-normal leading-[1.75] text-white/82">
                <b className="mb-1.5 block font-semibold text-white">웨딩 파트너에게</b>
                공개한 조건이 어떤 기준으로 보이는지 확인하고, 다른 내용은 바로
                수정 요청할 수 있게 해요.
              </p>
            </div>
          </div>
        </div>

        <dl className="mt-14 grid border-y border-white/14 md:mt-18 md:grid-cols-3">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="border-b border-white/12 py-8 last:border-b-0 md:border-b-0 md:border-l md:px-8 md:py-10 md:first:border-l-0 md:first:pl-0 md:last:pr-0"
            >
              <p className="mb-5 text-[11px] font-semibold tracking-normal text-[#E2D3C8]">
                {stat.kind}
              </p>
              <dt className="flex items-baseline gap-1">
                <span className="text-[50px] font-medium leading-none tracking-normal text-white md:text-[64px]">
                  {stat.value}
                </span>
                <span className="text-[18px] font-normal text-[#E2D3C8]">{stat.unit}</span>
              </dt>
              <dd className="mt-4 max-w-[29ch] text-[14px] font-normal leading-[1.7] text-white/80">
                {stat.label}
              </dd>
            </div>
          ))}
        </dl>

        <div
          id="trust"
          className="scroll-mt-20 border-b border-white/14 py-10 md:grid md:grid-cols-[0.58fr_1.42fr] md:gap-16 md:py-12"
        >
          <h3 className="max-w-md text-[24px] font-semibold leading-[1.25] tracking-[-0.015em] text-white md:text-[28px]">
            자료·광고·AI를
            <br />
            섞어 보여주지 않아요.
          </h3>
          <ul className="mt-8 border-t border-white/14 md:mt-0">
            {trustPromises.map((promise) => (
              <li
                key={promise}
                className="border-b border-white/12 py-5 text-[15px] font-medium text-white/88 last:border-b-0"
              >
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.42fr_0.58fr] lg:items-end lg:gap-16">
          <p className="max-w-3xl text-[12px] leading-[1.75] text-white/74">
            현재는 한국소비자원에 {disclosureRoundLabel()} 게시된 자료에 포함된 업체만
            보여드려요. 표시 금액은 기본 조건 기준이라 시즌·옵션에 따라 실제 계약가가
            달라질 수 있어요. 예약·결제·계약은 업체와 직접 진행해요.
          </p>
          <div className="flex flex-col gap-4 text-[13px] font-medium sm:flex-row lg:justify-end">
            <Link
              href="/price"
              className={`group inline-flex items-center gap-2 text-white transition-colors hover:text-[#E2D3C8] ${focusRingOnDark}`}
            >
              업체별 공개 가격·규정 찾기
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </Link>
            <a
              href={`mailto:${CONTACT.email}`}
              className={`text-white/82 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white ${focusRingOnDark}`}
            >
              업체 정보 수정·서비스 문의
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

const COUPLE_PREPARATION_FLOW = [
  {
    step: "01",
    title: "둘이 이야기해요",
    description:
      "커플 공동 채팅에서 서로의 메시지와 아모라 답변을 함께 봐요.",
  },
  {
    step: "02",
    title: "아모라가 바뀔 내용을 보여줘요",
    description:
      "대화에서 나온 예산·할 일·일정 변경을 적용 전에 하나씩 보여줘요.",
  },
  {
    step: "03",
    title: "확인한 것만 함께 남겨요",
    description:
      "‘이대로 적용’을 누른 변경과 저장한 답변·메모를 둘이 다시 봐요.",
  },
];

function AmoraSection() {
  return (
    <section
      id="amora"
      className="scroll-mt-20 border-t border-[#243832]/[0.06] bg-[#FBF8F2]"
    >
      <div className={`${shell} pb-20 pt-4 sm:pb-24 sm:pt-12 md:py-28`}>
        <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] lg:gap-20">
          <div className="min-w-0">
            <p className="mb-5 text-[12px] font-semibold text-[#8F6662]">
              함께 대화에서 준비 기록까지
            </p>
            <h2 className="max-w-xl text-[36px] font-semibold leading-[1.07] tracking-[-0.025em] text-[#243832] md:text-[48px]">
              말한 내용이
              <br />
              예산·할 일·일정으로 이어져요.
            </h2>
            <p className="mt-6 max-w-lg text-[16px] font-normal leading-[1.8] text-[#36534E]">
              둘이 같은 공동 채팅에서 이야기하면 아모라가 바뀔 내용을 먼저
              보여줘요. <b className="font-semibold text-[#243832]">&lsquo;나만 상담&rsquo;은
              서비스에 저장되지만 파트너에게 보이지 않아요.</b>
            </p>
          </div>

          <div aria-label="두 사람이 아모라와 함께 준비하는 방식">
            <ol className="border-y border-[#243832]/16">
              {COUPLE_PREPARATION_FLOW.map((item) => (
                <li
                  key={item.step}
                  className="grid gap-3 border-b border-[#243832]/12 py-6 last:border-b-0 sm:grid-cols-[2.5rem_minmax(0,0.9fr)_minmax(0,1.1fr)] sm:items-start sm:gap-5 sm:py-7"
                >
                  <span className="pt-1 text-[11px] font-semibold tabular-nums text-[#8F6662]">
                    {item.step}
                  </span>
                  <strong className="max-w-[19rem] text-[18px] font-semibold leading-[1.4] text-[#243832] sm:text-[20px]">
                    {item.title}
                  </strong>
                  <p className="text-[14px] leading-[1.75] text-[#36534E] sm:text-[15px]">
                    {item.description}
                  </p>
                </li>
              ))}
            </ol>
            <div className="mt-6 border-l-2 border-[#8F6662] pl-4">
              <p className="max-w-2xl text-[13px] leading-[1.75] text-[#36534E]">
                공유 예산·할 일·일정을 바꾸는 제안은 <b className="font-semibold text-[#243832]">함께 대화</b>에서만
                보여요. 아모라가 변경을 먼저 보여주고,{" "}
                <b className="font-semibold text-[#243832]">사용자가 승인한 내용만 반영</b>합니다.
                반영된 변경은 둘의 예산·할 일·일정에 함께 남아요.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ClosingCta() {
  return (
    <section
      aria-labelledby="landing-closing-title"
      className="border-b border-[#243832]/10 bg-[#F3E9DD] bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.65),transparent_55%)]"
    >
      <div className={`${shell} py-24 text-center md:py-32`}>
        <h2
          id="landing-closing-title"
          className="mx-auto max-w-4xl text-[36px] font-semibold leading-[1.07] tracking-[-0.025em] text-[#243832] md:text-[52px]"
        >
          이제 우리 둘의
          <br className="sm:hidden" />
          {" "}준비를 시작해요.
        </h2>
        <p className="mx-auto mt-6 max-w-xl text-[16px] font-normal leading-[1.8] text-[#36534E]/86">
          아모라와 이야기하고, 바뀔 내용을 확인한 뒤 우리 예산·할 일·일정에
          함께 남겨요.
        </p>
        <Link
          href={amoraStartHref}
          className={`group mx-auto mt-9 inline-flex min-h-[56px] max-w-full items-center gap-5 rounded-[18px] bg-[#8F6662] px-7 text-[16px] font-semibold text-white shadow-[0_12px_30px_rgba(143,102,98,0.2)] transition-colors duration-200 hover:bg-[#6F4F4B] sm:px-8 ${focusRing} focus-visible:ring-offset-[#F3E9DD]`}
        >
          우리 둘 준비 시작하기
          <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
        </Link>
        <Link
          href="/start-here"
          className={`mx-auto mt-5 flex min-h-11 w-fit items-center justify-center text-[14px] font-semibold text-[#36534E] underline decoration-[#36534E]/25 underline-offset-4 transition-colors hover:text-[#8F6662] ${focusRing} focus-visible:ring-offset-[#F3E9DD]`}
        >
          로그인 없이 준비 순서 먼저 보기
        </Link>
      </div>
    </section>
  );
}

const FOOTER_SERVICE_LINKS = [
  { label: "아모라 채팅", href: weddingPath("/chat") },
  { label: "할 일·일정", href: weddingPath("/schedule") },
  { label: "예산", href: weddingPath("/budget") },
  { label: "커뮤니티", href: weddingPath() },
];

const FOOTER_POLICY_LINKS = [
  { label: "이용약관", href: "/terms" },
  { label: "개인정보처리방침", href: "/privacy" },
  { label: "AI 서비스 정책", href: "/ai-policy" },
];

function SiteFooter() {
  return (
    <footer className="bg-[#F3E9DD]">
      <div className={`${shell} grid gap-12 py-16 md:grid-cols-[1.5fr_1fr_1fr] md:py-20`}>
        <div>
          <span className="text-[22px] font-semibold tracking-normal text-[#243832]">웨딩한방</span>
          <p className="mt-5 max-w-sm text-[14px] font-normal leading-[1.85] text-[#36534E]/86">
            두 사람이 커플 공동 채팅에서 아모라와 이야기하고, 승인한 변경만
            예산·할 일·일정에 반영하며 저장한 아모라 답변을 같이 다시 보는
            결혼 준비 서비스입니다.
          </p>
          <a
            href={`mailto:${CONTACT.email}`}
            className={`mt-6 inline-flex text-[13px] font-medium text-[#36534E] underline decoration-[#243832]/25 underline-offset-4 transition-colors hover:text-[#8F6662] ${focusRing} focus-visible:ring-offset-[#F3E9DD]`}
          >
            서비스·업체 정보 문의 {CONTACT.email}
          </a>
        </div>
        <FooterColumn title="서비스" items={FOOTER_SERVICE_LINKS} />
        <FooterColumn title="정책" items={FOOTER_POLICY_LINKS} />
      </div>
      <div className={`${shell} border-t border-[#243832]/12 py-7 text-[12px] font-normal leading-5 text-[#36534E]/82`}>
        © 2026 Wedding Hanbang. 가격 자료 출처:{" "}
        <a
          href={DISCLOSURE_SOURCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className={`underline decoration-[#243832]/25 underline-offset-4 hover:text-[#243832] ${focusRing} focus-visible:ring-offset-[#F3E9DD]`}
        >
          한국소비자원 참가격
        </a>
        {" "}· {disclosureRoundLabel()} 게시 자료.
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
              className={`text-[14px] font-normal text-[#36534E]/86 transition-colors hover:text-[#8F6662] ${focusRing} focus-visible:ring-offset-[#F3E9DD]`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
