// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WEDDING_CODE_V42_VERSION } from "@/constants/weddingCodeV42";
import { WEDDING_CODE_V42_BANK } from "@/lib/weddingCode/v42/bank";
import { encodeCode } from "@/lib/weddingCode/v42/codec";
import { WEDDING_CODE_V43_BANK } from "@/lib/weddingCode/v43/bank";
import { encodeCode as encodeCurrent } from "@/lib/weddingCode/v43/codec";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

vi.mock("./WeddingCodeV42Client", () => ({
  default: ({ initial, onRestart }: WeddingCodeV40ClientProps) => <section data-entry="v42" data-received={initial.partner ? "partner" : initial.both ? "both" : "clean"}><button onClick={() => onRestart?.()}>restart</button></section>,
}));
vi.mock("./WeddingCodeV43Client", () => ({
  default: ({ initial, onRestart }: WeddingCodeV40ClientProps) => <section data-entry="v43" data-received={initial.partner ? "partner" : initial.both ? "both" : "clean"}><button onClick={() => onRestart?.()}>restart</button></section>,
}));
vi.mock("./WeddingCodeV40Client", () => ({
  default: () => <section data-entry="v40" />,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fixture = fixtureByName("swua-example");
if (!fixture) throw new Error("fixture missing");
const code = encodeCode(WEDDING_CODE_V42_BANK, fixture.formBit, fixture.responses);
if (!code) throw new Error("fixture code missing");

describe("v4.2 입구와 늦게 불러오는 화면", () => {
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
    expect(container.querySelector('[data-entry]')).not.toBeNull();
  };

  it("답 없는 명시 URL에서 v4.2 화면을 불러온다", async () => {
    await render(parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V42_VERSION }));
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("clean");
    expect(container.querySelector('[data-entry="v40"]')).toBeNull();
  });

  it("맨 주소에서는 미팅 수정 문항판 v4.3을 불러오고 옛 판을 대신 열지 않는다", async () => {
    await render();
    expect(container.querySelector('[data-entry="v43"]')?.getAttribute("data-received")).toBe("clean");
    expect(container.querySelector('[data-entry="v42"]')).toBeNull();
    expect(window.location.search).toBe("");
  });

  it("v4.3 받은 답은 주소 정리·빈 이동에도 보존되고 재시작은 같은 판이다", async () => {
    const currentCode = encodeCurrent(WEDDING_CODE_V43_BANK, fixture.formBit, fixture.responses);
    window.history.replaceState(null, "", `/wedding-code#v=v4%2E3-depth&a=${currentCode}`);
    await render();
    expect(container.querySelector('[data-entry="v43"]')?.getAttribute("data-received")).toBe("partner");
    window.history.replaceState(null, "", "/wedding-code?v=v4.3-depth");
    await act(async () => window.dispatchEvent(new PopStateEvent("popstate")));
    expect(container.querySelector('[data-entry="v43"]')?.getAttribute("data-received")).toBe("partner");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-entry="v43"] button')?.click());
    expect(window.location.search).toBe("?v=v4.3-depth");
    expect(container.querySelector('[data-entry="v43"]')?.getAttribute("data-received")).toBe("clean");
  });

  it("fragment의 답은 하이드레이션 뒤 v4.2에만 넘기고 재시작 URL은 같은 판으로 고정한다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=${WEDDING_CODE_V42_VERSION}&a=${code}`);
    await render();
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("partner");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-entry="v42"] button')?.click());
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${WEDDING_CODE_V42_VERSION}`);
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("clean");
  });

  it("판 이름이 퍼센트 인코딩된 정상 링크도 주소를 지운 뒤의 빈 이동 이벤트에서 유지한다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=v4%2E2-depth&a=${code}`);
    await render();
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("partner");
    window.history.replaceState(null, "", "/wedding-code?v=v4.2-depth");
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    await act(async () => { window.dispatchEvent(new Event("hashchange")); });
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("partner");
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" embedded />));
    expect(container.querySelector('[data-entry="v42"]')?.getAttribute("data-received")).toBe("partner");
  });
});
