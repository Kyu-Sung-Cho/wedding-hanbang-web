// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultWeddingCodeEntry } from "@/app/wedding-code/entry";
import LoungeWeddingCode from "./LoungeWeddingCode";

// 무거운 웨딩코드 본문은 이 시험이 보는 것(라운지로 돌아가는 링크 글자)과 상관없다.
vi.mock("@/app/wedding-code/WeddingCodeEntryClient", () => ({ default: () => null }));
vi.mock("next/link", () => ({
  default: ({ children, href, as, prefetch, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { as?: string; prefetch?: boolean }) => {
    void prefetch;
    return <a href={as ?? href} {...props}>{children}</a>;
  },
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };

describe("라운지 안 웨딩코드 화면", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  });

  it("라운지로 돌아가는 링크는 화면 이름 '웨딩 라운지' 를 띄어 쓴다", async () => {
    await act(async () => {
      root.render(<LoungeWeddingCode shareOrigin="https://hanbang.ai" initialEntry={defaultWeddingCodeEntry()} />);
    });
    const back = container.querySelector("[data-lounge-wedding-code] a");
    // 사이드바·상단 제목과 같은 이름이어야 한다(2026-08-19 이름 통일 결정).
    expect(back?.textContent).toBe("웨딩 라운지로");
    expect(back?.getAttribute("href")).toBe("/wedding/lounge");
  });
});
