import { StrictMode, act, useEffect, useSyncExternalStore, type ReactElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { click } from "@/components/wedding-code/v40/inputTestKit";
import { V40_COUNTS } from "@/constants/weddingCodeV40";
import { captureWeddingCodeEvent } from "@/lib/analytics";
import { V40_COPY, introBullets, introStorage } from "@/lib/weddingCode/v40/copy";
import { WeddingCodeV40ClientWithDeps } from "./WeddingCodeV40Client";
import {
  FakeStorage,
  NOW,
  buttonWithText,
  clientProps,
  decodedOf,
  fixture,
  partialSnapshotOf,
  screenName,
  seedProgress,
  settle,
  textOf,
  type ClientOverrides,
} from "./WeddingCodeV40Client.testKit";

/**
 * 링크 없이 연 v4 입구는 서버가 시작 화면까지 그린다(예전에는 「불러오는 중이에요」 한 줄뿐이라 제목도 소개 글도 서버 HTML 에 없었다).
 * 서버 HTML 과 하이드레이션 첫 그림은 같은 화면이어야 하고, 그 화면의 시작 단추는 저장 상태를 읽기 전에는 눌 수 없다
 * (서버가 그린 살아 있는 단추는 하이드레이션 전의 누름을 받는 쪽이 없어 누른 것이 사라졌다).
 */

vi.mock("@/lib/analytics", () => ({ captureWeddingCodeEvent: vi.fn(), captureEvent: vi.fn() }));

const capture = vi.mocked(captureWeddingCodeEvent);

/** 서버가 그리는 것과 같은 조건: 주소의 # 뒤를 모르니 해석이 끝나지 않았고(resolved 거짓) 링크 맥락이 없다. */
function server(overrides: ClientOverrides = {}): ReactElement {
  return <WeddingCodeV40ClientWithDeps {...clientProps({ resolved: false, ...overrides })} />;
}

describe("웨딩코드 4.0 서버 HTML: 링크 없이 연 입구", () => {
  it("제목, 소개 글, 이용 통계 고지와 처리방침 링크가 서버 HTML 에 있고 불러오는 중 한 줄만 있는 화면이 아니다", () => {
    const storage = new FakeStorage();
    const html = renderToString(server({ deps: { storage, now: () => NOW } }));
    expect(html).toContain("data-wedding-code-v40");
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).not.toContain("data-v40-loading");
    expect(html).toContain(`>${V40_COPY.intro.title}</h1>`);
    for (const piece of [V40_COPY.intro.lede, V40_COPY.intro.notice, V40_COPY.intro.scope, ...introBullets("blocked", V40_COUNTS.items)]) {
      expect(html, piece).toContain(piece);
    }
    // 이용 통계 고지와 처리방침 링크는 서버 HTML 에 그대로 있다.
    expect(html).toContain(introStorage("blocked").before);
    expect(html.match(/href="\/privacy"/g)).toHaveLength(1);
    // 서버는 저장소를 읽지 않는다.
    expect(storage.log).toEqual([]);
  });

  it("서버 HTML 의 시작 단추는 disabled 이고 aria-busy 이며, 글자는 시작하기 그대로다", () => {
    const html = renderToString(server());
    const start = html.match(/<button[^>]*>시작하기<\/button>/u);
    expect(start).not.toBeNull();
    expect(start![0]).toContain('disabled=""');
    expect(start![0]).toContain('aria-busy="true"');
    expect(html.match(/시작하기/g)).toHaveLength(1);
    expect(html).toContain('data-pending=""');
    expect(html).toMatch(new RegExp(`role="status"[^>]*data-intro-pending=""[^>]*>${V40_COPY.common.loadingLabel}</p>`, "u"));
  });

  it("저장 상태를 모르는 서버는 저장한다는 말을 하지 않고 자동 저장 단추를 그리지 않는다", () => {
    const html = renderToString(server());
    expect(html).not.toContain("저장돼요");
    expect(html).not.toContain("이 브라우저에만");
    expect(html).not.toContain("data-autosave-toggle");
    expect(html).not.toContain(V40_COPY.autosave.turnOffButton);
    expect(html).not.toContain(V40_COPY.autosave.turnOnButton);
  });

  it("입구가 넘긴 안내(initialNotice)는 서버 HTML 에도 있다", () => {
    const html = renderToString(server({ initialNotice: V40_COPY.error.brokenLink.notice }));
    expect(html).toContain(V40_COPY.error.brokenLink.notice);
  });

  it("라운지 안(embedded)에서 열어도 서버 HTML 은 라운지 모양이다: 계정에 저장되지 않는다는 한 줄이 있고, 밖에서 열면 없다", () => {
    const inside = renderToString(server({ embedded: true }));
    expect(inside).toContain("data-embedded-note");
    expect(inside).toContain(V40_COPY.intro.embeddedNote);
    expect(inside).toContain('data-pending=""');
    const outside = renderToString(server({ embedded: false }));
    expect(outside).not.toContain("data-embedded-note");
    expect(outside).not.toContain(V40_COPY.intro.embeddedNote);
  });

  it("받은 링크와 두 사람 결과 링크 맥락은 서버가 알 수 없는 갈래라 불러오는 중이라는 글만 그린다(시작 단추도 제목도 없다)", () => {
    const first = decodedOf(fixture("couple-partner"));
    const second = decodedOf(fixture("swua-example"));
    for (const initial of [
      { partner: first, both: null },
      { partner: null, both: { first, second } },
    ]) {
      const html = renderToString(server({ initial }));
      expect(html).toContain("data-v40-loading");
      expect(html).toContain(V40_COPY.common.loadingLabel);
      expect(html).not.toContain("<h1");
      expect(html).not.toContain("시작하기");
    }
  });
});

describe("웨딩코드 4.0 하이드레이션: 서버가 그린 시작 화면을 이어받는다", () => {
  let container: HTMLDivElement;
  let root: Root | undefined;
  let scrollIntoView: ReturnType<typeof vi.fn>;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const hadScrollIntoView = "scrollIntoView" in Element.prototype;

  beforeEach(() => {
    capture.mockClear();
    window.history.replaceState(null, "", "/wedding-code");
    // jsdom 에는 scrollIntoView 가 없다. 화면이 스크롤을 시도하는지 보려고 심는다.
    scrollIntoView = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
    consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    container = document.createElement("div");
    document.body.appendChild(container);
  });
  afterEach(async () => {
    await act(async () => root?.unmount());
    root = undefined;
    container.remove();
    consoleError.mockRestore();
    if (!hadScrollIntoView) delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  /** 서버 HTML 을 만들어 컨테이너에 넣고 같은 요소로 하이드레이션한다(옵션이 서로 같아야 한다). */
  async function hydrateFromServer(overrides: ClientOverrides, wrap: (element: ReactElement) => ReactElement = (element) => element): Promise<{ html: string; recoverable: ReturnType<typeof vi.fn> }> {
    const html = renderToString(server(overrides));
    container.innerHTML = html;
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, wrap(server(overrides)), { onRecoverableError: recoverable });
    });
    return { html, recoverable };
  }

  async function rerender(overrides: ClientOverrides, wrap: (element: ReactElement) => ReactElement = (element) => element): Promise<void> {
    await act(async () => root?.render(wrap(server(overrides))));
    await settle(0);
  }

  it("불일치 없이 서버가 그린 노드를 이어받고, 해석이 끝나기 전에는 단추가 그대로 눌 수 없다", async () => {
    const storage = new FakeStorage();
    const deps = { storage, now: () => NOW };
    const html = renderToString(server({ deps }));
    container.innerHTML = html;
    const heading = container.querySelector("h1");
    const start = container.querySelector<HTMLButtonElement>("[data-action-bar] button");
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, server({ deps }), { onRecoverableError: recoverable });
    });
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    // 같은 노드를 이어받았다(다시 만들지 않았다).
    expect(container.querySelector("h1")).toBe(heading);
    expect(container.querySelector("[data-action-bar] button")).toBe(start);
    expect(start!.disabled).toBe(true);
    expect(screenName(container)).toBe("intro");
    // 해석이 끝나기 전에는 저장소도 통계도 건드리지 않고, 눌러도 시작되지 않는다.
    await click(start);
    expect(screenName(container)).toBe("intro");
    expect(storage.log).toEqual([]);
    expect(capture).not.toHaveBeenCalled();
  });

  it("하이드레이션 중에도, 해석이 끝나 단추가 풀린 뒤에도 초점과 스크롤을 옮기지 않는다(읽던 사람이 맨 위로 끌려가지 않는다)", async () => {
    const storage = new FakeStorage();
    const deps = { storage, now: () => NOW };
    const { recoverable } = await hydrateFromServer({ deps });
    expect(recoverable).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();

    await rerender({ resolved: true, deps });
    const start = buttonWithText(container, V40_COPY.intro.startButton);
    expect(start.disabled).toBe(false);
    expect(start.getAttribute("aria-busy")).toBeNull();
    expect(container.querySelector("[data-intro-pending]")).toBeNull();
    expect(container.querySelector('[data-screen="intro"]')?.hasAttribute("data-pending")).toBe(false);
    expect(container.querySelector("[data-autosave-toggle]")).not.toBeNull();
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    // 시작 화면을 봤다는 통계는 저장소를 읽은 뒤 한 번만 나간다.
    expect(capture.mock.calls.filter(([name]) => name === "wedding_code_intro_viewed")).toHaveLength(1);

    // 풀린 단추를 한 번 누르면 첫 질문 화면이 열리고, 새 화면에는 초점이 간다.
    await click(start);
    expect(screenName(container)).toBe("questions");
    expect(scrollIntoView).toHaveBeenCalled();
    expect(container.contains(document.activeElement)).toBe(true);
  });

  it("StrictMode 로 감싸도 불일치가 없고 초점과 스크롤을 옮기지 않으며, 풀린 뒤 누르면 시작한다", async () => {
    const deps = { storage: new FakeStorage(), now: () => NOW };
    const wrap = (element: ReactElement): ReactElement => <StrictMode>{element}</StrictMode>;
    const { recoverable } = await hydrateFromServer({ deps }, wrap);
    expect(recoverable).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
    await rerender({ resolved: true, deps }, wrap);
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(buttonWithText(container, V40_COPY.intro.startButton).disabled).toBe(false);
    await click(buttonWithText(container, V40_COPY.intro.startButton));
    expect(screenName(container)).toBe("questions");
  });

  it("이어받지 못하고 서버 화면 위에 새로 그려도(입구의 늦게 불러오는 경계가 실제로 그렇게 한다) 초점과 스크롤을 옮기지 않고, 풀린 뒤에는 정상으로 시작한다", async () => {
    const deps = { storage: new FakeStorage(), now: () => NOW };
    container.innerHTML = renderToString(server({ deps }));
    const serverHeading = container.querySelector("h1");
    const client = createRoot(container);
    root = client;
    await act(async () => client.render(server({ deps })));
    expect(container.querySelector("h1")).not.toBe(serverHeading);
    expect(container.querySelector<HTMLButtonElement>("[data-action-bar] button")!.disabled).toBe(true);
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();

    await rerender({ resolved: true, deps });
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
    await click(buttonWithText(container, V40_COPY.intro.startButton));
    expect(screenName(container)).toBe("questions");
  });

  it("서버 화면이 없는 곳에서 새로 만든 본체(다시 시작 등)는 대기 중인 시작 화면이라도 초점을 받는다", async () => {
    const deps = { storage: new FakeStorage(), now: () => NOW };
    const client = createRoot(container);
    root = client;
    await act(async () => client.render(server({ deps })));
    expect(container.querySelector('[data-screen="intro"]')?.hasAttribute("data-pending")).toBe(true);
    expect(document.activeElement).toBe(container.querySelector('[data-screen="intro"]'));
  });

  it("입구가 resolved 를 처음부터 참으로 넘겨도(실제 입구) 본체는 하이드레이션이 끝나기 전에는 저장소를 읽지 않고, 끝난 뒤에 한 번 읽어 시작 화면을 연다", async () => {
    // 하이드레이션 첫 그림의 효과가 도는 때와 그 뒤를 가르는 표시. 본체보다 앞에 놓아 같은 커밋 안에서 먼저 효과가 돈다.
    let phase: "hydration" | "settled" = "hydration";
    function PhaseProbe() {
      const seen = useSyncExternalStore(
        () => () => undefined,
        () => "settled" as const,
        () => "hydration" as const,
      );
      useEffect(() => {
        phase = seen;
      }, [seen]);
      return null;
    }
    const readsAt: string[] = [];
    class PhaseStorage extends FakeStorage {
      override getItem(key: string): string | null {
        readsAt.push(phase);
        return super.getItem(key);
      }
    }
    const deps = { storage: new PhaseStorage(), now: () => NOW };
    const element = (
      <>
        <PhaseProbe />
        {server({ resolved: true, deps })}
      </>
    );
    container.innerHTML = renderToString(element);
    const heading = container.querySelector("h1");
    const recoverable = vi.fn();
    await act(async () => {
      root = hydrateRoot(container, element, { onRecoverableError: recoverable });
    });
    await settle(0);
    expect(recoverable).not.toHaveBeenCalled();
    expect(container.querySelector("h1")).toBe(heading);
    // 저장소는 하이드레이션이 끝난 뒤에만 읽었고, 읽은 뒤 단추가 풀렸다.
    expect(readsAt.length).toBeGreaterThan(0);
    expect(new Set(readsAt)).toEqual(new Set(["settled"]));
    expect(buttonWithText(container, V40_COPY.intro.startButton).disabled).toBe(false);
    expect(capture.mock.calls.filter(([name]) => name === "wedding_code_intro_viewed")).toHaveLength(1);
    expect(document.activeElement).toBe(document.body);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("이 브라우저에 하던 답이 있으면 해석이 끝난 뒤 하던 답 카드가 생기고 시작 단추는 사라진다(저장된 답을 덮어쓰는 길이 없다)", async () => {
    const sample = fixture("swua-example");
    const storage = new FakeStorage();
    seedProgress(storage, partialSnapshotOf(sample, 2));
    storage.log.length = 0;
    const deps = { storage, now: () => NOW };
    const { recoverable } = await hydrateFromServer({ deps });
    expect(recoverable).not.toHaveBeenCalled();
    // 서버가 그린 단추를 해석 전에 눌러도 아무것도 쓰지 않는다.
    await click(container.querySelector("[data-action-bar] button"));
    expect(storage.writes()).toEqual([]);
    expect(storage.log).toEqual([]);

    await rerender({ resolved: true, deps });
    expect(container.querySelector('[data-section-card="resume"]')).not.toBeNull();
    expect(textOf(container)).toContain(V40_COPY.intro.resume.continueButton);
    expect(() => buttonWithText(container, V40_COPY.intro.startButton)).toThrow();
    expect(storage.writes()).toEqual([]);
  });
});
