// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/copy";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

/** v4 화면 모듈이 실제로 요청됐는지와, 요청이 끝나는 시점을 시험이 쥔다. */
const chunk = vi.hoisted(() => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { requested: false, opened, open };
});

vi.mock("./WeddingCodeV40Client", async () => {
  chunk.requested = true;
  // 누군가 이 모듈을 정적으로 가져오면 시험이 멈추지 않고 아래 단언에서 빨갛게 되도록 기다림에 상한을 둔다.
  await Promise.race([chunk.opened, new Promise((resolve) => setTimeout(resolve, 1500))]);
  return { default: () => <section data-entry="v40" /> };
});
vi.mock("./WeddingCodeV31Client", () => ({
  default: () => <section data-entry="v31" />,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("웨딩코드 입구: v4 화면은 v4 를 여는 방문자만 불러온다", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  beforeEach(() => {
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("v3.1 입구는 v4 모듈을 요청하지 않고, v4 입구는 불러오는 동안 낭독용 글을 보이다가 불러온 뒤 바꾼다", async () => {
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
    expect(chunk.requested).toBe(false);
    await act(async () => root?.unmount());

    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V40_VERSION}`);
    root = createRoot(container);
    await act(async () => root?.render(
      <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V40_VERSION })} />,
    ));
    expect(chunk.requested).toBe(true);
    expect(container.querySelector('[data-entry="v40"]')).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(V40_ENTRY_COPY.loadingLabel);

    await act(async () => {
      chunk.open();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.querySelector('[data-entry="v40"]')).not.toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });
});
