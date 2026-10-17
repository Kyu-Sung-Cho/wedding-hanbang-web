import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MannersChrome from "./MannersChrome";

// 로그인 틀 조각을 받다가 실패하는 경우(오프라인·배포 직후 옛 조각). `lazy` 는 실패한 약속을
// 기억하므로 이 시나리오는 파일을 따로 둔다.
vi.mock("./mannersChromeChunks", () => ({
  loadSignedInAside: () => Promise.reject(new Error("Loading chunk failed")),
  loadSignedInTopBar: () => Promise.reject(new Error("Loading chunk failed")),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("MannersChrome when the signed-in chunks fail to load", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    document.cookie = "sb-abcdefghijklmnopqrst-auth-token=x";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    // React 가 잡힌 렌더 오류를 콘솔에 적는다. 이 시험이 일부러 만든 오류다.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    document.cookie = "sb-abcdefghijklmnopqrst-auth-token=; path=/; max-age=0";
    vi.restoreAllMocks();
  });

  it("keeps the article and falls back to the public sidebar instead of an error screen", async () => {
    await act(async () =>
      root.render(
        <MannersChrome publicAside={<aside data-testid="public-aside">공개 사이드바</aside>}>
          <main data-testid="body">본문</main>
        </MannersChrome>,
      ),
    );
    await vi.waitFor(() => expect(container.querySelector('[data-testid="public-aside"]')).not.toBeNull());
    expect(container.querySelector('[data-testid="body"]')?.textContent).toBe("본문");
    expect(container.querySelector("header")).toBeNull();
  });
});
