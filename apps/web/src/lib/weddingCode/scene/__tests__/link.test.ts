import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
} from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_V08_QUESTIONS,
  WEDDING_CODE_V08_VERSION,
} from "@/constants/weddingCodeV08";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import {
  buildWeddingCodeShareUrl,
  decodeWeddingCodeShareHash,
} from "@/lib/weddingCode/scene/link";

function allAnswers(
  questions: typeof WEDDING_CODE_V06_QUESTIONS | typeof WEDDING_CODE_V08_QUESTIONS,
  value: "A" | "D",
): WeddingCodeV06Answers {
  return Object.fromEntries(questions.map((question) => [question.key, value]));
}

describe("WeddingCode private share fragment", () => {
  it("puts new answers after the URL fragment instead of the server-visible query", () => {
    const code = encodeWeddingCodeV06(
      allAnswers(WEDDING_CODE_V08_QUESTIONS, "A"),
      WEDDING_CODE_V08_QUESTIONS,
    );
    const url = buildWeddingCodeShareUrl({
      origin: "https://hanbang.ai/",
      version: WEDDING_CODE_V08_VERSION,
      firstCode: code,
    });

    expect(url).toBe(
      `https://hanbang.ai/wedding-code#v=${encodeURIComponent(WEDDING_CODE_V08_VERSION)}&a=${code}`,
    );
    expect(new URL(url).search).toBe("");
  });

  it("decodes two current-version answers from the fragment", () => {
    const firstCode = encodeWeddingCodeV06(
      allAnswers(WEDDING_CODE_V08_QUESTIONS, "A"),
      WEDDING_CODE_V08_QUESTIONS,
    );
    const secondCode = encodeWeddingCodeV06(
      allAnswers(WEDDING_CODE_V08_QUESTIONS, "D"),
      WEDDING_CODE_V08_QUESTIONS,
    );
    const decoded = decodeWeddingCodeShareHash(
      `#v=${WEDDING_CODE_V08_VERSION}&a=${firstCode}&b=${secondCode}`,
    );

    expect(decoded?.version).toBe(WEDDING_CODE_V08_VERSION);
    expect(decoded?.bothCodes?.first.A1).toBe("A");
    expect(decoded?.bothCodes?.second.A1).toBe("D");
  });

  it("keeps an unversioned legacy fragment on v0.6 and rejects unknown versions", () => {
    const legacyCode = encodeWeddingCodeV06(
      allAnswers(WEDDING_CODE_V06_QUESTIONS, "A"),
      WEDDING_CODE_V06_QUESTIONS,
    );

    expect(decodeWeddingCodeShareHash(`#a=${legacyCode}`)?.version)
      .toBe(WEDDING_CODE_V06_VERSION);
    expect(decodeWeddingCodeShareHash(`#v=v9-unknown&a=${legacyCode}`)).toBeNull();
  });
});
