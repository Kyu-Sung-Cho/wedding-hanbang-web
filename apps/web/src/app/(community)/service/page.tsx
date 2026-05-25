import Link from "next/link";
import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Bell,
  CalendarCheck,
  Check,
  ChevronRight,
  ClipboardCheck,
  LockKeyhole,
  MessageCircle,
  PanelsTopLeft,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  Users,
  Wallet,
} from "lucide-react";

export const metadata: Metadata = {
  title: "웨딩한방 서비스 소개 | 우리 둘의 결혼 준비 공간",
  description:
    "아모라 AI 상담, 예산 관리, 일정 체크리스트, 커플 공유 기록까지 개인과 커플이 함께 쓰는 웨딩한방 서비스 공간입니다.",
};

const shell = "mx-auto w-[calc(100%_-_48px)] max-w-[1300px]";

const serviceLinks: Array<{ icon: LucideIcon; title: string; desc: string; href: string; cta: string }> = [
  {
    icon: MessageCircle,
    title: "아모라 상담",
    desc: "견적, 업체 답변, 준비 순서를 대화로 정리해요.",
    href: "/chat",
    cta: "상담 열기",
  },
  {
    icon: Wallet,
    title: "예산 관리",
    desc: "전체 예산과 항목별 지출을 커플 기준으로 맞춰요.",
    href: "/budget",
    cta: "예산 보기",
  },
  {
    icon: CalendarCheck,
    title: "일정 관리",
    desc: "D-day까지 해야 할 일을 놓치지 않게 관리해요.",
    href: "/schedule",
    cta: "일정 보기",
  },
  {
    icon: PanelsTopLeft,
    title: "내 준비 현황",
    desc: "오늘 할 일, 진행률, 다음 결정을 한 화면에서 봐요.",
    href: "/dashboard",
    cta: "대시보드",
  },
];

const coupleModes: Array<{ icon: LucideIcon; title: string; desc: string }> = [
  {
    icon: UserRoundCheck,
    title: "혼자 정리하기",
    desc: "개인 고민, 업체 비교, 예산 메모를 먼저 조용히 정리해요.",
  },
  {
    icon: Users,
    title: "커플과 공유하기",
    desc: "같이 봐야 하는 결정만 공유하고 의견 차이는 기록으로 남겨요.",
  },
  {
    icon: ClipboardCheck,
    title: "결정으로 남기기",
    desc: "상담에서 끝나지 않게 예산, 일정, 체크리스트로 바로 연결해요.",
  },
];

const timeline = [
  { label: "오늘", title: "웨딩홀 견적 비교", state: "아모라 검토 중" },
  { label: "D-120", title: "스드메 계약 조건 확인", state: "커플 확인 필요" },
  { label: "D-90", title: "청첩장 문구 초안", state: "예약됨" },
];

export default function ServicePage() {
  return (
    <main className="bg-[linear-gradient(180deg,#fffdf7_0%,#ffffff_48%,#fbf8ee_100%)] text-[#061a34]">
      <Hero />
      <ServiceHub />
      <CoupleMode />
      <DecisionFlow />
      <TrustBand />
    </main>
  );
}

function Hero() {
  return (
    <section className={`${shell} grid min-h-[560px] grid-cols-1 items-center gap-8 py-8 lg:grid-cols-[0.88fr_1.12fr]`}>
      <div className="py-6">
        <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#eadfc9] bg-white/80 px-4 py-2 text-[13px] font-semibold text-[#9d6f36]">
          개인과 커플이 함께 쓰는 준비 공간
          <Sparkles className="h-4 w-4" />
        </p>
        <h1 className="font-serif-kr text-[38px] font-medium leading-[1.25] text-[#061a34] sm:text-[50px] xl:text-[58px]">
          결혼 준비를
          <br />
          둘만의 작업실에서 <span className="text-[#b68a3a]">차분하게</span>
        </h1>
        <p className="mt-6 max-w-[560px] text-[16px] font-medium leading-[1.9] text-[#38475c]">
          커뮤니티에서 정보를 찾았다면, 서비스 공간에서는 우리 예산과 일정,
          업체 답변과 결정 기록을 아모라와 함께 정리해요.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/dashboard"
            className="inline-flex min-h-12 items-center rounded-full bg-[#061a34] px-6 text-[14px] font-semibold text-white shadow-[0_14px_28px_rgba(6,26,52,0.18)]"
          >
            내 준비공간 열기
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
          <Link
            href="/chat"
            className="inline-flex min-h-12 items-center rounded-full border border-[#d8c7ad] bg-white/70 px-6 text-[14px] font-semibold text-[#061a34]"
          >
            아모라와 먼저 상담
          </Link>
        </div>
      </div>

      <div className="relative overflow-hidden rounded-[24px] border border-[#eadfc9] bg-white shadow-[0_22px_60px_rgba(8,22,38,0.08)]">
        <div className="flex items-center justify-between border-b border-[#eadfc9] bg-[#fffaf0] px-5 py-4">
          <div>
            <p className="text-[12px] font-semibold text-[#9d6f36]">Wedding Workspace</p>
            <h2 className="mt-1 font-serif-kr text-[24px] font-medium text-[#071629]">오늘의 준비실</h2>
          </div>
          <div className="flex -space-x-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#061a34] text-[13px] font-semibold text-white">
              나
            </span>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-[#c9a96e] text-[13px] font-semibold text-[#061a34]">
              짝
            </span>
          </div>
        </div>

        <div className="grid gap-4 p-5 lg:grid-cols-[1fr_0.92fr]">
          <section className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-5">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-[12px] font-semibold text-[#7a8290]">현재 진행률</p>
                <p className="mt-1 font-serif-kr text-[34px] font-medium leading-none text-[#071629]">42%</p>
              </div>
              <span className="rounded-full bg-[#061a34] px-3 py-1.5 text-[12px] font-semibold text-white">
                D-168
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-[#efe5d3]">
              <div className="h-full w-[42%] rounded-full bg-[#b68a3a]" />
            </div>
            <div className="mt-5 grid grid-cols-3 gap-3 text-center">
              {[
                ["오늘 할 일", "4"],
                ["결정 대기", "2"],
                ["예산 사용", "31%"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-[12px] bg-white px-3 py-4">
                  <p className="text-[11px] font-semibold text-[#7a8290]">{label}</p>
                  <p className="mt-1 text-[18px] font-semibold text-[#071629]">{value}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-[16px] border border-[#eadfc9] bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#071629]">아모라 메모</h3>
              <MessageCircle className="h-5 w-5 text-[#b68a3a]" />
            </div>
            <div className="space-y-3">
              <div className="rounded-[14px] bg-[#061a34] px-4 py-3 text-[13px] font-medium leading-[1.65] text-white">
                스드메 견적의 원본 포함 항목과 추가금 조건을 먼저 분리해볼게요.
              </div>
              <div className="rounded-[14px] bg-[#fff8ec] px-4 py-3 text-[13px] font-medium leading-[1.65] text-[#34445a]">
                커플에게 공유할 질문 3개를 체크리스트로 만들었어요.
              </div>
            </div>
          </section>

          <section className="rounded-[16px] border border-[#eadfc9] bg-white p-5 lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold text-[#071629]">다가오는 결정</h3>
              <Bell className="h-5 w-5 text-[#b68a3a]" />
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              {timeline.map((item) => (
                <div key={item.title} className="rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] p-4">
                  <p className="text-[12px] font-semibold text-[#9d6f36]">{item.label}</p>
                  <p className="mt-2 text-[14px] font-semibold text-[#071629]">{item.title}</p>
                  <p className="mt-2 text-[12px] font-medium text-[#7a8290]">{item.state}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function ServiceHub() {
  return (
    <section className={`${shell} py-4`}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-[#9d6f36]">바로 쓰는 기능</p>
          <h2 className="mt-1 font-serif-kr text-[28px] font-medium text-[#071629]">준비 흐름이 끊기지 않게 연결돼요.</h2>
        </div>
        <Link href="/demo" className="inline-flex items-center rounded-full border border-[#eadfc9] bg-white px-5 py-3 text-[13px] font-semibold text-[#9d6f36]">
          체험 화면 보기
          <ChevronRight className="ml-1 h-4 w-4" />
        </Link>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {serviceLinks.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className="group rounded-[18px] border border-[#eadfc9] bg-white/88 p-5 shadow-[0_10px_30px_rgba(8,22,38,0.045)] transition-transform hover:-translate-y-0.5"
          >
            <item.icon className="h-9 w-9 stroke-[1.55] text-[#b68a3a]" />
            <h3 className="mt-5 text-[17px] font-semibold text-[#071629]">{item.title}</h3>
            <p className="mt-2 min-h-[44px] text-[13px] font-medium leading-[1.65] text-[#5d6879]">{item.desc}</p>
            <span className="mt-5 inline-flex items-center text-[13px] font-semibold text-[#9d6f36]">
              {item.cta}
              <ChevronRight className="ml-1 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function CoupleMode() {
  return (
    <section className={`${shell} py-8`}>
      <div className="grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
        <div className="rounded-[20px] border border-[#eadfc9] bg-[#061a34] p-7 text-white shadow-[0_18px_44px_rgba(6,26,52,0.14)]">
          <p className="text-[13px] font-semibold text-[#ecd7a4]">개인 공간 + 커플 공간</p>
          <h2 className="mt-3 font-serif-kr text-[30px] font-medium leading-[1.35]">
            말로만 정리하지 말고,
            <br />
            결정이 남게 만들어요.
          </h2>
          <p className="mt-5 text-[14px] font-medium leading-[1.8] text-white/72">
            혼자 비교한 내용은 개인 기록으로, 같이 봐야 할 내용은 공유 결정으로 옮겨요.
            아모라는 대화의 맥락을 일정과 예산으로 이어줍니다.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {coupleModes.map((item) => (
            <article key={item.title} className="rounded-[18px] border border-[#eadfc9] bg-white/88 p-6">
              <item.icon className="h-9 w-9 stroke-[1.55] text-[#b68a3a]" />
              <h3 className="mt-5 text-[17px] font-semibold text-[#071629]">{item.title}</h3>
              <p className="mt-3 text-[13px] font-medium leading-[1.7] text-[#5d6879]">{item.desc}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function DecisionFlow() {
  return (
    <section className={`${shell} py-8`}>
      <div className="rounded-[22px] border border-[#eadfc9] bg-white/88 p-6 md:p-8">
        <div className="mb-7 text-center">
          <p className="text-[13px] font-semibold text-[#9d6f36]">아모라가 돕는 방식</p>
          <h2 className="mt-2 font-serif-kr text-[30px] font-medium text-[#071629]">상담, 기록, 실행이 한 흐름으로 이어져요.</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            ["묻기", "업체 답변, 견적서, 가족 의견을 아모라에게 물어봐요."],
            ["정리", "비용·조건·일정 리스크를 비교 가능한 기록으로 바꿔요."],
            ["실행", "결정된 내용은 예산, 일정, 체크리스트로 옮겨요."],
          ].map(([title, desc], index) => (
            <div key={title} className="relative rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-5">
              <span className="absolute right-5 top-5 text-[32px] font-semibold leading-none text-[#eadfc9]">0{index + 1}</span>
              <h3 className="text-[18px] font-semibold text-[#071629]">{title}</h3>
              <p className="mt-4 max-w-[280px] text-[13px] font-medium leading-[1.75] text-[#5d6879]">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustBand() {
  return (
    <section className={`${shell} pb-12 pt-5`}>
      <div className="grid gap-4 rounded-[22px] border border-[#eadfc9] bg-[#fffaf0] p-6 md:grid-cols-[1fr_1fr_1fr] md:p-7">
        {[
          { icon: ShieldCheck, title: "민감한 정보는 신중하게", desc: "개인정보와 예산, 가족 이야기는 필요한 곳에서만 다뤄요." },
          { icon: LockKeyhole, title: "개인 기록과 공유 기록 분리", desc: "혼자 남길 내용과 커플이 같이 볼 내용을 구분해요." },
          { icon: Check, title: "결정 근거 보존", desc: "왜 이 선택을 했는지 나중에도 다시 볼 수 있게 남겨요." },
        ].map((item) => (
          <article key={item.title} className="flex gap-4 rounded-[16px] bg-white/78 p-5">
            <item.icon className="mt-1 h-7 w-7 shrink-0 stroke-[1.55] text-[#b68a3a]" />
            <div>
              <h3 className="text-[15px] font-semibold text-[#071629]">{item.title}</h3>
              <p className="mt-2 text-[12px] font-medium leading-[1.65] text-[#5d6879]">{item.desc}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
