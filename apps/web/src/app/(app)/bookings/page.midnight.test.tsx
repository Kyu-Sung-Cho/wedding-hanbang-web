// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BookingsPage from "./page";
import type { Booking } from "@/types/vendor.types";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const SAME_DAY_BOOKING: Booking = {
  id: "10000000-0000-4000-8000-000000000001",
  vendorId: "20000000-0000-4000-8000-000000000001",
  coupleId: "30000000-0000-4000-8000-000000000001",
  productId: null,
  bookingDate: "2026-08-02",
  bookingTime: "18:00",
  bookingType: "consultation",
  brideName: "예비 신부",
  groomName: "예비 신랑",
  contactPhone: "010-0000-0000",
  status: "confirmed",
  contractStatus: null,
  paymentStatus: null,
  amount: 0,
  isPaid: false,
  memo: "",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  vendorName: "테스트 웨딩홀",
};

describe("BookingsPage Seoul date rollover", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T14:59:59.500Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ bookings: [SAME_DAY_BOOKING] }),
    }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("moves a same-day request to past without reloading the open page", async () => {
    await act(async () => {
      root.render(<BookingsPage />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("다가오는 요청 기록");
    expect(container.textContent).not.toContain("지난·취소 기록");

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(container.textContent).not.toContain("다가오는 요청 기록");
    expect(container.textContent).toContain("지난·취소 기록");
  });
});
