import Link from "next/link";

export type VerificationResultKind = "verified" | "expired" | "invalid" | "unavailable";

const RESULT_CONTENT: Record<VerificationResultKind, {
  eyebrow: string;
  title: string;
  description: string;
  note: string;
  symbol: string;
  tone: string;
  href: string;
  action: string;
}> = {
  verified: {
    eyebrow: "이메일 확인 완료",
    title: "이메일 주소를 확인했어요",
    description: "사용자 연구 신청에 사용한 이메일의 소유 확인이 완료되었습니다.",
    note: "이메일 확인은 코호트 선정을 의미하지 않습니다. 신청 내용을 검토한 뒤 선정 여부와 다음 단계는 별도 이메일로 안내드릴게요.",
    symbol: "✓",
    tone: "bg-[#e7f0e9] text-[#36534e]",
    href: "/beta",
    action: "사용자 연구 안내로 돌아가기",
  },
  expired: {
    eyebrow: "확인 시간 만료",
    title: "확인 링크가 만료됐어요",
    description: "이 링크는 이메일 발송 후 2시간 동안만 사용할 수 있습니다.",
    note: "신청 페이지에서 같은 이메일로 다시 제출하면 새 2시간 확인 링크를 받을 수 있습니다. 공개 문의·삭제 접수 창구는 아직 열지 않았습니다.",
    symbol: "!",
    tone: "bg-[#f7eadc] text-[#8a5b32]",
    href: "/beta",
    action: "사용자 연구 안내 보기",
  },
  invalid: {
    eyebrow: "확인 실패",
    title: "확인할 수 없는 링크예요",
    description: "링크가 일부 누락되었거나 더 이상 유효하지 않습니다.",
    note: "이메일에 있는 확인 버튼을 다시 열어주세요. 계속 실패하면 새 링크를 요청해 다시 시도해 주세요.",
    symbol: "!",
    tone: "bg-[#f3e8e6] text-[#795252]",
    href: "/beta",
    action: "사용자 연구 신청 페이지로",
  },
  unavailable: {
    eyebrow: "일시적인 확인 실패",
    title: "지금은 확인을 완료하지 못했어요",
    description: "이메일 확인 상태를 지금 확정하지 못했습니다. 잠시 뒤 이메일의 링크를 다시 열어주세요.",
    note: "링크는 발송 후 2시간 동안 유효합니다. 시간이 지난 뒤에는 신청 페이지에서 새 링크를 요청해 주세요.",
    symbol: "…",
    tone: "bg-[#ecefed] text-[#52635b]",
    href: "/demo",
    action: "서비스 소개 보기",
  },
};

export default function VerificationResultCard({
  resultKind,
}: {
  resultKind: VerificationResultKind;
}) {
  const content = RESULT_CONTENT[resultKind];
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#f7f4ee] px-5 py-12 text-[#263832]">
      <section className="w-full max-w-lg rounded-[2rem] border border-[#e1d8cc] bg-white px-7 py-10 text-center shadow-[0_24px_70px_rgba(48,66,58,0.10)] sm:px-11 sm:py-12">
        <div
          aria-hidden="true"
          className={`mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-full text-xl font-semibold ${content.tone}`}
        >
          {content.symbol}
        </div>
        <p className="text-xs font-semibold tracking-[0.18em] text-[#718078]">
          {content.eyebrow}
        </p>
        <h1 className="mt-4 text-balance font-serif-kr text-2xl font-medium leading-snug sm:text-3xl">
          {content.title}
        </h1>
        <p className="mt-5 text-pretty text-[15px] leading-7 text-[#59665f]">
          {content.description}
        </p>
        <div className="my-7 h-px bg-[#eee8df]" aria-hidden="true" />
        <p className="text-pretty text-[13px] leading-6 text-[#7d7166]">
          {content.note}
        </p>
        <Link
          href={content.href}
          className="mt-8 inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-[#36534e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#2b423e] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#36534e]"
        >
          {content.action}
        </Link>
        <p className="mt-5 text-xs leading-5 text-[#9a9187]">
          확인 링크나 신청 정보를 다른 사람에게 전달하지 마세요.
        </p>
      </section>
    </main>
  );
}
