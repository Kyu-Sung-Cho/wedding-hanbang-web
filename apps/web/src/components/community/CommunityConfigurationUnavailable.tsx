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
        className="rounded-[6px] border border-[var(--hb-hairline)] bg-white px-6 py-10 text-center shadow-[var(--shadow-overlay)] sm:px-10"
        role="status"
        aria-live="polite"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--hb-surface-hover)] text-[var(--hb-text-strong)]">
          <CloudOff className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="mt-5 text-[var(--hb-text-strong)]">
          서비스 연결이 잠시 원활하지 않아요
        </h1>
        <p className="mx-auto mt-4 max-w-lg text-base font-medium leading-relaxed text-[var(--hb-text-strong)]">
          내 활동을 지금 불러오지 못했어요. 데이터는 변경되지 않았어요. 잠시 후 다시 시도하거나
          다른 화면을 편하게 둘러보실 수 있어요.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <a
            href={retryHref}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--hb-primary)] px-6 text-sm font-semibold text-white transition-colors hover:bg-[var(--hb-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2"
          >
            다시 시도
          </a>
          <Link
            href={weddingPath()}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] border border-[#C7D1C2] bg-[var(--hb-surface-hover)] px-6 text-sm font-semibold text-[var(--hb-text-strong)] transition-colors hover:bg-[#EFE4D7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-primary)] focus-visible:ring-offset-2"
          >
            커뮤니티로 돌아가기
          </Link>
        </div>
      </section>
    </div>
  );
}
