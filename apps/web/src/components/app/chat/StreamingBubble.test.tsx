import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import StreamingBubble from "./StreamingBubble";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("./ActionCard", () => ({ default: () => <div /> }));
vi.mock("./VendorToolCard", () => ({
  default: () => <div />,
  VENDOR_TOOL_NAMES: new Set<string>(),
}));

describe("StreamingBubble", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("shows partial assistant text as soon as it arrives", async () => {
    await act(async () => {
      root.render(<StreamingBubble content="견적에서 먼저 확인할 것은" toolResults={[]} />);
    });

    expect(container.textContent).toContain("견적에서 먼저 확인할 것은");
    expect(container.textContent).not.toContain("답변을 정리하고 있어요");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("shows a progress message before the first text chunk", async () => {
    await act(async () => {
      root.render(<StreamingBubble content="" toolResults={[]} />);
    });

    expect(container.textContent).toContain("답변을 정리하고 있어요");
    expect(container.querySelector('[role="status"]')).not.toBeNull();
  });
});
