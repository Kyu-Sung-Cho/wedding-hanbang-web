// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V41_VERSION } from "@/constants/weddingCodeV41";
import { WEDDING_CODE_V41_BANK } from "@/lib/weddingCode/v41/bank";
import { encodeCode } from "@/lib/weddingCode/v41/codec";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

vi.mock("./WeddingCodeV41Client", () => ({
  default: ({ initial, onRestart }: WeddingCodeV40ClientProps) => <section data-entry="v41" data-received={initial.partner ? "partner" : initial.both ? "both" : "clean"}><button onClick={() => onRestart?.()}>restart</button></section>,
}));
vi.mock("./WeddingCodeV40Client", () => ({
  default: () => <section data-entry="v40" />,
}));
vi.mock("./WeddingCodeV42Client", () => ({
  default: () => <section data-entry="v42" />,
}));
vi.mock("./WeddingCodeV43Client", () => ({
  default: () => <section data-entry="v43" />,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = fixtureByName("swua-example");
if (!fixture) throw new Error("fixture missing");
const code = encodeCode(WEDDING_CODE_V41_BANK, fixture.formBit, fixture.responses);
if (!code) throw new Error("fixture code missing");

describe("v4.1 입구와 늦게 불러오는 화면", () => {
  let container: HTMLDivElement;
  let root: Root | null = null;
  beforeEach(() => {
    window.history.replaceState(null, "", "/wedding-code");
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = null;
    container.remove();
  });
  const render = async (initialEntry?: ReturnType<typeof parseWeddingCodeEntryQuery>) => {
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={initialEntry} />));
    await act(async () => { await vi.dynamicImportSettled(); });
    expect(container.querySelector('[data-entry="v41"], [data-entry="v43"]')).not.toBeNull();
  };

  it("답 없는 명시 URL에서 v4.1 화면을 불러온다", async () => {
    await render(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V41_VERSION }));
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("clean");
    expect(container.querySelector('[data-entry="v40"]')).toBeNull();
  });

  it("맨 주소는 새 판을 불러오고 명시 v4.1은 따로 열린다", async () => {
    await render();
    expect(container.querySelector('[data-entry="v43"]')).not.toBeNull();
    expect(container.querySelector('[data-entry="v41"]')).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("fragment의 답은 하이드레이션 뒤 v4.1에만 넘기고 재시작 URL은 같은 판으로 고정한다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=${WEDDING_CODE_V41_VERSION}&a=${code}`);
    await render();
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("partner");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-entry="v41"] button')?.click());
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${WEDDING_CODE_V41_VERSION}`);
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("clean");
  });

  it("판 이름이 퍼센트 인코딩된 정상 링크도 주소를 지운 뒤의 빈 이동 이벤트에서 유지한다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=v4%2E1-depth&a=${code}`);
    await render();
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("partner");
    window.history.replaceState(null, "", "/wedding-code?v=v4.1-depth");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await act(async () => { window.dispatchEvent(new Event("hashchange")); });
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("partner");
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" embedded />));
    expect(container.querySelector('[data-entry="v41"]')?.getAttribute("data-received")).toBe("partner");
  });
});
