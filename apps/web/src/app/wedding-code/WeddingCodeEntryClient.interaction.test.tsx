// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_VERSION, type V30Draft } from "@/constants/weddingCodeV30";
import { createV30Draft, encodeV30 } from "@/lib/weddingCode/v30";
import { WEDDING_CODE_V31_VERSION, type V31Draft } from "@/constants/weddingCodeV31";
import { createV31Draft, encodeV31 } from "@/lib/weddingCode/v31";
import { CURRENT_WEDDING_CODE_SCENE_CONFIG } from "@/lib/weddingCode/scene/config";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

vi.mock("./WeddingCodeV31Client", () => ({
  default: function V31Probe({ partnerDraft, bothDrafts, onRestart, embedded }: {
    partnerDraft: V31Draft | null;
    bothDrafts: { first: V31Draft; second: V31Draft } | null;
    onRestart: () => void;
    embedded?: boolean;
  }) {
    const [touched, setTouched] = useState(false);
    return <section data-entry="v31" data-touched={touched} data-embedded={embedded}>
      <output>{JSON.stringify({ partnerDraft, bothDrafts })}</output>
      <button onClick={() => setTouched(true)}>local edit</button>
      <button onClick={onRestart}>restart</button>
    </section>;
  },
}));

vi.mock("./WeddingCodeV30Client", () => ({
  default: function V30Probe({ partnerDraft, bothDrafts, onRestart, embedded }: {
    partnerDraft: V30Draft | null;
    bothDrafts: { first: V30Draft; second: V30Draft } | null;
    onRestart: () => void;
    embedded?: boolean;
  }) {
    const [touched, setTouched] = useState(false);
    return <section data-entry="v30" data-touched={touched} data-embedded={embedded}>
      <output>{JSON.stringify({ partnerDraft, bothDrafts })}</output>
      <button onClick={() => setTouched(true)}>local edit</button>
      <button onClick={onRestart}>restart</button>
    </section>;
  },
}));
vi.mock("./WeddingCodeV20Client", () => ({
  default: ({ onRestart, embedded }: { onRestart: () => void; embedded?: boolean }) => <section data-entry="v20" data-embedded={embedded}><button onClick={onRestart}>restart</button></section>,
}));
vi.mock("./WeddingCodeV06Client", () => ({
  default: ({ onRestart, embedded }: { onRestart: () => void; embedded?: boolean }) => <section data-entry="legacy" data-embedded={embedded}><button onClick={onRestart}>restart</button></section>,
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const first: V30Draft = { ...createV30Draft(), answers: { [WEDDING_CODE_V30_QUESTIONS[0].id]: 1 } };
const second: V30Draft = { ...createV30Draft(), answers: { [WEDDING_CODE_V30_QUESTIONS[0].id]: 5 } };
const firstHash = `#v=${WEDDING_CODE_V30_VERSION}&a=${encodeV30(first)}`;

describe("웨딩코드 판별과 다시 시작", () => {
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
  async function mount() {
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
  }
  async function restart() {
    const button = [...container.querySelectorAll("button")].find(item => /restart|처음부터 답하기/.test(item.textContent ?? ""));
    expect(button).toBeDefined();
    await act(async () => button?.click());
  }

  it.each([
    [WEDDING_CODE_V31_VERSION, "v31"],
    [WEDDING_CODE_V30_VERSION, "v30"],
    ["v2.0-agreement", "v20"],
    [CURRENT_WEDDING_CODE_SCENE_CONFIG.version, "legacy"],
  ])("라운지에서도 %s 판별·다시 시작에 embedded를 유지한다", async (version, kind) => {
    window.history.replaceState(null, "", "/wedding/preparation-style");
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient embedded shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: version })} />));
    expect(container.querySelector(`[data-entry="${kind}"]`)?.getAttribute("data-embedded")).toBe("true");
    await restart();
    expect(container.querySelector('[data-entry="v31"]')?.getAttribute("data-embedded")).toBe("true");
    expect(window.location.pathname).toBe("/wedding/preparation-style");
  });

  it("라운지의 손상된 링크도 main을 중첩하지 않고 같은 자리에서 다시 시작한다", async () => {
    window.history.replaceState(null, "", "/wedding/preparation-style#v=v3.1-preferences&a=broken");
    root = createRoot(container);
    await act(async () => root?.render(<main><WeddingCodeEntryClient embedded shareOrigin="https://hanbang.ai" /></main>));
    expect(container.querySelectorAll("main")).toHaveLength(1);
    expect(container.textContent).toContain("이 링크는 열 수 없어요");
    await restart();
    expect(container.querySelector('[data-entry="v31"]')?.getAttribute("data-embedded")).toBe("true");
    expect(window.location.pathname).toBe("/wedding/preparation-style");
  });

  it("손상된 fragment에서 다시 시작하면 빈 통합판을 연다", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v3.0-preferences&a=broken");
    await mount();
    expect(container.textContent).toContain("이 링크는 열 수 없어요");
    await restart();
    expect(window.location.hash).toBe("");
    expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: null, bothDrafts: null }));
  });

  it("명시된 v20 query 입구에서 다시 시작하면 새 통합판으로 돌아간다", async () => {
    window.history.replaceState(null, "", "/wedding-code?v=v2.0-agreement");
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: "v2.0-agreement" })} />));
    expect(container.querySelector('[data-entry="v20"]')).not.toBeNull();
    await restart();
    expect(window.location.search).toBe("");
    expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
  });

  it("두 번째 응답만 바뀌어도 이전 결과의 편집 state를 넘기지 않는다", async () => {
    window.history.replaceState(null, "", `/wedding-code${firstHash}&b=${encodeV30(first)}`);
    await mount();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(container.querySelector("section")?.getAttribute("data-touched")).toBe("true");
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code${firstHash}&b=${encodeV30(second)}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(container.querySelector("section")?.getAttribute("data-touched")).toBe("false");
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: null, bothDrafts: { first, second } }));
  });

  it("SSR은 답을 지어내지 않고 hydration 뒤에 fragment를 적용한다", async () => {
    window.history.replaceState(null, "", `/wedding-code${firstHash}`);
    const element = <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />;
    container.innerHTML = renderToString(element);
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: null, bothDrafts: null }));
    const onRecoverableError = vi.fn();
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError }); });
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: first, bothDrafts: null }));
    expect(container.querySelector('[data-entry="v30"]')).not.toBeNull();
  });

  it("v31 커플의 두 번째 응답 변경과 이전 판 전환 때 편집 상태를 재사용하지 않는다", async () => {
    const a = createV31Draft(); a.answers.B1 = 5;
    const b = createV31Draft(); b.answers.B1 = 1;
    const hash = `#v=${WEDDING_CODE_V31_VERSION}&a=${encodeV31(a)}`;
    window.history.replaceState(null, "", `/wedding-code${hash}&b=${encodeV31(a)}`);
    await mount();
    expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code${hash}&b=${encodeV31(b)}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(container.querySelector("section")?.getAttribute("data-touched")).toBe("false");
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: null, bothDrafts: { first: a, second: b } }));
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code${firstHash}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    expect(container.querySelector('[data-entry="v30"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: first, bothDrafts: null }));
  });
});
