/**
 * 이 화면에는 두 종류의 사람이 선다. 한쪽에게 맞는 문구가 다른 쪽에게는 거짓이다.
 *
 * 2026-08-22 파운더 지적: 몇 달 써 온 계정으로 hanbang.ai 를 열었는데
 * "계정은 만들어졌어요"가 떴다 — "뜬금없다". 옛 가입 화면에는 약관 항목이 아예
 * 없어서(그 화면 소스에 "약관" 0건) 기존 계정은 동의 기록이 없고, 그래서 관문에
 * 걸리는 것 자체는 맞다. 틀린 것은 **그 사람을 신규 가입자로 부르는 문구**였다.
 */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));

import ConsentGateClient from "./ConsentGateClient";

describe("동의 화면 문구", () => {
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

  async function render(existingAccount: boolean) {
    await act(async () => root.render(
      <ConsentGateClient destination="/wedding/lounge" existingAccount={existingAccount} />,
    ));
    return container.textContent ?? "";
  }

  it("기존 회원에게 '계정은 만들어졌어요'라고 말하지 않는다", async () => {
    const text = await render(true);

    // 이 문장이 파운더가 본 것이다. 몇 달 쓰던 사람에게는 무슨 일이 난 것으로 읽힌다.
    expect(text).not.toContain("계정은 만들어졌어요");
    expect(text).not.toContain("시작하기 전에");
  });

  it("기존 회원에게는 왜 지금인지와, 잃는 것이 없다는 것을 말한다", async () => {
    const text = await render(true);

    expect(text).toContain("가입하실 때는 동의를 따로 받지 않았어요");
    expect(text).toContain("계정과 기록은 그대로 있어요");
  });

  it("방금 계정이 만들어진 사람에게는 그 사실대로 말한다", async () => {
    const text = await render(false);

    expect(text).toContain("계정은 만들어졌어요");
    // 신규에게 "가입할 때 동의를 안 받았다"고 하면 그것이 거짓이 된다.
    expect(text).not.toContain("가입하실 때는 동의를 따로 받지 않았어요");
  });

  it("어느 쪽이든 동의 없이는 계속할 수 없고, 나가는 길이 있다", async () => {
    for (const existing of [true, false]) {
      await act(async () => root.render(
        <ConsentGateClient destination="/wedding/lounge" existingAccount={existing} />,
      ));
      const submit = [...container.querySelectorAll("button")]
        .find((b) => b.textContent?.includes("동의하고 계속하기"));
      expect(submit, `existing=${existing}`).toBeDefined();
      expect(submit!.hasAttribute("disabled"), `existing=${existing}`).toBe(true);
      expect(container.textContent).toContain("동의하지 않고 로그아웃");
    }
  });
});
