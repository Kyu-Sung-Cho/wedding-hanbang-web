"use client";

import { V43_SELF_INTRO_DETAIL, WEDDING_CODE_V43_VERSION } from "@/constants/weddingCodeV43";
import { WeddingCodeResultEditionProvider } from "@/components/wedding-code/v40/ResultEditionContext";
import { WEDDING_CODE_V43_BANK } from "@/lib/weddingCode/v43/bank";
import { buildGatedShareUrlWithGuess, buildQuestionOnlyUrl } from "@/lib/weddingCode/v43/codec";
import * as storage from "@/lib/weddingCode/v43/storage";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";

import { WeddingCodeV40ClientWithDeps, type WeddingCodeEdition } from "./WeddingCodeV40Client";

const edition = {
  version: WEDDING_CODE_V43_VERSION,
  bank: WEDDING_CODE_V43_BANK,
  storage,
  buildGatedShareUrlWithGuess,
  buildQuestionOnlyUrl,
  selfIntroDetail: V43_SELF_INTRO_DETAIL,
} satisfies WeddingCodeEdition;

export default function WeddingCodeV43Client(props: WeddingCodeV40ClientProps) {
  return <WeddingCodeResultEditionProvider version={WEDDING_CODE_V43_VERSION}><WeddingCodeV40ClientWithDeps {...props} edition={edition} /></WeddingCodeResultEditionProvider>;
}
