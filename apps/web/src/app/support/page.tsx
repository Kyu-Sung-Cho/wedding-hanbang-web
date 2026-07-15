import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "문의 창구 점검 상태 · 웨딩한방",
  description: "웨딩한방 공개 문의 창구의 준비 상태를 안내합니다.",
};

export default function SupportPage() {
  return (
    <main className="min-h-screen bg-[#fbf8f2] px-5 py-12 text-[#263832] sm:py-20">
      <div className="mx-auto max-w-xl rounded-3xl border border-[#e5d8ca] bg-white p-7 shadow-[0_14px_40px_rgba(38,56,50,0.06)] sm:p-10">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-[#635b51] hover:text-[#36534e]">
          <ArrowLeft className="h-4 w-4" /> 홈으로
        </Link>
        <h1 className="mt-8 font-serif-kr text-3xl font-medium">문의 창구 점검 중</h1>
        <p className="mt-3 text-sm leading-7 text-[#635b51]">
          실제 수신 확인, 담당자 권한, 본인 확인, 처리 기록과 개인정보 보호 절차를 검증하기 전까지
          공개 문의 접수는 아직 열지 않았습니다.
        </p>

        <div className="mt-8 rounded-2xl border border-[#e5d8ca] bg-[#fbf8f2] p-4">
          <p className="text-sm font-semibold text-[#36534e]">공개 접수 닫힘</p>
          <p className="mt-2 text-xs leading-6 text-[#7d7166]">
            수신·본인 확인·처리 기록·삭제 절차가 실제 운영 검증을 통과하기 전에는 어떤 연락처도
            공개하지 않습니다.
          </p>
        </div>
        <p className="mt-3 text-xs leading-6 text-[#7d7166]">
          이 페이지는 메시지나 개인정보를 받지 않습니다. 운영 가능한 창구가 확인되면 접수 방법과
          처리 범위를 함께 공개하겠습니다.
        </p>
        <p className="mt-6 text-xs leading-6 text-[#7d7166]">
          긴급한 신체·안전 위험은 웨딩한방이 대신 대응할 수 없습니다. 즉시 112 또는 119에 연락해 주세요.
        </p>
      </div>
    </main>
  );
}
