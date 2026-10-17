// @vitest-environment jsdom

import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MannersLayout from "@/app/manners/layout";
import Sidebar from "@/components/app/Sidebar";

vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  usePathname: () => "/wedding/manners",
}));
vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ profile: { name: "김지은", avatar_url: null }, journey: null, signOut: vi.fn() }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 클래스 목록에서 접두어로 시작하는 층(z) 토큰의 숫자를 읽는다. `[100]` 꼴도 읽는다. */
function layerOf(className: string, prefix: string): number | null {
  const token = className.split(/\s+/).find((candidate) => candidate.startsWith(prefix));
  return token ? Number(token.slice(prefix.length).replace(/\D/g, "")) : null;
}

// 로그인한 사람이 예절 가이드를 열면 왼쪽 열을 `components/app/Sidebar.tsx` 의 고정 사이드바가
// 채운다(폭 220px, 층은 아래 테스트가 읽는다). 본문 바로가기 링크는 포커스를 받을 때 왼쪽 위에
// 뜨는데 그 자리가 사이드바 폭 안이라, 링크가 사이드바와 같은 층이면 DOM 에서 뒤에 오는
// 사이드바가 덮어 첫 Tab 정지점이 눈에 보이지 않는다.
describe("예절 가이드 본문 바로가기는 로그인 사이드바 위에 보인다", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  async function sidebarLayer() {
    await act(async () => root.render(<Sidebar isOpen onClose={vi.fn()} />));
    const className = container.querySelector("aside")!.className;
    const layer = layerOf(className, "z-");
    expect(layer, `사이드바 층을 찾는다: ${className}`).not.toBeNull();
    expect(className.split(/\s+/)).toContain("fixed");
    return layer!;
  }

  function skipLink() {
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<MannersLayout><div /></MannersLayout>), "text/html");
    const link = doc.querySelector<HTMLAnchorElement>('a[href="#manners-main"]');
    expect(link, "본문 바로가기 링크").not.toBeNull();
    expect(doc.getElementById("manners-main"), "링크가 가리키는 본문").not.toBeNull();
    return link!;
  }

  it("포커스를 받은 링크의 층이 사이드바 층보다 높다", async () => {
    const sidebar = await sidebarLayer();
    const link = skipLink();
    expect(link.textContent).toBe("본문으로 바로가기");

    // 층은 위치가 있는 요소에서만 먹는다. 보일 때 fixed 여야 한다.
    expect(link.className.split(/\s+/)).toContain("focus:fixed");
    const linkLayer = layerOf(link.className, "focus:z-");
    expect(linkLayer, `링크에 포커스 층이 있다: ${link.className}`).not.toBeNull();

    expect(linkLayer!).toBeGreaterThan(sidebar);
  });
});
