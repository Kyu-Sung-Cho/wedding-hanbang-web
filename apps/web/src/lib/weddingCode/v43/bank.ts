import { WEDDING_CODE_V43_VERSION } from "@/constants/weddingCodeV43";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V43_BANK_DATA } from "@/constants/weddingCodeV43Bank";
import { createBank } from "../v40/bank";
import type { Bank } from "../v40/types";

/** 이전 은행들과 분리된 문항 원문. 같은 배치라도 링크의 판이 다르면 인용을 섞지 않는다. */
if (V43_BANK_DATA.version !== WEDDING_CODE_V43_VERSION) throw new Error("v4.3 문항 은행 판이 맞지 않습니다");
// 검사기의 v4.0 고정 태그만 복사본에서 맞춘 뒤 동일한 배치·문구 검사를 거친다.
const checked = createBank({ ...V43_BANK_DATA, version: WEDDING_CODE_V40_VERSION });
export const WEDDING_CODE_V43_BANK: Bank = { ...checked, version: WEDDING_CODE_V43_VERSION };
