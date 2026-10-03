// @vitest-environment jsdom

import { PassThrough } from "node:stream";
import { StrictMode, act, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToPipeableStream } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WEDDING_CODE_V40_VERSION } from "@/constants/weddingCodeV40";
import type { WeddingCodeV40ClientProps } from "@/lib/weddingCode/v40/types";
import WeddingCodeEntryClient from "./WeddingCodeEntryClient";
import { parseWeddingCodeEntryQuery } from "./entry";

/**
 * 링크 없이 연 v4 입구: 서버가 그린 화면을 하이드레이션이 이어받는가.
 *
 * 입구는 하이드레이션 직후 주소의 # 뒤를 읽으려고 반드시 한 번 다시 그려진다. 그 사이에 v4 화면이 아직 불러와지지 않았다면(늦게 불러오는 경계),
 * 경계에 넘기는 props 가 새로 만들어진 순간 React 는 서버 화면 이어받기를 포기하고 지운 뒤 다시 그린다. 그러면 서버가 그린 소개가 잠깐 사라지고
 * 읽던 사람의 초점과 스크롤이 흔들린다. 여기서는 실제 next/dynamic 경계와 서버 스트리밍 렌더로 그 순서를 그대로 재현해서, 서버가 그린 노드가
 * 하이드레이션 뒤에도 같은 노드인지 본다.
 */

/**
 * 시험 환경의 next/dynamic 은 pages 판이라 서버 렌더에서 불러오는 자리만 그린다. 앱 라우터가 번들링할 때 쓰는 판(app-dynamic)으로 바꿔서
 * 서버가 불러온 화면까지 그리고 클라이언트는 하이드레이션 중에 경계가 풀리기를 기다리는 실제 순서를 따른다.
 */
vi.mock("next/dynamic", async () => {
  const appDynamic = (await import("next/dist/shared/lib/app-dynamic")) as unknown as { default: unknown };
  return { default: appDynamic.default };
});

/** v4 화면의 모의. 서버에서도 클라이언트에서도 불러오기가 한 박자 늦게 끝나는 모듈이다(진짜 늦게 불러오는 경계와 같다). */
const probes = vi.hoisted(() => ({ renders: 0 }));
vi.mock("./WeddingCodeV40Client", async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return {
    default: function V40Probe({ initial, resolved }: WeddingCodeV40ClientProps) {
      probes.renders += 1;
      return <section data-probe="" data-resolved={String(resolved)} data-mode={initial.both ? "both" : initial.partner ? "partner" : "empty"} />;
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Suspense 경계까지 모두 풀린 서버 HTML(스트리밍으로 받되 다 준비된 뒤에 읽는다). */
function serverHtml(element: ReactElement): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const out = new PassThrough();
    out.on("data", (chunk) => chunks.push(String(chunk)));
    out.on("end", () => resolve(chunks.join("")));
    // 진짜 서버에는 window 가 없다. next/dynamic 의 ssr: false 는 window 가 없을 때만 서버 그림에서 물러서므로(jsdom 의 window 가 있으면 그 갈래가 가려진다)
    // 서버 HTML 을 만드는 동안은 같은 조건으로 그린다. 다 그려지거나 오류가 나면 바로 돌려놓는다.
    vi.stubGlobal("window", undefined);
    const stream = renderToPipeableStream(element, {
      onAllReady() {
        vi.unstubAllGlobals();
        stream.pipe(out);
      },
      onError(error) {
        vi.unstubAllGlobals();
        reject(error);
      },
    });
  });
}

describe("웨딩코드 입구: 서버가 그린 v4 소개를 하이드레이션이 이어받는다", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let consoleError: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    probes.renders = 0;
    window.history.replaceState(null, "", `/wedding-code?v=${WEDDING_CODE_V40_VERSION}`);
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.append(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
    consoleError.mockRestore();
  });
  const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });

  const entry = (): ReactElement => (
    <WeddingCodeEntryClient shareOrigin="https://hanbang.ai" initialEntry={parseWeddingCodeEntryQuery({ v: WEDDING_CODE_V40_VERSION })} />
  );

  it("서버 HTML 에 v4 화면이 있고, 하이드레이션 뒤에도 그 노드를 그대로 쓴다(지우고 다시 그리지 않는다)", async () => {
    const html = await serverHtml(entry());
    expect(html).toContain("data-probe");
    container.innerHTML = html;
    const serverNode = container.querySelector("[data-probe]");
    expect(serverNode).not.toBeNull();
    probes.renders = 0; // 서버 렌더가 센 것은 빼고 클라이언트의 그림만 센다.

    const onRecoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, entry(), { onRecoverableError });
    });
    await flush();

    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("[data-probe]")).toBe(serverNode);
    // 입구가 하이드레이션 뒤에 다시 그려졌어도 v4 화면에는 같은 props 가 갔으므로 화면도 한 번만 그려졌다.
    expect(probes.renders).toBe(1);
  });

  it("v4 화면에 넘기는 resolved 는 하이드레이션 전후로 같다(본체가 스스로 하이드레이션이 끝났는지 안다)", async () => {
    container.innerHTML = await serverHtml(entry());
    expect(container.querySelector("[data-probe]")?.getAttribute("data-resolved")).toBe("true");
    await act(async () => {
      root = hydrateRoot(container, entry(), { onRecoverableError: vi.fn() });
    });
    await flush();
    expect(container.querySelector("[data-probe]")?.getAttribute("data-resolved")).toBe("true");
  });

  it("StrictMode 로 감싸도 서버 노드를 이어받는다", async () => {
    container.innerHTML = await serverHtml(entry());
    const serverNode = container.querySelector("[data-probe]");
    const onRecoverableError = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, <StrictMode>{entry()}</StrictMode>, { onRecoverableError });
    });
    await flush();
    expect(onRecoverableError).not.toHaveBeenCalled();
    expect(container.querySelector("[data-probe]")).toBe(serverNode);
  });
});
