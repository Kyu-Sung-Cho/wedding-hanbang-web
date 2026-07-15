import Link from "next/link";
import { BarChart3, BookOpen, Compass, ListChecks, MessageCircle, ShieldCheck, Users, WalletCards } from "lucide-react";
import { weddingLinkProps } from "@/lib/weddingPaths";

const COPY = {
  vendor: {
    eyebrow: "TRUST BEFORE CATALOG",
    title: "업체 탐색은 현재 제공하지 않아요",
    description:
      "업체 정보의 출처·최신성·연결 가능 여부를 검증하지 못해 제공하지 않습니다. 재개 여부와 시점은 정해지지 않았어요. 지금은 출처가 표시된 시세 자료와 이용자 작성 경험을 구분해 참고해 주세요.",
    primary: { label: "웨딩 라운지로", href: "/lounge", icon: Compass },
    secondary: { label: "근거가 표시된 시세 보기", href: "/market-prices", icon: BarChart3 },
  },
  booking: {
    eyebrow: "DIRECT CONTRACT ONLY",
    title: "웨딩한방에서는 예약을 받지 않아요",
    description:
      "웨딩한방의 베타 예약 화면은 실제 업체 접수·계약 상태를 증명하지 않습니다. 예약과 계약은 업체가 발급한 안내와 계약서를 기준으로 직접 확인해 주세요.",
    primary: { label: "웨딩 라운지로", href: "/lounge", icon: Compass },
    secondary: { label: "근거가 표시된 시세 보기", href: "/market-prices", icon: BarChart3 },
  },
  cohort: {
    eyebrow: "PRIVATE ROOMS RETIRED",
    title: "동기방은 현재 제공하지 않아요",
    description:
      "예식 시기·메시지·계약 금액을 한 방에 모으는 기능은 개인정보, 표본 보호와 운영 검증이 끝나지 않아 제공하지 않습니다. 재개 여부와 시점은 정해지지 않았어요. 공개 커뮤니티 글도 이용자 작성 정보로 보고 필요한 사실은 직접 확인해 주세요.",
    primary: { label: "커뮤니티로", href: "/community", icon: Users },
    secondary: { label: "아모라에게 질문 정리", href: "/chat", icon: MessageCircle },
  },
  quoteChecklist: {
    eyebrow: "NEW CHECKS RETIRED",
    title: "견적 체크는 현재 신규 제공하지 않아요",
    description:
      "받은 견적을 여러 항목에 다시 옮기는 방식은 실제 계약 절차와 맞지 않고 충분한 판단 근거가 될 수 없어 종료했습니다. 일정·예산은 직접 기록하고, 견적서·계약서 원문에서 확인할 질문은 아모라와 정리해 주세요. 최종 포함 범위와 금액은 업체 원문과 서명 전 계약서로 직접 확인해야 합니다.",
    primary: { label: "원문 기준 질문 정리하기", href: "/chat", icon: MessageCircle },
    secondary: { label: "내 예산 기록 보기", href: "/budget", icon: WalletCards },
  },
  weddingCode: {
    eyebrow: "HUMAN VALIDATION PENDING",
    title: "웨딩코드는 현재 제공하지 않아요",
    description:
      "질문과 결과 해석이 다양한 커플에게 실제로 유용하고 오해를 만들지 않는지 사람 대상 검증이 끝나지 않았습니다. 검증 전 결과를 성향이나 준비 방식의 정답처럼 보여주지 않겠습니다. 지금은 필요한 일정과 체크 항목을 직접 골라 기록해 주세요.",
    primary: { label: "웨딩 라운지로", href: "/lounge", icon: Compass },
    secondary: { label: "내 체크리스트 보기", href: "/schedule", icon: ListChecks },
  },
  money: {
    eyebrow: "SENSITIVE LEDGER RETIRED",
    title: "축의금 관리는 제공하지 않아요",
    description:
      "제3자의 실명·관계·금액을 결혼 준비 서비스가 별도 장부로 보관할 필요성과 보호 기준이 충분히 검증되지 않아 새 기록을 받지 않습니다. 기존 기록을 신규 화면에 다시 노출하지 않으며, 안전한 삭제 절차가 검증되기 전에는 이 기능을 다시 열지 않겠습니다.",
    primary: { label: "웨딩 라운지로", href: "/lounge", icon: Compass },
    secondary: { label: "예절 가이드 보기", href: "/etiquette", icon: BookOpen },
  },
} as const;

export default function PublicBetaUnavailable({
  feature,
}: {
  feature: keyof typeof COPY;
}) {
  const copy = COPY[feature];
  const PrimaryIcon = copy.primary.icon;
  const SecondaryIcon = copy.secondary.icon;

  return (
    <main className="mx-auto flex min-h-[calc(100vh-9rem)] w-full max-w-3xl items-center px-4 py-10 sm:px-6">
      <section className="w-full rounded-[28px] border border-[#e2d3c8] bg-white p-6 shadow-[0_18px_50px_rgba(36,56,50,0.08)] sm:p-10">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#eef4ef] text-[#36534e]">
          <ShieldCheck className="h-6 w-6" aria-hidden="true" />
        </div>
        <p className="mt-6 text-[11px] font-semibold tracking-[0.18em] text-[#8f6662]">
          {copy.eyebrow}
        </p>
        <h1 className="mt-2 text-[28px] font-semibold leading-tight text-[#243832] sm:text-[34px]">
          {copy.title}
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] font-medium leading-7 text-[#5d6879]">
          {copy.description}
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            {...weddingLinkProps(copy.primary.href)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#36534e] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#243832]"
          >
            <PrimaryIcon className="h-4 w-4" aria-hidden="true" />
            {copy.primary.label}
          </Link>
          <Link
            {...weddingLinkProps(copy.secondary.href)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[#d9c8bd] bg-[#fbf8f2] px-5 text-sm font-semibold text-[#36534e] transition-colors hover:bg-[#f7f1e8]"
          >
            <SecondaryIcon className="h-4 w-4" aria-hidden="true" />
            {copy.secondary.label}
          </Link>
        </div>
      </section>
    </main>
  );
}
