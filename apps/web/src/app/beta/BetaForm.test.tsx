import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./DatePickerPopover", () => ({
  default: () => <div data-testid="date-picker" />,
}));
vi.mock("@/components/auth/TurnstileWidget", () => ({
  default: () => null,
}));
vi.mock("@/utils/utm", () => ({ readStoredUtm: () => null }));

import BetaForm from "./BetaForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("beta form double-opt-in consent", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ success: true }),
      { status: 202, headers: { "content-type": "application/json" } },
    )));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  async function renderForm() {
    await act(async () => root.render(
      <BetaForm current={0} total={100} progress={0} />,
    ));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]')!;
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    const bride = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "신부")!;
    const submit = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("베타 신청하기"))!;
    return { email, checkbox, bride, submit };
  }

  it("does not submit until the current privacy notice is affirmatively selected", async () => {
    const { email, checkbox, bride, submit } = await renderForm();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(email, "person@example.com");
      email.dispatchEvent(new Event("input", { bubbles: true }));
      bride.click();
    });
    await act(async () => submit.click());
    expect(fetch).not.toHaveBeenCalled();
    expect(checkbox.validity.valueMissing).toBe(true);

    await act(async () => checkbox.click());
    await act(async () => {
      submit.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toMatchObject({
      email: "person@example.com",
      role: "bride",
      privacyAgreed: true,
      privacyVersion: "2026-08-02",
    });
    expect(container.textContent).toContain("확인 메일을 보냈어요");
  });

  it("explains the pending TTL and provides the current privacy policy link", async () => {
    await renderForm();
    expect(container.textContent).toContain("최대 30분");
    expect(container.querySelector('a[href="/privacy"]')?.textContent)
      .toContain("2026-08-02");
  });
});
