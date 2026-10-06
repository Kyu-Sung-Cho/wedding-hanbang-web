"use client";

import { V41_SELF_INTRO_DETAIL, WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V41_BANK } from "@/lib/weddingCode/v41/bank";
import { buildGatedShareUrlWithGuess, buildQuestionOnlyUrl } from "@/lib/weddingCode/v41/codec";
import * as storage from "@/lib/weddingCode/v41/storage";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";

import { WeddingCodeV40ClientWithDeps, type WeddingCodeEdition } from "./WeddingCodeV40Client";

const edition = {
  version: WEDDING_CODE_V41_VERSION,
  bank: WEDDING_CODE_V41_BANK,
  storage,
  buildGatedShareUrlWithGuess,
  buildQuestionOnlyUrl,
  selfIntroDetail: V41_SELF_INTRO_DETAIL,
} satisfies WeddingCodeEdition;

export default function WeddingCodeV41Client(props: WeddingCodeV40ClientProps) {
  return <WeddingCodeV40ClientWithDeps {...props} edition={edition} />;
}
