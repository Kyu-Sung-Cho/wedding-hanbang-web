import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("VendorToolCard external URL boundary", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.replaceChildren();
  });

  it("revalidates persisted place links and images before rendering", async () => {
    const safeSearchUrl = "https://search.naver.com/search.naver?query=safe";
    const result: ToolExecutionResult = {
      toolName: "search_nearby_places",
      toolInput: { query: "safe" },
      success: true,
      displayMessage: "safe",
      toolOutput: {
        query: "safe",
        places: [{
          id: "persisted-result",
          name: "Persisted place",
          address: "Seoul",
          category: "restaurant",
          categoryFull: "restaurant",
          cuisineType: "Korean",
          description: null,
          telephone: null,
          priceRange: null,
          hasPrivateRoom: false,
          searchUrl: safeSearchUrl,
          mapsUrl: "javascript:alert(1)",
          blogSearchUrl: "https://naver.com.evil.test/blog",
          blogReviewCount: 0,
          blogSnippet: null,
          link: null,
          imageUrl: "https://tracker.evil.test/pixel.gif",
          imageSourceUrl: null,
        }],
      },
    };

    await act(async () => root.render(<VendorToolCard result={result} />));

    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>("a"));
    expect(links.some((link) => link.getAttribute("href") === safeSearchUrl)).toBe(true);
    expect(links.some((link) => /javascript:|evil\.test/iu.test(link.getAttribute("href") ?? "")))
      .toBe(false);
    expect(container.querySelector("img")).toBeNull();
  });
});
