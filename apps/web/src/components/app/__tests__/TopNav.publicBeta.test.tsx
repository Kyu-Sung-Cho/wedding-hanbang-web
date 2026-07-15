import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/wedding/lounge",
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, prefetch, as, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { prefetch?: boolean; as?: string }) => {
    void prefetch;
    void as;
    return (
      <a href={typeof href === "string" ? href : "#"} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("@/stores/authStore", () => ({
  useAuthStore: () => ({ journey: null }),
}));

vi.mock("@/hooks/useNotifications", () => ({
  useNotificationPrefs: () => ({ prefs: {} }),
  useNotifications: () => ({
    notifications: [],
    newCount: 0,
    dismiss: vi.fn(),
    dismissAll: vi.fn(),
  }),
}));

vi.mock("@/components/app/NotificationPanel", () => ({ default: () => null }));
vi.mock("@/components/app/schedule/CategoryChecklistModal", () => ({ default: () => null }));

import TopNav from "@/components/app/TopNav";

describe("TopNav public beta navigation", () => {
  it("does not expose unverified vendor search", () => {
    const html = renderToStaticMarkup(<TopNav onMenuToggle={vi.fn()} />);

    expect(html).toContain("아모라");
    expect(html).not.toContain("업체 검색");
  });
});
