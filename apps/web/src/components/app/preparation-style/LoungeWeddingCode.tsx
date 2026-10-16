import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import WeddingCodeEntryClient from "@/app/wedding-code/WeddingCodeEntryClient";
import type { WeddingCodeEntry } from "@/app/wedding-code/entry";
import { weddingLinkProps } from "@/lib/weddingPaths";

export default function LoungeWeddingCode({ shareOrigin, initialEntry }: {
  shareOrigin: string;
  initialEntry: WeddingCodeEntry;
}) {
  return <div data-lounge-wedding-code="">
    <div className="mx-auto max-w-2xl px-4 pt-5 sm:px-6">
      <Link {...weddingLinkProps("/lounge")} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]">
        <ArrowLeft className="size-4" aria-hidden="true" />웨딩라운지로
      </Link>
    </div>
    <WeddingCodeEntryClient shareOrigin={shareOrigin} initialEntry={initialEntry} embedded />
    <div className="mx-auto max-w-2xl px-4 pb-8 sm:px-6">
      <Link {...weddingLinkProps("/preparation-style?view=previous")} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--hb-text-muted)] underline underline-offset-4">
        이전에 계정에 저장한 답 보기<ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  </div>;
}
