import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

import ForBetaCouples from "./ForBetaCouples";

describe("ForBetaCouples role support boundary", () => {
  it("states the actual role limit instead of implying every couple can connect", () => {
    const html = renderToStaticMarkup(<ForBetaCouples />);

    expect(html).toContain(
      "현재 베타 커플 연결은 신부 1명·신랑 1명 구성부터 지원해요.",
    );
    expect(html).toContain(
      "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
    );
    expect(html).not.toContain("신부·신랑 또는 커플 모두 신청 가능");
  });
});
