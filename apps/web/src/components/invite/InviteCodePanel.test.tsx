// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://hanbang.ai/settings" }

import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resolveCoupleConnectionState } from "@hanbang/shared";

import InviteCodePanel from "./InviteCodePanel";

// QR 이미지는 눈으로만 확인 가능한 픽셀이라, 테스트가 "무엇이 인코딩됐는지"를 볼
// 방법이 없다. 그래서 진짜 QR은 그대로 그리면서 넘어간 값만 기록한다 — 코드가
// 링크의 어디에 실렸는지(경로냐 `#` 뒤냐)가 이 기능의 개인정보 계약 자체다.
const qrValues = vi.hoisted(() => [] as string[]);

vi.mock("qrcode.react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("qrcode.react")>();
  return {
    ...actual,
    QRCodeSVG: (props: ComponentProps<typeof actual.QRCodeSVG>) => {
      qrValues.push(String(props.value));
      return <actual.QRCodeSVG {...props} />;
    },
  };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const CODE = "WH-A3F91B2C7D40";

describe("InviteCodePanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    qrValues.length = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  async function render(node: React.ReactNode) {
    await act(async () => {
      root.render(node);
    });
  }

  /**
   * 배우자가 합류하면 지워지는 것을 **코드를 보내기 전에** 말한다.
   *
   * 값이 흘러도 화면에 안 보이면 아무 소용이 없으므로 문구 자체를 고정한다.
   * 지우는 동작은 옳다(새로 들어온 사람이 자기가 없던 시절의 추론을 물려받으면
   * 안 된다) — 고치는 것은 침묵이다. 2026-08-30 운영 실측으로 혼자인 커플 21쌍이
   * 이 화면을 본다.
   */
  describe("합류하면 지워지는 것", () => {
    it("개수가 있으면 보내기 전에 말한다", async () => {
      await render(
        <InviteCodePanel code={CODE} variant="settings" partnerJoinPurgeTotal={16} />,
      );
      const text = container.textContent ?? "";
      expect(text).toContain("16개");
      expect(text).toContain("지워져요");
      // 무엇이 **안** 지워지는지도 같이 말해야 사용자가 겁먹지 않는다.
      expect(text).toContain("확인한 예산·일정");
      expect(text).toContain("주고받은 대화는 그대로");
    });

    it("지울 것이 없거나 못 셌으면 아무 말도 하지 않는다", async () => {
      for (const total of [0, null, undefined]) {
        await render(
          <InviteCodePanel code={CODE} variant="settings" partnerJoinPurgeTotal={total} />,
        );
        expect(container.textContent ?? "").not.toContain("지워져요");
      }
    });

    it("코드가 없으면 이 문장도 없다 — 보낼 코드가 없으면 할 말도 없다", async () => {
      await render(
        <InviteCodePanel code={null} variant="settings" partnerJoinPurgeTotal={16} />,
      );
      expect(container.innerHTML).toBe("");
    });
  });

  it("renders nothing at all when there is no code to share", async () => {
    for (const code of [null, undefined, "", "null", "   ", "WH-"]) {
      await render(<InviteCodePanel code={code} variant="settings" />);
      expect(container.innerHTML).toBe("");
      expect(container.querySelector("svg")).toBeNull();
      expect(qrValues).toHaveLength(0);
    }
  });

  it("keeps the code behind the fragment so it never reaches a server log", async () => {
    await render(<InviteCodePanel code={CODE} variant="settings" />);

    expect(qrValues).toHaveLength(1);
    const encoded = new URL(qrValues[0]);

    expect(encoded.protocol).toBe("https:");
    expect(encoded.host).toBe("hanbang.ai");
    expect(encoded.hash).toBe(`#${CODE}`);
    // 경로·쿼리에는 코드가 없어야 한다. 그쪽에 실리면 접근 로그와 리퍼러에 열쇠가 쌓인다.
    expect(encoded.pathname).toBe("/invite");
    expect(encoded.search).toBe("");
    expect(encoded.pathname).not.toContain(CODE);
    expect(qrValues[0]).toBe(`https://hanbang.ai/invite#${CODE}`);

    // 기본 카메라가 읽어야 하므로 커스텀 스킴이면 안 된다.
    expect(qrValues[0].startsWith("hanbang://")).toBe(false);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("offers the code, the link, and a ready-to-paste message in one place", async () => {
    await render(<InviteCodePanel code={CODE} variant="modal" />);

    const labels = [...container.querySelectorAll("button")].map(
      (button) => button.textContent ?? "",
    );
    expect(labels).toEqual(["코드 복사", "링크 복사", "보낼 문구 복사"]);
    expect(container.textContent).toContain("초대 코드");
    expect(container.textContent).toContain(CODE);
    expect(container.textContent).toContain(
      "파트너 폰의 기본 카메라로 찍으면 초대 화면이 열려요.",
    );
    // 우리 앱에는 QR을 읽는 기능이 없다. 있는 것처럼 말하면 사람은 앱에서 헤맨다.
    expect(container.textContent).not.toContain("앱으로 찍");
    // /wedding-code는 이미 출시된 다른 기능이라 이름이 겹치면 안 된다.
    expect(container.textContent).not.toContain("웨딩코드");
  });

  it("disappears once the couple is linked, following the shared connection contract", async () => {
    const linked = resolveCoupleConnectionState({
      inviteCode: CODE,
      isFullyLinked: true,
      isMembershipSealed: false,
    });
    expect(linked.phase).toBe("linked");

    await render(<InviteCodePanel code={linked.inviteCode} variant="settings" />);
    expect(container.innerHTML).toBe("");

    const sealed = resolveCoupleConnectionState({
      inviteCode: CODE,
      isFullyLinked: false,
      isMembershipSealed: true,
    });
    await render(<InviteCodePanel code={sealed.inviteCode} variant="settings" />);
    expect(container.innerHTML).toBe("");
    expect(qrValues).toHaveLength(0);
  });
});
