import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { weddingLinkProps } from "@/lib/weddingPaths";

export default function ChecklistCategoryNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-[640px] flex-col items-center justify-center px-5 py-12 text-center">
      <p className="text-[12px] font-semibold tracking-[0.12em] text-[#9d6f36]">WEDDING CHECKLIST</p>
      <h1 className="mt-3 font-serif-kr text-[30px] font-medium text-[#172a27]">찾을 수 없는 준비 분야예요</h1>
      <p className="mt-3 text-[14px] leading-7 text-[#65706d]">전체 체크리스트에서 필요한 준비를 다시 골라주세요.</p>
      <Link {...weddingLinkProps("/checklist")} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white">
        <ArrowLeft className="h-4 w-4" />
        전체 체크리스트로 돌아가기
      </Link>
    </div>
  );
}
