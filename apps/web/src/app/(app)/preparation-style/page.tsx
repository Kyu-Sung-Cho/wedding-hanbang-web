import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import LoungeWeddingCode from "@/components/app/preparation-style/LoungeWeddingCode";
import PreparationStyleHub from "@/components/app/preparation-style/PreparationStyleHub";
import { parseWeddingCodeEntryQuery, type WeddingCodeEntrySearchParams } from "@/app/wedding-code/entry";
import { isLegacyWeddingCodeQuery, weddingCodeExplicitTarget } from "@/app/wedding-code/releaseEntry";
import { weddingLinkProps } from "@/lib/weddingPaths";

export const metadata = {
  title: "웨딩코드 | 웨딩한방",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PreparationStylePage({ searchParams }: {
  searchParams: Promise<WeddingCodeEntrySearchParams & { view?: string | string[] }>;
}) {
  const search = await searchParams;
  if (search.view === "previous") return <>
    <div className="mx-auto max-w-5xl px-4 pt-5 sm:px-7">
      <Link {...weddingLinkProps("/preparation-style")} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]"><ArrowLeft className="size-4" aria-hidden="true" />최신 웨딩코드로 돌아가기</Link>
    </div>
    <PreparationStyleHub previousOnly />
  </>;
  // 맨 주소는 64문항을 연다. 판 고르기는 공개 /wedding-code 와 같은 함수로 한다(releaseEntry.ts).
  return <LoungeWeddingCode
    shareOrigin={process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "https://hanbang.ai"}
    initialEntry={parseWeddingCodeEntryQuery(search)}
    queryIsLegacy={isLegacyWeddingCodeQuery(search)}
    explicitTarget={weddingCodeExplicitTarget(search)}
  />;
}
