import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ToolExecutionResult } from "@/types/database.types";
import VendorToolCard from "./VendorToolCard";

function render(result: ToolExecutionResult) {
  return renderToStaticMarkup(<VendorToolCard result={result} />);
}

describe("VendorToolCard booking projection state", () => {
  it("shows that a created booking is safe while schedule/budget projection retries", () => {
    const html = render({
      toolName: "create_booking",
      toolInput: {},
      toolOutput: {
        bookingId: "30000000-0000-4000-8000-000000000001",
        vendorName: "Hanbang Studio",
        productName: "",
        staffName: "",
        date: "2099-07-20",
        time: "10:00",
        amount: 500_000,
        status: "pending",
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 접수 완료, 일정·예산 반영 재시도 중",
    });

    expect(html).toContain("일정·예산 반영 중");
    expect(html).toContain("예약을 다시 만들 필요는 없어요");
  });

  it("shows that cancellation is complete while cleanup projection retries", () => {
    const html = render({
      toolName: "cancel_booking",
      toolInput: {},
      toolOutput: {
        bookingId: "30000000-0000-4000-8000-000000000001",
        vendorName: "Hanbang Studio",
        productName: "",
        date: "2099-07-20",
        time: "10:00",
        status: "cancelled",
        projectionStatus: "pending_retry",
      },
      success: true,
      displayMessage: "예약 취소 완료, 일정·예산 정리 재시도 중",
    });

    expect(html).toContain("일정·예산 정리 중");
    expect(html).toContain("취소 요청을 다시 보낼 필요는 없어요");
  });
});
