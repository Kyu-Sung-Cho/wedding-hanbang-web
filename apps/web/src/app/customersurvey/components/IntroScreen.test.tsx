import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("framer-motion", () => ({
  motion: { div: "div", button: "button" },
}));
vi.mock("@/components/ui/Logo", () => ({ default: () => <span>Hanbang</span> }));

import IntroScreen from "./IntroScreen";

function Harness({ onStart }: { onStart: () => void }) {
  const [consent, setConsent] = React.useState(false);
  return (
    <IntroScreen
      onStart={onStart}
      hasDraft={false}
      onResume={() => undefined}
      onDismissDraft={() => undefined}
      consent={consent}
      onConsentChange={setConsent}
    />
  );
}

describe("customer survey consent gate", () => {
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

  it("keeps survey start disabled until the explicit consent checkbox is selected", async () => {
    const onStart = vi.fn();
    await act(async () => root.render(<Harness onStart={onStart} />));

    const start = [...container.querySelectorAll("button")]
      .find((button) => button.textContent?.includes("시작"));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(start?.disabled).toBe(true);
    expect(container.querySelector('a[href="/privacy"]')).not.toBeNull();
    expect(container.textContent).toContain("자유서술은 수집하지 않고");
    expect(container.textContent).not.toContain("선택적 자유서술 포함");

    await act(async () => {
      checkbox?.click();
    });
    expect(start?.disabled).toBe(false);

    await act(async () => {
      start?.click();
    });
    expect(onStart).toHaveBeenCalledTimes(1);
  });
});
