// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V31_VERSION } from "@/constants/weddingCodeV31";
import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/copy";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

/**
 * 기본 진입 교체 PR(상수 하나)이 낼 결과를 미리 굳힌다. 상수만 v4 로 바꾼 입구를 만들어 그 뒤의 규칙을 시험한다:
 * 맨 주소는 v4, 명시 ?v=v3.1-preferences(답 없음)는 「이전 판이에요」가 붙은 v3.1, v3.1 화면의 다시 시작은 v3.1 빈 입구,
 * v4 로 가는 길은 「새 판으로 시작하기」 단추뿐. 답이 든 옛 링크는 예전 화면 그대로.
 */
vi.mock("./entry", async (importOriginal) => {
  const original = await importOriginal<typeof import("./entry")>();
  return { ...original, WEDDING_CODE_DEFAULT_VERSION: "v4.0-tendency" };
});

vi.mock("./WeddingCodeV40Client", () => ({
  default: function V40Probe({ initial, onRestart, initialNotice }: WeddingCodeV40ClientProps) {
    const [touched, setTouched] = useState(false);
    return <section data-entry="v40" data-mode={initial.both ? "both" : initial.partner ? "partner" : "empty"} data-notice={initialNotice} data-touched={touched}>
      <button onClick={() => setTouched(true)}>touch</button>
      <button onClick={() => onRestart?.()}>restart</button>
    </section>;
  },
}));
vi.mock("./WeddingCodeV31Client", () => ({
  default: function V31Probe({ onRestart, partnerDraft }: { onRestart: (message?: string) => void; partnerDraft: unknown }) {
    return <section data-entry="v31" data-partner={partnerDraft ? "yes" : "no"}>
      <button onClick={() => onRestart()}>restart</button>
    </section>;
  },
}));
vi.mock("./WeddingCodeV30Client", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => <section data-entry="v30"><button onClick={onRestart}>restart</button></section>,
}));
vi.mock("./WeddingCodeV20Client", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => <section data-entry="v20"><button onClick={onRestart}>restart</button></section>,
}));
vi.mock("./WeddingCodeV06Client", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => <section data-entry="legacy"><button onClick={onRestart}>restart</button></section>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const V31 = WEDDING_CODE_V31_VERSION;
const V40 = WEDDING_CODE_V40_VERSION;
const v31Code = encodeV31({ ...createV31Draft(), answers: { B1: 5 } });

describe("웨딩코드 입구: 기본 진입을 v4 로 바꾼 뒤", () => {
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
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  async function mount(props: Partial<Parameters<typeof WeddingCodeEntryClient>[0]> = {}) {
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" {...props} />));
    await flush();
  }
  async function click(label: RegExp | string) {
    const button = [...container.querySelectorAll("button")].find((item) => (typeof label === "string" ? item.textContent === label : label.test(item.textContent ?? "")));
    expect(button, String(label)).toBeDefined();
    await act(async () => button?.click());
    await flush();
  }
  const has = (kind: string) => container.querySelector(`[data-entry="${kind}"]`) !== null;
  const older = () => container.querySelector("[data-older-version]");

  it("맨 주소는 v4 빈 입구이고 이전 판 안내는 없다", async () => {
    await mount();
    expect(has("v40")).toBe(true);
    expect(container.querySelector<HTMLElement>('[data-entry="v40"]')?.dataset.mode).toBe("empty");
    expect(has("v31")).toBe(false);
    expect(older()).toBeNull();
  });

  it("명시 ?v=v3.1-preferences(답 없음)는 v3.1 시작 화면 위에 「이전 판이에요」와 「새 판으로 시작하기」가 붙는다", async () => {
    window.history.replaceState(null, "", `/wedding-code?v=${V31}`);
    await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: V31 }, { defaultVersion: V40 }) });
    expect(has("v31")).toBe(true);
    expect(older()?.textContent).toContain(V40_ENTRY_COPY.olderVersion.notice);
    const start = [...(older()?.querySelectorAll("button") ?? [])].find((item) => item.textContent === V40_ENTRY_COPY.olderVersion.startNewButton);
    expect(start).toBeDefined();
    await click(V40_ENTRY_COPY.olderVersion.startNewButton);
    expect(has("v40")).toBe(true);
    expect(has("v31")).toBe(false);
    expect(older()).toBeNull();
    // 기본 판으로 갔으니 주소에 ?v= 를 남기지 않는다.
    expect(window.location.search).toBe("");
  });

  it("v3.1 화면의 다시 시작은 v3.1 빈 입구(이전 판 안내 유지)이고 새로고침해도 v3.1 이다", async () => {
    window.history.replaceState(null, "", `/wedding-code?v=${V31}`);
    await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: V31 }, { defaultVersion: V40 }) });
    await click(/^restart$/);
    expect(has("v31")).toBe(true);
    expect(has("v40")).toBe(false);
    expect(older()).not.toBeNull();
    expect(window.location.search).toBe(`?v=${V31}`);
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(window.location.search), { defaultVersion: V40 })).toMatchObject({ kind: "v31", older: true });
  });

  it("답이 든 v3.1 링크와 다른 판의 옛 링크는 예전 화면 그대로이고 이전 판 안내가 붙지 않는다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=${V31}&a=${v31Code}`);
    await mount();
    expect(container.querySelector<HTMLElement>('[data-entry="v31"]')?.dataset.partner).toBe("yes");
    expect(older()).toBeNull();
    expect(has("v40")).toBe(false);
  });

  it("v3.0, v2.0 화면의 다시 시작은 그때의 기본 판(v4)이다", async () => {
    for (const [query, kind] of [["v3.0-preferences", "v30"], ["v2.0-agreement", "v20"]] as const) {
      window.history.replaceState(null, "", `/wedding-code?v=${query}`);
      await act(async () => root?.unmount());
      root = undefined;
      await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: query }, { defaultVersion: V40 }) });
      expect(has(kind), kind).toBe(true);
      await click(/^restart$/);
      expect(has("v40"), kind).toBe(true);
      expect(window.location.search, kind).toBe("");
    }
  });

  it("깨진 옛 링크의 처음부터 답하기는 v4, 깨진 v4 링크의 처음부터 시작하기도 v4 빈 입구다", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v3.0-preferences&a=broken");
    await mount();
    await click("처음부터 답하기");
    expect(has("v40")).toBe(true);
    expect(window.location.search).toBe("");
    await act(async () => root?.unmount());
    root = undefined;
    window.history.replaceState(null, "", `/wedding-code#v=${V40}&a=broken`);
    await mount();
    await click(V40_ENTRY_COPY.brokenLink.startButton);
    expect(has("v40")).toBe(true);
    expect(window.location.search).toBe("");
  });

  it("v4 화면의 다시 시작은 v4 빈 입구이고 기본 판이라 주소에 ?v= 를 남기지 않는다", async () => {
    await mount();
    await click("touch");
    await click(/^restart$/);
    expect(container.querySelector<HTMLElement>('[data-entry="v40"]')?.dataset.touched).toBe("false");
    expect(window.location.search).toBe("");
  });
});
