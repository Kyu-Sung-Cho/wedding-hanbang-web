import Link from "next/link";
import { Mail, Clock3, ArrowLeft } from "lucide-react";
import { CONTACT } from "@/lib/constants/contact";

export const metadata = {
  title: "고객센터 · 웨딩한방",
  description: "웨딩한방 이용 중 도움이 필요할 때 연락하는 방법을 안내합니다.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#fbf8f2] px-5 py-12 text-[#263832] sm:py-20">
      <div className="mx-auto max-w-xl rounded-3xl border border-[#e5d8ca] bg-white p-7 shadow-[0_14px_40px_rgba(38,56,50,0.06)] sm:p-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#635b51] hover:text-[#36534e]">
          <ArrowLeft className="h-4 w-4" /> 홈으로
        </Link>
        <h1 className="mt-8 font-serif-kr text-3xl font-medium">무엇을 도와드릴까요?</h1>
        <p className="mt-3 text-sm leading-7 text-[#635b51]">
          계정, 커플 연결, 예약, 개인정보 또는 아모라 이용 중 문제가 생기면 아래 이메일로 알려주세요. 비밀번호나 인증 코드는 보내지 마세요.
        </p>

        <a
          href={`mailto:${CONTACT.email}`}
          className="mt-8 flex items-center gap-3 rounded-2xl border border-[#e5d8ca] bg-[#fbf8f2] p-4 hover:border-[#36534e]"
        >
          <Mail className="h-5 w-5 text-[#36534e]" />
          <div>
            <p className="text-xs text-[#7d7166]">이메일</p>
            <p className="mt-0.5 font-medium">{CONTACT.email}</p>
          </div>
        </a>
        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-[#e5d8ca] p-4">
          <Clock3 className="h-5 w-5 text-[#36534e]" />
          <div>
            <p className="text-xs text-[#7d7166]">운영 시간</p>
            <p className="mt-0.5 font-medium">{CONTACT.hours} · {CONTACT.lunch}</p>
          </div>
        </div>
        <p className="mt-6 text-xs leading-6 text-[#7d7166]">
          긴급한 신체·안전 위험은 웨딩한방이 대신 대응할 수 없습니다. 즉시 112 또는 119에 연락해 주세요.
        </p>
      </div>
    </main>
  );
}
