import { describe, expect, it } from "vitest";

import {
  WEDDING_CODE_V06_QUESTIONS,
  WEDDING_CODE_V06_VERSION,
} from "@/constants/weddingCodeV06";
import {
  WEDDING_CODE_V08_QUESTIONS,
  WEDDING_CODE_V08_VERSION,
} from "@/constants/weddingCodeV08";
import {
  WEDDING_CODE_V10_QUESTIONS,
  WEDDING_CODE_V10_VERSION,
} from "@/constants/weddingCodeV10";
import {
  WEDDING_CODE_V11_QUESTIONS,
  WEDDING_CODE_V11_VERSION,
} from "@/constants/weddingCodeV11";
import {
  WEDDING_CODE_V12_QUESTIONS,
  WEDDING_CODE_V12_VERSION,
} from "@/constants/weddingCodeV12";
import { weddingCodeSceneConfigForExactVersion } from "@/lib/weddingCode/scene/config";
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

  it.each([
    { version: WEDDING_CODE_V10_VERSION, questions: WEDDING_CODE_V10_QUESTIONS },
    { version: WEDDING_CODE_V11_VERSION, questions: WEDDING_CODE_V11_QUESTIONS },
  ] as const)("round trips $version without relabeling answers as the current version", ({ version, questions }) => {
    const first = { A1: "A", B5: "B", D4: "D" } as const;
    const second = { A1: "D", C5: "C", D5: "A" } as const;
    const url = new URL(buildWeddingCodeShareUrl({
      origin: "https://hanbang.ai",
      version,
      firstCode: encodeWeddingCodeV06(first, questions),
      secondCode: encodeWeddingCodeV06(second, questions),
    }));
    expect(url.search).toBe("");
    const decoded = decodeWeddingCodeShareHash(url.hash);
    expect(decoded?.version).toBe(version);
    expect(decoded?.bothCodes).toEqual({ first, second });
    expect(weddingCodeSceneConfigForExactVersion(decoded!.version).questions).toBe(questions);

    const single = decodeWeddingCodeShareHash(`#v=${version}&a=A${"-".repeat(19)}`);
    expect(single?.version).toBe(version);
    expect(single?.partnerAnswers).toEqual({ A1: "A" });
    expect(single?.bothCodes).toBeNull();
  });

  it("rejects a future version or shortened v1.1 answer instead of reusing an older scene set", () => {
    expect(decodeWeddingCodeShareHash(`#v=v1.3-code&a=${"A".repeat(20)}`)).toBeNull();
    expect(decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V11_VERSION}&a=${"A".repeat(19)}`)).toBeNull();
  });

  it("v1.2의 가변 보기와 건너뜀을 복원하고 같은 기호의 옛 문항을 섞지 않는다", () => {
    const first = { A1: "D", B1: "C", C3: "C", D5: "B" } as const;
    const second = { A1: "A", B1: "A", C3: "A", D5: "A" } as const;
    const url = new URL(buildWeddingCodeShareUrl({
      origin: "https://hanbang.ai", version: WEDDING_CODE_V12_VERSION,
      firstCode: encodeWeddingCodeV06(first, WEDDING_CODE_V12_QUESTIONS),
      secondCode: encodeWeddingCodeV06(second, WEDDING_CODE_V12_QUESTIONS),
    }));
    expect(url.search).toBe("");
    expect(decodeWeddingCodeShareHash(url.hash)).toMatchObject({
      version: WEDDING_CODE_V12_VERSION, bothCodes: { first, second },
    });
  });

  it.each([5, 10, 15, 18])("v1.2의 %i번째 위치에 없는 D가 있으면 단일·커플 링크 전체를 거부한다", index => {
    const invalid = `${"A".repeat(index)}D${"A".repeat(19 - index)}`;
    expect(decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V12_VERSION}&a=${invalid}`)).toBeNull();
    expect(decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V12_VERSION}&a=${"A".repeat(20)}&b=${invalid}`)).toBeNull();
    expect(decodeWeddingCodeShareHash(`#v=${WEDDING_CODE_V11_VERSION}&a=${invalid}`)?.partnerCode).toBe(invalid);
  });
});
