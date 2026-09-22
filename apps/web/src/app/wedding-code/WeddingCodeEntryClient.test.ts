import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V20_QUESTIONS,
  WEDDING_CODE_V20_VERSION,
} from "@/constants/weddingCodeV20";
import {
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
} from "@/constants/weddingCodeV06";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import { encodeWeddingCodeV20 } from "@/lib/weddingCode/v20";
import { parseWeddingCodeEntryHash } from "./WeddingCodeEntryClient";

const v20Answers = Object.fromEntries(WEDDING_CODE_V20_QUESTIONS.map((question) => [question.id, 4]));
const v06Answers: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "A"]),
);

describe("웨딩코드 진입 fragment dispatch", () => {
  it("빈 fragment는 hash 링크가 아니라 clean entry로 남긴다", () => {
    expect(parseWeddingCodeEntryHash("")).toBeNull();
    expect(parseWeddingCodeEntryHash("#")).toBeNull();
  });

  it("v20 코드는 새 판으로만 dispatch한다", () => {
    const result = parseWeddingCodeEntryHash(
      `#v=${WEDDING_CODE_V20_VERSION}&a=${encodeWeddingCodeV20(v20Answers)}`,
    );
    expect(result?.kind).toBe("v20");
    if (result?.kind === "v20") expect(result.initial.partnerAnswers).toEqual(v20Answers);
  });

  it("예전 fragment는 해당 판의 v06 client로 dispatch한다", () => {
    const code = encodeWeddingCodeV06(v06Answers);
    const result = parseWeddingCodeEntryHash(`#v=${WEDDING_CODE_V06_VERSION}&a=${code}`);
    expect(result?.kind).toBe("legacy");
    if (result?.kind === "legacy") {
      expect(result.initial.version).toBe(WEDDING_CODE_V06_VERSION);
      expect(result.initial.partnerAnswers).toEqual(v06Answers);
    }
  });

  it.each([
    "#b=4444444444444444",
    "#v=unknown&a=AAAAAAAAAAAAAAAAAAAA",
    "#v=v20-code&a=4444444444444444&b=4444444444444444",
    `#v=${WEDDING_CODE_V20_VERSION}&a=4444444444444444&a=4444444444444444`,
    `#v=${WEDDING_CODE_V20_VERSION}&c=4444444444444444`,
    `#v=${WEDDING_CODE_V20_VERSION}&a=0000000000000000`,
  ])("손상·중복·미지원 fragment %s는 답을 추정하지 않는다", (hash) => {
    expect(parseWeddingCodeEntryHash(hash)?.kind).toBe("error");
  });
});
