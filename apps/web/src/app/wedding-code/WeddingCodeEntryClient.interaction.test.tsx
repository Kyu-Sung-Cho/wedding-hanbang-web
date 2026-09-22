// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V30_QUESTIONS, WEDDING_CODE_V30_VERSION, type V30Draft } from "@/constants/weddingCodeV30";
import { createV30Draft, encodeV30 } from "@/lib/weddingCode/v30";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

vi.mock("./WeddingCodeV30Client", () => ({
  default: function V30Probe({ partnerDraft, bothDrafts, onRestart }: {
    partnerDraft: V30Draft | null;
    bothDrafts: { first: V30Draft; second: V30Draft } | null;
    onRestart: () => void;
  }) {
    const [touched, setTouched] = useState(false);
    return <section data-entry="v30" data-touched={touched}>
      <output>{JSON.stringify({ partnerDraft, bothDrafts })}</output>
      <button onClick={() => setTouched(true)}>local edit</button>
      <button onClick={onRestart}>restart</button>
    </section>;
  },
}));
vi.mock("./WeddingCodeV20Client", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => <section data-entry="v20"><button onClick={onRestart}>restart</button></section>,
}));
vi.mock("./WeddingCodeV06Client", () => ({
  default: ({ onRestart }: { onRestart: () => void }) => <section data-entry="legacy"><button onClick={onRestart}>restart</button></section>,
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

  it("손상된 fragment에서 다시 시작하면 빈 통합판을 연다", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v3.0-preferences&a=broken");
    await mount();
    expect(container.textContent).toContain("이 링크는 열 수 없어요");
    await restart();
    expect(window.location.hash).toBe("");
    expect(container.querySelector('[data-entry="v30"]')).not.toBeNull();
    expect(container.querySelector("output")?.textContent).toBe(JSON.stringify({ partnerDraft: null, bothDrafts: null }));
  });

  it("명시된 v20 query 입구에서 다시 시작하면 새 통합판으로 돌아간다", async () => {
    window.history.replaceState(null, "", "/wedding-code?v=v2.0-agreement");
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: "v2.0-agreement" })} />));
    expect(container.querySelector('[data-entry="v20"]')).not.toBeNull();
    await restart();
    expect(window.location.search).toBe("");
    expect(container.querySelector('[data-entry="v30"]')).not.toBeNull();
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
  });
});
