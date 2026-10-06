// @vitest-environment jsdom

import { StrictMode, act, useState } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import { WEDDING_CODE_V40_BANK } from "@/lib/weddingCode/v40/bank";
import { encodeCode } from "@/lib/weddingCode/v40/codec";
import { V40_ENTRY_COPY } from "@/lib/weddingCode/v40/copy";
import { fixtureByName } from "@/lib/weddingCode/v40/fixtures";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

vi.mock("./WeddingCodeV40Client", () => ({
  default: function V40Probe({ initial, resolved, embedded, onRestart, initialNotice, shareOrigin }: WeddingCodeV40ClientProps) {
    const [touched, setTouched] = useState(false);
    return <section
      data-entry="v40"
      data-mode={initial.both ? "both" : initial.partner ? "partner" : "empty"}
      data-resolved={String(resolved)}
      data-embedded={String(embedded)}
      data-notice={initialNotice}
      data-origin={shareOrigin}
      data-touched={touched}
    >
      <button onClick={() => setTouched(true)}>touch</button>
      <button onClick={() => onRestart?.()}>restart</button>
      <button onClick={() => onRestart?.("다시 시작했어요")}>restart with message</button>
      <button onClick={() => window.history.replaceState(null, "", window.location.pathname)}>clear address</button>
    </section>;
  },
}));

vi.mock("./WeddingCodeV42Client", () => ({
  default: ({ onRestart }: WeddingCodeV40ClientProps) => <section data-entry="v42"><button onClick={() => onRestart?.()}>restart</button></section>,
}));
vi.mock("./WeddingCodeV43Client", () => ({
  default: ({ onRestart }: WeddingCodeV40ClientProps) => <section data-entry="v43"><button onClick={() => onRestart?.()}>restart</button></section>,
}));

vi.mock("./WeddingCodeV31Client", () => ({
  default: function V31Probe({ onRestart, embedded, initialNotice }: { onRestart: (message?: string) => void; embedded?: boolean; initialNotice?: string }) {
    return <section data-entry="v31" data-embedded={embedded} data-notice={initialNotice}>
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

const V40 = WEDDING_CODE_V40_VERSION;
function codeOf(name: string): string {
  const fixture = fixtureByName(name);
  const code = fixture ? encodeCode(WEDDING_CODE_V40_BANK, fixture.formBit, fixture.responses) : null;
  if (code === null) throw new Error(`코드를 만들 수 없어요: ${name}`);
  return code;
}
const A = codeOf("swua-example");
const B = codeOf("couple-partner");
const soloHash = `#v=${V40}&a=${A}`;
const pairHash = `${soloHash}&b=${B}`;

describe("웨딩코드 입구: v4.0-tendency 를 늦게 불러오고 넘기는 값", () => {
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
    vi.restoreAllMocks();
  });
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  async function mount(props: Partial<Parameters<typeof WeddingCodeEntryClient>[0]> = {}) {
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" {...props} />));
    await flush();
  }
  const probe = () => container.querySelector<HTMLElement>('[data-entry="v40"]');
  async function click(label: RegExp | string) {
    const button = [...container.querySelectorAll("button")].find((item) => (typeof label === "string" ? item.textContent === label : label.test(item.textContent ?? "")));
    expect(button, String(label)).toBeDefined();
    await act(async () => button?.click());
    await flush();
  }

  it("답 없는 명시 진입(?v=v4.0-tendency)은 빈 v4 화면을 열고 값을 그대로 넘긴다", async () => {
    window.history.replaceState(null, "", `/wedding-code?v=${V40}`);
    await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: V40 }) });
    expect(probe()?.dataset.mode).toBe("empty");
    expect(probe()?.dataset.resolved).toBe("true");
    expect(probe()?.dataset.embedded).toBe("false");
    expect(probe()?.dataset.notice).toBe("");
    expect(probe()?.dataset.origin).toBe("https://hanbang.ai");
    expect(container.querySelector('[data-entry="v31"]')).toBeNull();
  });

  it("v3.1 길로 들어온 방문자에게는 v4 화면을 불러오지 않는다", async () => {
    await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: "v3.1-preferences" }) });
    expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
    expect(probe()).toBeNull();
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("받은 링크(a)와 두 사람 결과(a와 b)는 hydration 뒤에 주소의 # 뒤에서 읽는다", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    await mount();
    expect(probe()?.dataset.mode).toBe("partner");
    expect(probe()?.dataset.resolved).toBe("true");
    expect(probe()?.dataset.notice).toBe("");
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code${pairHash}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    await flush();
    expect(probe()?.dataset.mode).toBe("both");
  });

  it("SSR 은 답을 지어내지 않고 hydration 뒤에 링크를 적용한다(해석이 끝나기 전에는 resolved 가 거짓)", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    const element = <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: V40 })} />;
    const html = renderToString(element);
    expect(html).not.toContain(A);
    expect(html).not.toContain('data-mode="partner"');
    container.innerHTML = html;
    const onRecoverableError = vi.fn();
    await act(async () => { root = hydrateRoot(container, element, { onRecoverableError }); });
    await flush();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(probe()?.dataset.mode).toBe("partner");
    expect(probe()?.dataset.resolved).toBe("true");
  });

  it("라운지 안(embedded)에서도 v4 화면에 embedded 를 넘긴다", async () => {
    window.history.replaceState(null, "", "/wedding/preparation-style");
    await mount({ embedded: true, initialEntry: parseWeddingCodeEntryQuery({ v: V40 }) });
    expect(probe()?.dataset.embedded).toBe("true");
  });

  it("v4 화면이 주소의 # 뒤를 지워도(이벤트 없음) 입구가 받은 링크를 기본 입구로 되돌리지 않는다", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    const element = <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />;
    root = createRoot(container);
    await act(async () => root?.render(element));
    await flush();
    await click("touch");
    expect(probe()?.dataset.touched).toBe("true");
    await click("clear address");
    expect(window.location.hash).toBe("");
    // 부모가 다시 그려져도(새 element) 받는 사람 화면이 그대로 남고 다시 만들어지지 않는다.
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" embedded={false} />));
    await flush();
    expect(probe()?.dataset.mode).toBe("partner");
    expect(probe()?.dataset.touched).toBe("true");
    expect(container.querySelector('[data-entry="v31"]')).toBeNull();
    // 주소가 빈 채로 난 popstate, hashchange 는 이동이 아니다(직접 낸 가짜 이벤트도 마찬가지). 상대의 답과 하던 답이 조용히 사라지면 안 된다.
    await act(async () => { window.dispatchEvent(new Event("popstate")); });
    await flush();
    await act(async () => { window.dispatchEvent(new Event("hashchange")); });
    await flush();
    expect(probe()?.dataset.mode).toBe("partner");
    expect(probe()?.dataset.touched).toBe("true");
    expect(container.querySelector('[data-entry="v31"]')).toBeNull();
    // 사용자가 실제로 새 # 뒤로 이동하면 붙잡고 있던 링크를 놓고 새 주소를 읽는다(알 수 없는 조각이라 열 수 없는 링크 안내가 뜬다).
    await act(async () => {
      window.history.replaceState(null, "", "/wedding-code#somewhere-else");
      window.dispatchEvent(new Event("hashchange"));
    });
    await flush();
    expect(probe()).toBeNull();
    expect(container.textContent).toContain("이 링크는 열 수 없어요");
  });

  it("주소를 지운 뒤 빈 popstate 를 여러 번 받아도 받는 사람 화면이 그대로다(StrictMode 포함)", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    root = createRoot(container);
    await act(async () => root?.render(<StrictMode><WeddingCodeEntryClient shareOrigin="https://hanbang.ai" /></StrictMode>));
    await flush();
    await click("touch");
    await click("clear address");
    for (let index = 0; index < 3; index += 1) {
      await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    }
    await flush();
    expect(probe()?.dataset.mode).toBe("partner");
    expect(probe()?.dataset.touched).toBe("true");
  });

  it("주소를 지운 뒤 다른 v4 링크로 이동하면 새 링크로 다시 만든다", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    await mount();
    await click("touch");
    await click("clear address");
    await act(async () => {
      window.history.replaceState(null, "", `/wedding-code${pairHash}`);
      window.dispatchEvent(new Event("hashchange"));
    });
    await flush();
    expect(probe()?.dataset.mode).toBe("both");
    expect(probe()?.dataset.touched).toBe("false");
  });

  it("v4 화면의 다시 시작은 v4 빈 입구로 가고, 새로고침해도 같은 판이 열리게 ?v= 만 남긴다", async () => {
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    await mount();
    await click("touch");
    await click("restart with message");
    expect(probe()?.dataset.mode).toBe("empty");
    expect(probe()?.dataset.notice).toBe("다시 시작했어요");
    expect(probe()?.dataset.touched).toBe("false");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${V40}`);
    expect(window.location.pathname).toBe("/wedding-code");
    expect(container.querySelector('[data-entry="v31"]')).toBeNull();
    // 새로고침: 그 주소를 서버가 다시 읽으면 v4 빈 입구다.
    expect(parseWeddingCodeEntryQuery(new URLSearchParams(window.location.search))).toEqual({ kind: "v40", initial: { partner: null, both: null } });
  });

  it("v4 빈 입구에서 다시 시작해도 화면 state 를 이어받지 않는다", async () => {
    window.history.replaceState(null, "", `/wedding-code?v=${V40}`);
    await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: V40 }) });
    await click("touch");
    expect(probe()?.dataset.touched).toBe("true");
    await click(/^restart$/);
    expect(probe()?.dataset.mode).toBe("empty");
    expect(probe()?.dataset.touched).toBe("false");
    expect(window.location.search).toBe(`?v=${V40}`);
  });

  it("라운지에서 다시 시작해도 경로를 바꾸지 않는다", async () => {
    window.history.replaceState(null, "", `/wedding/preparation-style${soloHash}`);
    await mount({ embedded: true });
    await click(/^restart$/);
    expect(window.location.pathname).toBe("/wedding/preparation-style");
    expect(probe()?.dataset.embedded).toBe("true");
  });

  it("v3.1 다시 시작은 그 판으로, 더 옛 판은 현재 기본판으로 간다", async () => {
    for (const [query, kind] of [["v3.1-preferences", "v31"], ["v3.0-preferences", "v30"], ["v2.0-agreement", "v20"]] as const) {
      window.history.replaceState(null, "", `/wedding-code?v=${query}`);
      await act(async () => root?.unmount());
      root = undefined;
      await mount({ initialEntry: parseWeddingCodeEntryQuery({ v: query }) });
      expect(container.querySelector(`[data-entry="${kind}"]`), kind).not.toBeNull();
      await click(/^restart$/);
      if (kind === "v31") {
        expect(container.querySelector('[data-entry="v31"]')).not.toBeNull();
        expect(window.location.search).toBe("?v=v3.1-preferences");
      } else {
        expect(container.querySelector('[data-entry="v43"]')).not.toBeNull();
        expect(window.location.search).toBe("");
      }
    }
  });

  it("v4 를 여는 동안 브라우저 저장소를 입구가 건드리지 않는다(이전 판 진행 저장은 v4 저장 모듈의 몫)", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    window.history.replaceState(null, "", `/wedding-code${soloHash}`);
    await mount();
    await click(/^restart$/);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });
});

describe("웨딩코드 입구: 읽을 수 없는 v4 링크", () => {
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

  it.each([
    ["해시의 깨진 코드", `#v=${V40}&a=broken`, false],
    ["해시의 반쪽 링크", `#v=${V40}&b=${B}`, false],
    ["라운지 안의 깨진 코드", `#v=${V40}&a=${A.slice(0, -1)}`, true],
  ])("%s: 기존 오류 화면에 v4 문구가 나오고 처음부터 시작하면 v4 빈 입구다", async (_label, hash, embedded) => {
    window.history.replaceState(null, "", `${embedded ? "/wedding/preparation-style" : "/wedding-code"}${hash}`);
    root = createRoot(container);
    const entry = <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" embedded={embedded} />;
    // 라운지 안에서는 바깥 셸이 main 을 가지고 있으므로 오류 화면이 main 을 중첩하지 않아야 한다.
    await act(async () => root?.render(embedded ? <main>{entry}</main> : entry));
    await flush();
    const broken = V40_ENTRY_COPY.brokenLink;
    expect(container.querySelector("h1")?.textContent).toBe(broken.title);
    expect(container.textContent).toContain(broken.body);
    expect(container.textContent).not.toContain("이 링크는 열 수 없어요");
    expect(container.querySelectorAll("main")).toHaveLength(1);
    // 깨진 조각은 주소창에서 지워지지만 화면은 그대로 남고, 초점은 화면 이름(이 화면의 제목)을 가진 구역으로 간다.
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${V40}`);
    const screen = container.querySelector("section");
    expect(screen?.getAttribute("aria-labelledby")).toBe(container.querySelector("h1")?.id);
    expect(document.activeElement).toBe(screen);
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === broken.startButton);
    expect(button).toBeDefined();
    await act(async () => button?.click());
    await flush();
    const opened = container.querySelector<HTMLElement>('[data-entry="v40"]');
    expect(opened?.dataset.mode).toBe("empty");
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?v=${V40}`);
    expect(window.location.pathname).toBe(embedded ? "/wedding/preparation-style" : "/wedding-code");
  });

  it("query 에 답이 실린 v4 주소도 같은 v4 오류 화면이고, 주소창과 이력에서 답을 지운다", async () => {
    window.history.replaceState(null, "", `/wedding-code?v=${V40}&a=${A}`);
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: V40, a: A })} />));
    expect(container.querySelector("h1")?.textContent).toBe(V40_ENTRY_COPY.brokenLink.title);
    expect(window.location.search).toBe(`?v=${V40}`);
    expect(window.location.href).not.toContain(A);
  });

  it.each([
    ["ga 만 query 에 실린 v4 주소", `/wedding-code?v=${V40}&ga=1148056W`, { v: V40, ga: "1148056W" }],
    ["gb 만 query 에 실린 v4 주소", `/wedding-code?v=${V40}&gb=1401384H`, { v: V40, gb: "1401384H" }],
    ["answer 도 짐작도 query 에 실린 v4 주소", `/wedding-code?v=${V40}&a=${A}&ga=1148056W`, { v: V40, a: A, ga: "1148056W" }],
  ])("%s: v4 오류 화면이고, 주소창과 이력에서 짐작 글자도 지운다(서로 짐작하기의 ga, gb)", async (_label, url, query) => {
    window.history.replaceState(null, "", url);
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery(query)} />));
    expect(container.querySelector("h1")?.textContent).toBe(V40_ENTRY_COPY.brokenLink.title);
    expect(window.location.search).toBe(`?v=${V40}`);
    expect(window.location.href).not.toMatch(/g[ab]=/u);
    expect(window.location.href).not.toContain("1148056W");
    expect(window.location.href).not.toContain("1401384H");
  });

  it("해시의 깨진 ga 도 v4 오류 화면이고 주소창의 # 뒤를 지운다", async () => {
    window.history.replaceState(null, "", `/wedding-code#v=${V40}&a=${A}&ga=1148056X`);
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    await flush();
    expect(container.querySelector("h1")?.textContent).toBe(V40_ENTRY_COPY.brokenLink.title);
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain("1148056X");
  });

  it("다른 판의 깨진 링크는 주소창을 건드리지 않는다(v4 가 아닌 판은 예전 그대로다)", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v3.0-preferences&a=broken");
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    expect(window.location.hash).toBe("#v=v3.0-preferences&a=broken");
  });

  it("다른 판의 깨진 링크는 예전 오류 화면 그대로이고 처음부터 답하면 현재 기본판이다", async () => {
    window.history.replaceState(null, "", "/wedding-code#v=v3.0-preferences&a=broken");
    root = createRoot(container);
    await act(async () => root?.render(<WeddingCodeEntryClient shareOrigin="https://hanbang.ai" />));
    expect(container.querySelector("h1")?.textContent).toBe("이 링크는 열 수 없어요");
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "처음부터 답하기");
    await act(async () => button?.click());
    expect(container.querySelector('[data-entry="v43"]')).not.toBeNull();
    expect(window.location.search).toBe("");
  });
});
