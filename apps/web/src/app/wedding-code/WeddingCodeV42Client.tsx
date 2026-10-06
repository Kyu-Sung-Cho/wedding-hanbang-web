"use client";

import { V42_SELF_INTRO_DETAIL, WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WeddingCodeResultEditionProvider } from "@/components/wedding-code/v40/ResultEditionContext";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { buildGatedShareUrlWithGuess, buildQuestionOnlyUrl } from "@/lib/weddingCode/v42/codec";
import * as storage from "@/lib/weddingCode/v42/storage";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";

import { WeddingCodeV40ClientWithDeps, type WeddingCodeEdition } from "./WeddingCodeV40Client";

const edition = {
  version: WEDDING_CODE_V42_VERSION,
  bank: WEDDING_CODE_V42_BANK,
  storage,
  buildGatedShareUrlWithGuess,
  buildQuestionOnlyUrl,
  selfIntroDetail: V42_SELF_INTRO_DETAIL,
} satisfies WeddingCodeEdition;

export default function WeddingCodeV42Client(props: WeddingCodeV40ClientProps) {
  return <WeddingCodeResultEditionProvider version={WEDDING_CODE_V42_VERSION}><WeddingCodeV40ClientWithDeps {...props} edition={edition} /></WeddingCodeResultEditionProvider>;
}
