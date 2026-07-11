import Link from "next/link";
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  Building2,
  Calculator,
  CalendarCheck,
  Check,
  ClipboardList,
  FileSearch,
  Heart,
  Landmark,
  LockKeyhole,
  MessageCircle,
  MoreHorizontal,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import { BETA_TOTAL, getBetaCount } from "@/lib/beta-count";
import { CONTACT } from "@/lib/constants/contact";
import { shouldShowBetaCounter } from "@/constants/beta";
import { weddingPath } from "@/lib/weddingPaths";

export const revalidate = 60;

export const metadata = {
  title: "웨딩한방 — 당신만의 AI 웨딩 플래너, 아모라",
  description:
    "견적 검토, 업체 답변 분석, 예산 관리, 일정 저장까지 결혼 준비 흐름을 기억하는 AI 웨딩 플래너 아모라.",
};

const shell = "mx-auto w-[calc(100%_-_48px)] max-w-[1180px]";

const heroFeatures: Array<{ icon: LucideIcon; label: string }> = [
  { icon: Heart, label: "취향 분석" },
  { icon: MessageCircle, label: "컨설팅 & 조율" },
  { icon: ClipboardList, label: "일정 기록" },
  { icon: CalendarCheck, label: "준비 저장" },
];

const flowSteps: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  {
    icon: Heart,
    title: "커뮤니티 인사이트",
    desc: "실제 예비부부의 후기로 결혼을 먼저 확인해요.",
  },
  {
    icon: Target,
    title: "견적 검토",
    desc: "받은 견적서를 분석해 비교하고 조율해요.",
  },
  {
    icon: MessageCircle,
    title: "업체 답변 분석",
    desc: "업체의 답변을 요약하고 맞춤형 질문을 제안해요.",
  },
  {
    icon: Calculator,
    title: "예산 입력함",
    desc: "항목별 비용을 분석해 예산을 잡아줘요.",
  },
  {
    icon: CalendarCheck,
    title: "다음 할 일 / 일정",
    desc: "놓치기 쉬운 계약과 일정을 알려드려요.",
  },
];

export default async function LandingPage() {
  const betaCount = await getBetaCount();
  const betaPct = getBetaProgressClass(betaCount);

  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_54%,#fbf8ee_100%)] text-[#243044]">
      <SiteHeader />
      <HeroSection />
      <FlowSection />
      <FeatureCards />
      <ConnectedSection />
      <BetaBanner betaCount={betaCount} betaPct={betaPct} />
      <OpenStrip />
      <SiteFooter />
    </main>
  );
}

function getBetaProgressClass(count: number) {
  const percent = Math.round((Math.min(count, BETA_TOTAL) / BETA_TOTAL) * 100);
  if (percent >= 100) return "w-full";
  if (percent >= 80) return "w-[80%]";
  if (percent >= 60) return "w-[60%]";
  if (percent >= 40) return "w-[40%]";
  if (percent >= 25) return "w-[25%]";
  if (percent >= 15) return "w-[15%]";
  if (percent >= 10) return "w-[10%]";
  return "w-[6%]";
}

function SiteHeader() {
  const nav = [
    { href: weddingPath(), label: "커뮤니티" },
    { href: weddingPath("/market-prices"), label: "시세 정보" },
    { href: weddingPath("/etiquette"), label: "꿀팁·체험" },
    { href: "/about", label: "소개" },
    { href: "/beta", label: "베타 신청" },
  ];

  return (
    <header className={`${shell} flex h-[76px] items-center justify-between`}>
      <Brand />

      <nav className="hidden items-center gap-7 text-[14px] font-bold text-[#141f31] lg:flex">
        {nav.slice(0, -1).map((item) => (
          <Link key={item.href} href={item.href} className="transition-colors hover:text-[#b68a3a]">
            {item.label}
          </Link>
        ))}
        <Link
          href="/beta"
          className="rounded-full bg-[#061a34] px-[18px] py-[10px] text-[13px] text-[#ecd7a4] shadow-[0_10px_24px_rgba(6,26,52,0.16)] transition-transform hover:-translate-y-0.5"
        >
          아모라 체험하기
        </Link>
      </nav>
    </header>
  );
}

function Brand({ muted = false }: { muted?: boolean }) {
  return (
    <Link href="/landing" className="inline-flex items-center gap-[10px] whitespace-nowrap">
      <span className="relative inline-block h-6 w-[34px] shrink-0" aria-hidden>
        <span className="absolute left-0 top-[3px] h-[18px] w-[21px] rotate-[-22deg] rounded-full border-[2.4px] border-[#b68a3a]" />
        <span className="absolute right-0 top-[3px] h-[18px] w-[21px] rotate-[22deg] rounded-full border-[2.4px] border-[#b68a3a]" />
      </span>
      <span className={`text-[24px] font-extrabold ${muted ? "text-[#071629]" : "text-[#071629]"}`}>
        웨딩한방
      </span>
    </Link>
  );
}

function HeroSection() {
  return (
    <section className={`${shell} relative mt-3 grid min-h-[470px] grid-cols-1 items-center gap-8 lg:grid-cols-[0.93fr_1.07fr]`}>
      <div className="relative z-10 py-8">
        <p className="mb-[22px] flex items-center gap-2 text-[16px] font-bold text-[#26364a]">
          당신의 결혼 준비를 가장 잘 아는 AI
          <Sparkles className="h-4 w-4 text-[#b68a3a]" />
        </p>

        <h1 className="font-serif-kr text-[42px] font-bold leading-[1.18] text-[#061a34] sm:text-[52px] lg:text-[62px]">
          당신만의
          <br />
          AI 웨딩 플래너, <span className="text-[#b68a3a]">아모라</span>
        </h1>

        <p className="my-7 text-[16px] font-medium leading-[1.9] text-[#38475c]">
          당신의 취향을 발견하고, 예산에 맞춤을 조율하며,
          <br />
          결정한 내용을 기억하고, 오래 사용할 정보로 안내해드려요.
        </p>

        <div className="mb-[26px] grid max-w-[500px] grid-cols-2 gap-1 sm:grid-cols-4">
          {heroFeatures.map((item, index) => (
            <div
              key={item.label}
              className={`flex min-h-[72px] flex-col items-center justify-center gap-[9px] pr-3 text-[13px] font-bold text-[#34445a] ${
                index < heroFeatures.length - 1 ? "sm:border-r sm:border-[#eadfc9]" : ""
              }`}
            >
              <item.icon className="h-9 w-9 stroke-[1.5] text-[#b68a3a]" />
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-[18px]">
          <Link
            href="/beta"
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#061a34] px-6 text-[15px] font-extrabold text-white shadow-[0_14px_28px_rgba(6,26,52,0.18)] transition-transform hover:-translate-y-0.5"
          >
            빠른 시작하기
            <ArrowRight className="ml-3 h-4 w-4" />
          </Link>
          <Link
            href="/demo"
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#b68a3a] bg-white/60 px-7 text-[15px] font-extrabold text-[#061a34] transition-transform hover:-translate-y-0.5"
          >
            미리 체험하기
          </Link>
        </div>
      </div>

      <div className="relative min-h-[400px] self-stretch overflow-hidden rounded-bl-[64px] bg-[url('/images/amora-hero-bouquet-custom.png')] bg-cover bg-[position:center_48%] shadow-[inset_24px_0_44px_rgba(255,253,247,0.82)] max-lg:rounded-[28px]">
        <div className="absolute inset-y-0 left-0 w-[23%] bg-[linear-gradient(90deg,#fffdf7,rgba(255,253,247,0))]" />
        <div className="absolute bottom-[68px] left-[44%] w-[280px] border border-[#e8dcc8] bg-[#f7efe2]/95 px-9 py-7 text-center shadow-[0_14px_34px_rgba(38,32,24,0.12)] max-sm:left-1/2 max-sm:w-[220px] max-sm:-translate-x-1/2">
          <p className="font-display text-[42px] leading-none text-[#9d6f36]">Amora</p>
          <p className="mt-2 font-jakarta text-[9px] font-semibold uppercase text-[#8d7c64]">
            AI Wedding Planner
          </p>
        </div>
      </div>
    </section>
  );
}

function FlowSection() {
  return (
    <section className={`${shell} pt-11`}>
      <h2 className="mb-7 text-center font-serif-kr text-[28px] font-semibold text-[#071629]">
        웨딩한방 아모라가 함께하는 <span className="text-[#b68a3a]">결혼 준비 흐름</span>
      </h2>

      <div className="grid grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_28px_1fr_28px_1fr_28px_1fr_28px_1fr]">
        {flowSteps.map((step, index) => (
          <FragmentWithArrow key={step.title} showArrow={index < flowSteps.length - 1}>
            <article className="relative min-h-[166px] rounded-[18px] border border-[#f2eadc] bg-white/90 px-4 pb-5 pt-[26px] text-center shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
              <span className="absolute left-4 top-4 inline-flex h-[25px] w-[25px] items-center justify-center rounded-full bg-[linear-gradient(135deg,#ecd7a4,#b68a3a)] text-[13px] font-black text-[#553d16]">
                {index + 1}
              </span>
              <step.icon className="mx-auto mb-4 mt-[14px] h-12 w-12 stroke-[1.5] text-[#b68a3a]" />
              <h3 className="mb-2 text-[17px] font-black text-[#071629]">{step.title}</h3>
              <p className="text-[13px] font-semibold leading-[1.55] text-[#5d6676]">{step.desc}</p>
            </article>
          </FragmentWithArrow>
        ))}
      </div>
    </section>
  );
}

function FragmentWithArrow({
  children,
  showArrow,
}: {
  children: ReactNode;
  showArrow: boolean;
}) {
  return (
    <>
      {children}
      {showArrow && (
        <div className="hidden text-center font-serif-kr text-[42px] leading-none text-[#b68a3a] lg:block">
          ›
        </div>
      )}
    </>
  );
}

function FeatureCards() {
  return (
    <section className={`${shell} pt-9`}>
      <div className="grid grid-cols-1 gap-[18px] md:grid-cols-2 xl:grid-cols-4">
        <article className="min-h-[410px] rounded-[18px] border border-[#f2eadc] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,251,243,0.88))] px-6 pb-[22px] pt-[26px] text-center shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
          <span className="mb-3 block text-[15px] font-black text-[#b68a3a]">01</span>
          <h3 className="mb-3 font-serif-kr text-[22px] font-semibold leading-[1.35] text-[#2a2118]">
            받은 견적 확인하기
          </h3>
          <p className="mx-auto mb-[22px] text-[13px] font-semibold leading-[1.7] text-[#596477]">
            업체에 받은 견적서를 분석해 비교하고,
            <br />
            항목·시세의 기준을 드려요.
          </p>

          <div className="min-h-[175px] rounded-2xl border border-[#f2eadc] bg-white/90 px-4 py-[18px] text-left">
            <h4 className="mb-[13px] text-[14px] font-black text-[#061a34]">견적 요약</h4>
            {[
              ["한복점", "25,000,000원", "+23%", "up"],
              ["예식홀", "13,000,000원", "+10%", "up"],
              ["드레스", "2,000,000원", "-5%", "down"],
              ["메이크업", "3,000,000원", "+8%", "down"],
            ].map(([name, amount, delta, tone]) => (
              <div
                key={name}
                className="grid grid-cols-[1fr_auto_36px] items-center gap-2 border-b border-dashed border-[#efe5d5] py-[7px] text-[12px] text-[#566172] last:border-b-0"
              >
                <span>{name}</span>
                <b className="text-[12px] font-extrabold text-[#30394a]">{amount}</b>
                <em
                  className={`inline-flex min-w-[34px] justify-center rounded-full px-[7px] py-1 text-[11px] font-black not-italic ${
                    tone === "up" ? "bg-[#fbefd6] text-[#956622]" : "bg-[#edf6ed] text-[#40724f]"
                  }`}
                >
                  {delta}
                </em>
              </div>
            ))}
          </div>

          <CardLink />
        </article>

        <article className="min-h-[410px] rounded-[18px] border border-[#f2eadc] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,251,243,0.88))] px-6 pb-[22px] pt-[26px] text-center shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
          <span className="mb-3 block text-[15px] font-black text-[#b68a3a]">02</span>
          <h3 className="mb-3 font-serif-kr text-[22px] font-semibold leading-[1.35] text-[#2a2118]">
            업체 답변 같이 해석하기
          </h3>
          <p className="mx-auto mb-[22px] text-[13px] font-semibold leading-[1.7] text-[#596477]">
            업체 답변의 숨은 의미까지 도출하여
            <br />
            다시 물어볼 문장을 드려요.
          </p>

          <div className="relative min-h-[175px] rounded-2xl border border-[#f2eadc] bg-white/90 px-4 py-[18px] text-left">
            <h4 className="mb-[13px] text-[14px] font-black text-[#061a34]">답변 요약</h4>
            <p className="rounded-xl bg-[#f8f4ec] p-3 text-[12px] font-semibold leading-[1.6] text-[#556274]">
              실제 리허설 진행률이 최종 확정됩니다. 계약 전에 기준으로 묻기가 필요해요.
            </p>
            <div className="mt-3 rounded-[13px] bg-[linear-gradient(135deg,rgba(240,224,191,0.55),rgba(255,255,255,0.8))] p-[13px] text-[12px] font-semibold leading-[1.55] text-[#4b5665]">
              <b className="mb-1 block text-[#b68a3a]">아모라의 해석</b>
              10% 이상 답변을 고정해 계약 후 추가비를 줄일 수 있어요.
            </div>
            <div className="absolute bottom-2 right-3 h-[46px] w-[46px] rounded-full border-[3px] border-white bg-[radial-gradient(circle_at_50%_28%,#f4c7aa_0_11px,transparent_12px),radial-gradient(circle_at_50%_46%,#33241d_0_20px,transparent_21px),radial-gradient(circle_at_50%_80%,#f4f0e8_0_18px,transparent_19px)] shadow-[0_8px_18px_rgba(38,32,24,0.12)]" />
          </div>

          <CardLink />
        </article>

        <article className="min-h-[410px] rounded-[18px] border border-[#f2eadc] bg-[linear-gradient(180deg,rgba(252,255,248,0.96),rgba(255,251,242,0.9))] px-6 pb-[22px] pt-[26px] text-center shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
          <span className="mb-3 block text-[15px] font-black text-[#b68a3a]">03</span>
          <h3 className="mb-3 font-serif-kr text-[22px] font-semibold leading-[1.35] text-[#2a2118]">
            예산에 바로 반영하기
          </h3>
          <p className="mx-auto mb-[22px] text-[13px] font-semibold leading-[1.7] text-[#596477]">
            항목별 비용을 예산에 바로 반영하여
            <br />
            전체 흐름을 한눈에 볼 수 있어요.
          </p>

          <div className="min-h-[175px] rounded-2xl border border-[#f2eadc] bg-white/90 px-4 py-[18px] text-left">
            <h4 className="mb-[13px] text-[14px] font-black text-[#061a34]">예산 현황</h4>
            <div className="mb-2 flex items-center justify-between text-[12px] font-black text-[#061a34]">
              <span>68%</span>
              <span>45,000,000원</span>
            </div>
            <div className="mb-[14px] h-[9px] overflow-hidden rounded-full bg-[#ece7dc]">
              <span className="block h-full w-[68%] rounded-full bg-[linear-gradient(90deg,#061a34,#b68a3a)]" />
            </div>
            {[
              ["예식 지출", "31,500,000원"],
              ["확정 금액", "24,600,000원"],
              ["남은 금액", "21,900,000원"],
            ].map(([label, amount]) => (
              <div key={label} className="flex items-center justify-between py-[5px] text-[12px] text-[#566172]">
                <span>{label}</span>
                <b className="font-bold text-[#2e3849]">{amount}</b>
              </div>
            ))}
          </div>

          <CardLink />
        </article>

        <article className="min-h-[410px] rounded-[18px] border border-[#f2eadc] bg-[linear-gradient(180deg,rgba(255,255,255,0.96),rgba(255,251,243,0.88))] px-6 pb-[22px] pt-[26px] text-center shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
          <span className="mb-3 block text-[15px] font-black text-[#b68a3a]">04</span>
          <h3 className="mb-3 font-serif-kr text-[22px] font-semibold leading-[1.35] text-[#061a34]">
            다음 할 일 놓치지 않기
          </h3>
          <p className="mx-auto mb-[22px] text-[13px] font-semibold leading-[1.7] text-[#596477]">
            우선순위 기준으로 다음 할 일을 정하고,
            <br />
            일정별 알림을 설정해 드려요.
          </p>

          <div className="min-h-[175px] rounded-2xl border border-[#f2eadc] bg-white/90 px-4 py-[18px] text-left">
            <h4 className="mb-[13px] text-[14px] font-black text-[#061a34]">다음 할 일</h4>
            {[
              ["스드메 계약 완료", "D-3"],
              ["촬영장 샘플 선택 완료", "D-7"],
              ["예식 진행 확정", "D-12"],
            ].map(([label, day]) => (
              <label
                key={label}
                className="grid grid-cols-[18px_1fr_auto] items-center gap-[6px] border-b border-[#f0e8dc] py-[10px] text-[12px] font-bold text-[#535f72] last:border-b-0"
              >
                <span className="h-[14px] w-[14px] rounded-full border border-[#9da8b6] bg-white" />
                <span>{label}</span>
                <b className="text-[#061a34]">{day}</b>
              </label>
            ))}
          </div>

          <CardLink />
        </article>
      </div>
    </section>
  );
}

function CardLink() {
  return (
    <Link href={weddingPath()} className="mt-[18px] inline-flex items-center gap-2 text-[13px] font-black text-[#061a34]">
      자세히 보기
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  );
}

function ConnectedSection() {
  return (
    <section className={`${shell} pt-9`}>
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-[1.27fr_0.98fr]">
        <article className="grid min-h-[282px] grid-cols-1 gap-[22px] rounded-[18px] border border-[#f2eadc] bg-white/90 p-[26px] shadow-[0_10px_26px_rgba(8,22,38,0.06)] md:grid-cols-[1.05fr_0.85fr]">
          <div>
            <h2 className="mb-3 font-serif-kr text-[23px] font-semibold text-[#071629]">
              실제 커뮤니티와 시세 정보가 연결돼요.
            </h2>
            <p className="text-[13px] font-semibold leading-[1.8] text-[#5d6879]">
              한국소비자원 공공 시세와 검증된 준비 가이드를 기반으로
              더 정확한 의사결정을 도와드려요.
            </p>

            <div className="mt-[38px] grid grid-cols-3 gap-[14px] border-t border-[#eadfc9] pt-6">
              {[
                { icon: FileSearch, label: "예절·준비 가이드", value: "25", suffix: "개 주제" },
                { icon: Landmark, label: "숨은 추가금 체크", value: "48", suffix: "개 항목" },
                { icon: Building2, label: "공공기관 시세", value: "14", suffix: "개 지역" },
              ].map((metric, index) => (
                <div
                  key={metric.label}
                  className={`text-center ${index < 2 ? "border-r border-[#eadfc9]" : ""}`}
                >
                  <span className="mx-auto mb-[10px] inline-flex h-[42px] w-[42px] items-center justify-center rounded-full border border-[#eadfc9] bg-[#fffdf7] text-[#b68a3a]">
                    <metric.icon className="h-5 w-5 stroke-[1.5]" />
                  </span>
                  <span className="mb-[5px] block text-[12px] font-bold text-[#6c7584]">{metric.label}</span>
                  <strong className="text-[20px] font-black text-[#061a34]">{metric.value}</strong>
                  <em className="text-[12px] not-italic text-[#4f5b6c]">{metric.suffix}</em>
                </div>
              ))}
            </div>
          </div>

          <div className="self-center rounded-[17px] border border-[#f2eadc] bg-white p-4 shadow-[0_10px_24px_rgba(8,22,38,0.05)]">
            <div className="mb-3 flex gap-[11px] text-[11px] font-extrabold text-[#7a8290]">
              <b className="text-[#061a34]">전체</b>
              <span>웨딩홀</span>
              <span>스드메</span>
              <span>예물</span>
              <span>한복</span>
            </div>
            {[
              ["서울 평균?", "아모라웨딩홀 후기 67건 평균 시세 72,000원대"],
              ["예물 2024 트렌드", "반지 디자인 TOP 5 공개"],
              ["예산 공개", "예식홀 비용 26,800,000원"],
            ].map(([title, desc]) => (
              <div key={title} className="mb-2 rounded-xl bg-[#f8f7f3] p-3 last:mb-0">
                <b className="mb-1 block text-[12px] text-[#061a34]">{title}</b>
                <span className="block text-[12px] leading-[1.55] text-[#5d6777]">{desc}</span>
              </div>
            ))}
            <Link href={weddingPath()} className="mt-1 inline-flex text-[12px] font-black text-[#061a34]">
              자세히 보기
            </Link>
          </div>
        </article>

        <article className="relative min-h-[282px] rounded-[18px] border border-[#f2eadc] bg-white/90 px-[30px] pb-6 pt-[30px] shadow-[0_10px_26px_rgba(8,22,38,0.06)]">
          <MoreHorizontal className="absolute right-6 top-6 h-5 w-5 text-[#061a34]" />
          <h2 className="mb-3 font-serif-kr text-[23px] font-semibold text-[#061a34]">
            아모라와 대화해 보세요.
          </h2>
          <p className="text-[13px] font-semibold leading-[1.8] text-[#5d6879]">
            글로 준비의 고민, 아모라와 함께 해결해보세요.
          </p>

          <div className="mt-[26px]">
            <div className="ml-auto max-w-[280px] rounded-[18px] rounded-br-md bg-[#061a34] px-[18px] py-4 text-[14px] font-extrabold leading-[1.55] text-white">
              현재 150명 기준 예산을 45,000,000원으로 잡고 있어요.
            </div>
            <div className="mt-[18px] flex items-end gap-3">
              <div className="h-11 w-11 shrink-0 rounded-full border-[3px] border-white bg-[radial-gradient(circle_at_50%_28%,#f4c7aa_0_11px,transparent_12px),radial-gradient(circle_at_50%_46%,#33241d_0_20px,transparent_21px),radial-gradient(circle_at_50%_80%,#f4f0e8_0_18px,transparent_19px)] shadow-[0_8px_18px_rgba(38,32,24,0.12)]" />
              <div className="max-w-[280px] rounded-[18px] rounded-bl-md bg-[#f7f4ee] px-[18px] py-4 text-[14px] font-extrabold leading-[1.55] text-[#495465]">
                예산이 맞는 항목별 추천과 우선순위를 정리해 드릴게요.
              </div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-[10px]">
            {["스드메 예산 추천", "예식 일정 확인", "촬영장 추천"].map((chip) => (
              <button
                key={chip}
                type="button"
                className="h-9 rounded-full border border-[#d9e0ea] bg-white px-4 text-[12px] font-black text-[#061a34]"
              >
                {chip}
              </button>
            ))}
          </div>
        </article>
      </div>
    </section>
  );
}

function BetaBanner({ betaCount, betaPct }: { betaCount: number; betaPct: string }) {
  const showCounter = shouldShowBetaCounter(betaCount);

  return (
    <section className={`${shell} mt-[38px] grid min-h-[206px] grid-cols-1 items-center gap-7 rounded-[18px] bg-[radial-gradient(circle_at_91%_8%,rgba(236,215,164,0.22),transparent_18rem),linear-gradient(135deg,#07192f_0%,#0b2444_62%,#06172c_100%)] px-9 py-[30px] text-white shadow-[0_22px_52px_rgba(6,26,52,0.24)] lg:grid-cols-[1.18fr_1.1fr_1.1fr]`}>
      <div>
        <span className="text-[13px] font-black text-[#d3af67]">함께 만들어가는 AI 스마트한 결혼 준비</span>
        <h2 className="my-3 font-serif-kr text-[32px] font-bold leading-[1.3]">
          6주간 함께해 주실
          <br />
          50쌍을 초대합니다
        </h2>
        <p className="text-[13px] font-semibold leading-[1.7] text-white/75">
          웨딩한방의 새로운 추천을 가장 먼저 경험하고,
          아모라의 예산·일정 안내를 사용해보세요.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-[18px] border-y border-[#ecd7a4]/25 py-6 lg:border-x lg:border-y-0 lg:px-[26px] lg:py-0">
        <h3 className="col-span-3 text-[14px] font-black text-[#d3af67]">베타 참여 혜택</h3>
        {[
          { icon: CalendarCheck, title: "아모라 프리미엄", desc: "6주 무료 체험" },
          { icon: Search, title: "견적 1:1", desc: "온라인 상담" },
          { icon: Check, title: "우선 가입 혜택", desc: "베타 멤버 혜택" },
        ].map((benefit) => (
          <div key={benefit.title} className="text-center">
            <span className="mx-auto mb-[10px] inline-flex h-[52px] w-[52px] items-center justify-center rounded-full border border-[#ecd7a4]/50 bg-white/[0.04] text-[#d3af67]">
              <benefit.icon className="h-6 w-6 stroke-[1.5]" />
            </span>
            <b className="block text-[12px] text-white/85">{benefit.title}</b>
            <span className="text-[11px] text-white/60">{benefit.desc}</span>
          </div>
        ))}
      </div>

      <div className="relative min-h-[140px]">
        {showCounter ? (
          <>
            <span className="text-[13px] font-black text-[#d3af67]">현재 신청 현황</span>
            <strong className="my-3 block text-[44px] font-bold leading-none">
              {betaCount}
              <em className="text-[20px] font-bold not-italic text-white/85"> / {BETA_TOTAL}쌍</em>
            </strong>
            <div className="mb-[10px] h-2 w-[170px] overflow-hidden rounded-full bg-white/15">
              <span className={`block h-full rounded-full bg-[linear-gradient(90deg,#ffffff,#b68a3a)] ${betaPct}`} />
            </div>
          </>
        ) : (
          <span className="block text-[13px] font-black leading-relaxed text-[#d3af67]">
            베타 신청 접수 중
          </span>
        )}
        <p className="text-[12px] font-semibold text-white/70">베타 기간 | 6.25 - 8.07</p>

        <div className="absolute bottom-1 right-2 h-24 w-[152px] rotate-[-10deg] rounded-[10px] border border-[#ecd7a4]/60 bg-[linear-gradient(145deg,#fffdf5,#eee2c9)] shadow-[0_18px_38px_rgba(0,0,0,0.26)] before:absolute before:inset-0 before:rounded-[inherit] before:bg-[linear-gradient(180deg,rgba(255,255,255,0.84),rgba(222,202,165,0.55))] before:[clip-path:polygon(0_0,50%_55%,100%_0)] after:absolute after:left-[62px] after:top-[38px] after:h-[27px] after:w-[27px] after:rounded-full after:bg-[linear-gradient(135deg,#d3af67,#b68a3a)] max-sm:relative max-sm:bottom-auto max-sm:right-auto max-sm:mt-5" />
      </div>
    </section>
  );
}

function OpenStrip() {
  return (
    <section className={`${shell} mt-7 grid min-h-28 grid-cols-1 items-center gap-[22px] rounded-2xl border border-[#f2eadc] bg-[linear-gradient(90deg,#f9f1df,#fff9ee_48%,#ffffff)] px-7 py-5 shadow-[0_10px_26px_rgba(8,22,38,0.06)] lg:grid-cols-[auto_1fr_auto]`}>
      <div className="relative h-[54px] w-[54px] rounded-[15px] bg-[linear-gradient(135deg,#d3af67,#b68a3a)]">
        <LockKeyhole className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 text-[#fff8e8]" />
      </div>
      <div>
        <h2 className="mb-[6px] text-[20px] font-black text-[#071629]">서비스는 곧 오픈됩니다</h2>
        <p className="text-[13px] font-semibold leading-[1.6] text-[#5d6878]">
          신청 후 오픈 알림을 받아보실 수 있어요.
          가장 빠른 초대와 혜택을 놓치지 마세요.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link
          href="/beta"
          className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#d3af67] bg-white px-6 text-[15px] font-extrabold text-[#061a34]"
        >
          오픈 알림 신청하기
          <Bell className="ml-3 h-4 w-4" />
        </Link>
        <Link
          href="/demo"
          className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#061a34] px-6 text-[15px] font-extrabold text-white"
        >
          서비스 미리 사용하기
          <ArrowRight className="ml-3 h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className={`${shell} relative grid gap-[26px] border-t border-[#eadfc9] bg-white py-7 pb-[46px] md:grid-cols-2 xl:grid-cols-[1.35fr_0.72fr_0.92fr_0.94fr_1.55fr]`}>
      <div>
        <Brand muted />
        <p className="my-3 text-[13px] font-bold text-[#647083]">
          AI가 기억하는 가장 든든한 결혼 준비
        </p>
        <a
          href={CONTACT.instagramHref}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-[34px] items-center justify-center rounded-full border border-[#d8deea] px-3 text-[12px] font-black text-[#061a34]"
        >
          Instagram
        </a>
      </div>

      <FooterCol title="서비스" items={[
        { label: "커뮤니티", href: weddingPath() },
        { label: "시세 정보", href: weddingPath("/market-prices") },
        { label: "결혼 예절", href: weddingPath("/etiquette") },
        { label: "소개", href: "/about" },
      ]} />
      <FooterCol title="정책" items={[
        { label: "이용약관", href: "/terms" },
        { label: "개인정보처리방침", href: "/privacy" },
        { label: "AI 정책", href: "/ai-policy" },
      ]} />
      <div className="flex flex-col gap-2">
        <h3 className="mb-2 text-[14px] font-black text-[#071629]">연락</h3>
        <span className="text-[13px] font-semibold text-[#5b6676]">{CONTACT.email}</span>
        <span className="text-[13px] font-semibold text-[#5b6676]">{CONTACT.hours}</span>
      </div>

      <div className="rounded-[15px] border border-[#f2eadc] bg-[#fffdf7] px-5 py-[18px] md:col-span-2 xl:col-span-1">
        <h3 className="mb-2 text-[14px] font-black text-[#071629]">AI 기반 서비스 고지</h3>
        <p className="text-[12px] font-semibold leading-[1.7] text-[#5b6676]">
          웨딩한방은 AI 기반 추천 및 상담 서비스를 제공합니다. 계약 전 최종 확인과
          중요한 결정은 사용자 본인의 검토를 거쳐야 합니다.
        </p>
      </div>

      <p className="absolute bottom-[15px] left-1/2 -translate-x-1/2 text-[12px] text-[#9aa2af]">
        © 2026 Weddinghanbang. All rights reserved.
      </p>
    </footer>
  );
}

function FooterCol({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="mb-2 text-[14px] font-black text-[#071629]">{title}</h3>
      {items.map((item) => (
        <Link key={item.href} href={item.href} className="text-[13px] font-semibold text-[#5b6676]">
          {item.label}
        </Link>
      ))}
    </div>
  );
}
