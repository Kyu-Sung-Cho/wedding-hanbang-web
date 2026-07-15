import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/wedding/lounge",
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({
    profile: null,
    journey: null,
    signOut: vi.fn(),
  }),
}));

import Sidebar from "@/components/app/Sidebar";

describe("Sidebar public beta navigation", () => {
  it("does not invite users into unverified vendor or booking flows", () => {
    const html = renderToStaticMarkup(<Sidebar isOpen onClose={vi.fn()} />);

    expect(html).toContain("웨딩 라운지");
    expect(html).toContain("아모라 상담");
    expect(html).not.toContain("업체 탐색");
    expect(html).not.toContain("예약 관리");
  });
});
