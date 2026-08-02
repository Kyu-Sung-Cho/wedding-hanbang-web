import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { WEDDING_TOOLS } from "@/lib/ai/tools";

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function description(name: string): string {
  const tool = WEDDING_TOOLS.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool?.description ?? "";
}

describe("booking tool truthfulness", () => {
  it("describes availability as internal candidates requiring vendor confirmation", () => {
    for (const name of ["check_vendor_availability", "get_available_slots"]) {
      expect(description(name)).toContain("아모라 내부");
      expect(description(name)).toContain("업체 최종 확인");
    }
  });

  it("does not describe internal booking records as vendor-side execution", () => {
    const create = description("create_booking");
    const cancel = description("cancel_booking");
    const list = description("get_my_bookings");

    expect(create).toContain("아모라 내부");
    expect(create).toContain("업체에 요청을 전송하거나 예약을 확정하지 않으며");
    expect(create).toContain("견적일 뿐 결제·지출 기록이 아닙니다");
    expect(cancel).toContain("아모라 내부");
    expect(cancel).toContain("업체에 취소를 전송하거나 업체 취소·환불을 확정하지 않으며");
    expect(cancel).toContain("실제 지출 기록은 보존");
    expect(list).toContain("업체 전달·확정 상태를 뜻하지 않습니다");
  });

  it("keeps availability, amount, and historical status copy evidence-bounded", () => {
    const vendorTools = source("src/lib/ai/tools/vendorTools.ts");
    const vendorCard = source("src/components/app/chat/VendorToolCard.tsx");
    const promptComposer = source("src/lib/ai/amoraPromptComposer.ts");
    const prompts = source("src/lib/ai/prompts.ts");

    expect(vendorTools).toContain("등록된 방문·상담 시간 후보");
    expect(vendorTools).toContain("실제 가능 여부와 예약 확정은 업체 확인이 필요해요");
    expect(vendorTools).not.toContain("(잔여${slot.remaining}석)");
    expect(vendorCard).toContain("등록된 방문·상담 시간 후보");
    expect(vendorCard).toContain("아모라 내부 후보 견적");
    expect(promptComposer).toContain("업체가 확정한 예약 가능 시간이 아니라");
    expect(prompts).toContain("사용자 기록 지출(결제 증빙 아님)");
    expect(prompts).toContain("아모라 내부 방문·상담 후보 기록 후");
  });

  it("excludes not-sent internal intents from every capacity reader", () => {
    for (const path of [
      "src/lib/vendors/bookingAvailability.ts",
      "src/lib/ai/tools/bookingTools.ts",
      "src/lib/ai/tools/vendorTools.ts",
    ]) {
      expect(source(path)).toContain('.neq("vendor_delivery_status", "not_sent")');
    }
  });
});
