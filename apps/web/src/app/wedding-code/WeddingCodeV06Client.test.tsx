import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { WEDDING_CODE_V06_QUESTIONS } from "@/constants/weddingCodeV06";
import { encodeWeddingCodeV06 } from "@/lib/weddingCode/v06/code";
import type { WeddingCodeV06Answers } from "@/lib/weddingCode/v06/gap";
import WeddingCodeV06Client from "./WeddingCodeV06Client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const FIRST: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "A"]),
);
const SECOND: WeddingCodeV06Answers = Object.fromEntries(
  WEDDING_CODE_V06_QUESTIONS.map((question) => [question.key, "D"]),
);
const FIRST_CODE = encodeWeddingCodeV06(FIRST);
const SECOND_CODE = encodeWeddingCodeV06(SECOND);

describe("WeddingCode fragment privacy", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState({}, "", "/wedding-code");
    window.localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    window.localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("restores a two-person result from the fragment without a query", async () => {
    window.history.replaceState({}, "", `/wedding-code#a=${FIRST_CODE}&b=${SECOND_CODE}`);

    await act(async () => {
      root.render(
        <WeddingCodeV06Client shareOrigin="https://hanbang.ai" />,
      );
    });

    expect(container.querySelector('[data-result="couple"]')).not.toBeNull();
    expect(window.location.search).toBe("");
  });

  it("never reads a legacy answer query in the React tree", async () => {
    window.history.replaceState(
      {},
      "",
      `/wedding-code?utm_source=legacy&a=${FIRST_CODE}&b=${SECOND_CODE}`,
    );

    await act(async () => {
      root.render(
        <WeddingCodeV06Client shareOrigin="https://hanbang.ai" />,
      );
    });

    expect(container.querySelector('[data-result="couple"]')).toBeNull();
    expect(window.location.hash).toBe("");
  });

  it("purges the retired unscoped v0.5 result backup", async () => {
    window.localStorage.setItem(
      "wc_result_v05",
      JSON.stringify({ answers: { private: "answer" }, coupleToken: "secret-token" }),
    );

    await act(async () => {
      root.render(
        <WeddingCodeV06Client shareOrigin="https://hanbang.ai" />,
      );
    });

    expect(window.localStorage.getItem("wc_result_v05")).toBeNull();
  });
});
