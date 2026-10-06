import Link from "next/link";
import AmoraMark from "@/components/ui/AmoraMark";
import { V40_COPY } from "@/lib/weddingCode/v40/copy";

/** 독립 웨딩코드의 브랜드 머리글. 결과나 응답 상태를 담지 않는다. */
export default function WeddingCodeBrand() {
  return (
    <header data-wedding-code-brand="" className="mx-auto flex w-full max-w-[1080px] items-center justify-between gap-4 border-b border-[var(--hb-hairline)] px-5 py-5 sm:px-8 sm:py-6">
      <Link href="/" prefetch={false} aria-label={V40_COPY.brand.homeLabel} className="inline-flex min-h-11 items-center gap-2.5 rounded-md text-[var(--hb-text-strong)] focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-4">
        <AmoraMark size={26} className="text-[var(--hb-text-strong)]" />
        <span className="text-lg font-semibold tracking-tight">{V40_COPY.brand.title}</span>
      </Link>
      <span className="text-xs font-medium tracking-wide text-[var(--hb-text-muted)]">{V40_COPY.brand.editionLabel}</span>
    </header>
  );
}
