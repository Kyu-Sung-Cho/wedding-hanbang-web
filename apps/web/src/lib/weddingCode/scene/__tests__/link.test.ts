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
  decodeWeddingCodeShareParams,
} from "@/lib/weddingCode/scene/link";

function allAnswers(
  questions: typeof WEDDING_CODE_V06_QUESTIONS | typeof WEDDING_CODE_V08_QUESTIONS,
  value: "A" | "D",
): WeddingCodeV06Answers {
  return Object.fromEntries(questions.map((question) => [question.key, value]));
}

describe("WeddingCode private share fragment", () => {
  const currentFirst = "A".repeat(WEDDING_CODE_V08_QUESTIONS.length);
  const currentSecond = "D".repeat(WEDDING_CODE_V08_QUESTIONS.length);

  it.each([
    `#v=${WEDDING_CODE_V08_VERSION}&v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&a=${currentFirst}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&b=${currentSecond}&b=${currentSecond}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&%61=${currentFirst}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&other=value`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&b=INVALID`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&b=`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${currentFirst}&b=${"-".repeat(20)}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=INVALID&b=${currentSecond}`,
    `#v=${WEDDING_CODE_V08_VERSION}&b=${currentSecond}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${"-".repeat(20)}`,
    `#v=${WEDDING_CODE_V08_VERSION}&a=${"%20".repeat(2_000)}${currentFirst}`,
  ])("rejects an ambiguous or malformed fragment instead of keeping part of its answers (case %#)", (hash) => {
    expect(decodeWeddingCodeShareHash(hash)).toBeNull();
  });

  it("keeps valid partial answers for each person without filling skipped scenes", () => {
    const decoded = decodeWeddingCodeShareHash(
      `#v=${WEDDING_CODE_V08_VERSION}&a=A${"-".repeat(19)}&b=${"-".repeat(19)}D`,
    );
    expect(decoded?.bothCodes).toEqual({ first: { A1: "A" }, second: { D5: "D" } });
  });

  it("keeps explicit legacy pair fragments and their answer version", () => {
    const decoded = decodeWeddingCodeShareHash(
      `#v=${WEDDING_CODE_V06_VERSION}&a=${"A".repeat(16)}&b=${"D".repeat(16)}`,
    );
    expect(decoded?.version).toBe(WEDDING_CODE_V06_VERSION);
    expect(decoded?.bothCodes?.first.D4).toBe("A");
    expect(decoded?.bothCodes?.second.D4).toBe("D");
  });

  it("does not change the separate legacy query compatibility decoder", () => {
    const decoded = decodeWeddingCodeShareParams(new URLSearchParams({
      a: "A".repeat(16), b: "INVALID",
    }));
    expect(decoded?.version).toBe(WEDDING_CODE_V06_VERSION);
    expect(decoded?.partnerAnswers?.A1).toBe("A");
    expect(decoded?.bothCodes).toBeNull();
  });

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
