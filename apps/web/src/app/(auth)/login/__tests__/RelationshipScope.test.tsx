import { PUBLIC_BETA_RELATIONSHIP_SCOPE } from "@hanbang/shared";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import LoginPage from "../page";

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;

describe("signup relationship scope", () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container?.remove();
    root = null;
    container = null;
    window.history.replaceState({}, "", "/login");
  });

  it("shows the supported couple structure before account creation", async () => {
    window.history.replaceState({}, "", "/login?mode=signup");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<LoginPage />);
    });

    expect(container.textContent).toContain(PUBLIC_BETA_RELATIONSHIP_SCOPE.notice);
    expect(container.textContent).toContain(PUBLIC_BETA_RELATIONSHIP_SCOPE.guidance);
  });
});
