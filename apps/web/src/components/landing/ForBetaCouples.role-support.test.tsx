import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// 문구가 바뀐 이유: 중립 준비 공간이 켜지면 온보딩이 역할을 묻지 않으므로
// "신부 1명·신랑 1명"은 거짓 고지가 된다. 두 모드에서 변하지 않는 사실인
// "두 사람"으로 말한다. 과대 약속 금지 단언은 그대로 남긴다.

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
      "지금은 한 공간에서 두 사람이 함께 준비하는 구성부터 지원해요.",
    );
    expect(html).toContain(
      "다양한 커플 형태도 개인정보와 대화 기록을 안전하게 지킬 수 있는 구조로 준비하고 있어요.",
    );
    expect(html).not.toContain("신부·신랑 또는 커플 모두 신청 가능");
  });
});
