import Link from "next/link";
import { CloudOff } from "lucide-react";

import { weddingPath } from "@/lib/weddingPaths";

interface CommunityConfigurationUnavailableProps {
  retryHref: string;
}

export default function CommunityConfigurationUnavailable({
  retryHref,
}: CommunityConfigurationUnavailableProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:py-16">
      <section
        className="rounded-[28px] border border-[#EFE4D7] bg-white px-6 py-10 text-center shadow-[0_16px_42px_rgba(8,22,38,0.06)] sm:px-10"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#F7F1E8] text-[#36534E]">
          <CloudOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-2xl font-semibold leading-snug text-[#243832]">
          서비스 연결이 잠시 원활하지 않아요
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base font-medium leading-relaxed text-[#36534E]">
          내 활동을 지금 불러오지 못했어요. 데이터는 변경되지 않았어요. 잠시 후 다시 시도하거나
          다른 화면을 편하게 둘러보실 수 있어요.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href={retryHref}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-[#36534E] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#243832] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
          >
            다시 시도
          </a>
          <Link
            href={weddingPath()}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-[#C7D1C2] bg-[#F7F1E8] px-6 text-sm font-semibold text-[#36534E] transition-colors hover:bg-[#EFE4D7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#36534E] focus-visible:ring-offset-2"
          >
            커뮤니티로 돌아가기
          </Link>
        </div>
      </section>
    </div>
  );
}
