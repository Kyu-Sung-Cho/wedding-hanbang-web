import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import type { WeddingCodeEntry } from "@/app/wedding-code/entry";
import { WEDDING_CODE_BARE_TARGET, type WeddingCodeExplicitTarget } from "@/app/wedding-code/releaseEntry";
import { weddingLinkProps } from "@/lib/weddingPaths";
import LoungeWeddingCodeSwitch from "./LoungeWeddingCodeSwitch";

/** 라운지 맨 주소. 맨 주소가 64문항을 여는 동안 '64문항 웨딩코드로' 링크가 이리로 간다. */
export const LOUNGE_WC64_PATH = "/preparation-style";

/** 쿼리로 연 판 중 64문항보다 앞선 판(v3.1과 그 전 판). v4 는 아직 내지 않은 판이라 이전 판이 아니다. */
const PREVIOUS_ENTRY_KINDS: ReadonlySet<WeddingCodeEntry["kind"]> = new Set<WeddingCodeEntry["kind"]>(["v31", "v30", "v20", "legacy"]);

/**
 * 로그인한 웹 라운지의 웨딩코드. 맨 주소는 64문항(wc64)을 열고, 옛 판 쿼리와 `#v=` 링크는 기존 입구가 연다.
 * 판 고르기는 공개 입구와 같은 규칙이다(`LoungeWeddingCodeSwitch`).
 *
 * 쿼리로 이전 판(v3.1 등)을 열었으면 맨 위에 '이전 판이에요 · 64문항 웨딩코드로' 한 줄을 둔다(2026-10-17 상품 심사 LNG-4).
 * 맨 주소가 64문항을 열 때만 둔다(`WEDDING_CODE_BARE_TARGET` 을 "36" 으로 되돌리면 맨 주소가 v3.1 이라 링크가 거짓이 된다).
 * 해시(`#v=`)로 연 이전 판은 서버가 해시를 보지 못해 이 줄이 없다.
 */
export default function LoungeWeddingCode({ shareOrigin, initialEntry, queryIsLegacy, explicitTarget = null }: {
  shareOrigin: string;
  initialEntry: WeddingCodeEntry;
  queryIsLegacy: boolean;
  explicitTarget?: WeddingCodeExplicitTarget | null;
}) {
  const previousVersion = queryIsLegacy && PREVIOUS_ENTRY_KINDS.has(initialEntry.kind) && WEDDING_CODE_BARE_TARGET === "wc64";
  return <div data-lounge-wedding-code="">
    <div className="mx-auto max-w-2xl px-4 pt-5 sm:px-6">
      <Link {...weddingLinkProps("/lounge")} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-[var(--hb-primary)]">
        <ArrowLeft className="size-4" aria-hidden="true" />웨딩라운지로
      </Link>
      {previousVersion ? (
        <p className="mt-1 text-sm text-[var(--hb-text-body)]" data-lounge-previous-version-note="">
          이전 판이에요 ·{" "}
          <Link {...weddingLinkProps(LOUNGE_WC64_PATH)} className="inline-flex min-h-11 items-center font-semibold text-[var(--hb-primary)] underline underline-offset-4">
            64문항 웨딩코드로
          </Link>
        </p>
      ) : null}
    </div>
    <LoungeWeddingCodeSwitch queryIsLegacy={queryIsLegacy} explicitTarget={explicitTarget}
      shareOrigin={shareOrigin} initialEntry={initialEntry} />
    <div className="mx-auto max-w-2xl px-4 pb-8 sm:px-6">
      <Link {...weddingLinkProps("/preparation-style?view=previous")} className="inline-flex min-h-11 items-center gap-2 text-sm text-[var(--hb-text-muted)] underline underline-offset-4">
        이전에 계정에 저장한 답 보기<ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </div>
  </div>;
}
