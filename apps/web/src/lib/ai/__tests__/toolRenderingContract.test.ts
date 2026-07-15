import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8",
);
const actionCardSource = readFileSync(
  join(process.cwd(), "src/components/app/chat/ActionCard.tsx"),
  "utf8",
);
const chatContentSource = readFileSync(
  join(process.cwd(), "src/components/app/chat/ChatContent.tsx"),
  "utf8",
);

describe("Amora read-only tool rendering contract", () => {
  it("has no place-search runtime allowlist or renderer", () => {
    expect(routeSource).not.toContain("UI_RENDERED_TOOLS");
    expect(routeSource).not.toContain("search_nearby_places");
    expect(actionCardSource).not.toContain("PlaceSearchCard");
    expect(actionCardSource).not.toContain('result.toolName === "search_nearby_places"');
    expect(
      existsSync(
        join(process.cwd(), "src/components/app/chat/PlaceSearchCard.tsx"),
      ),
    ).toBe(false);
  });

  it("does not fetch or format vendor-booking context for Amora", () => {
    expect(routeSource).not.toContain('from("vendor_bookings")');
    expect(routeSource).not.toContain("bookingsResult");
    expect(routeSource).not.toContain("bookingRows");
  });

  it("does not retain a client renderer for retired vendor-booking tools", () => {
    expect(
      existsSync(
        join(process.cwd(), "src/components/app/chat/VendorToolCard.tsx"),
      ),
    ).toBe(false);
    expect(actionCardSource).toContain("RetiredVendorBookingHistoryCard");
  });

  it("does not treat retired write results as live client-side actions", () => {
    expect(chatContentSource).not.toContain("SYSTEM_ACTION_TOOL_NAMES");
    expect(chatContentSource).not.toContain("hasSuccessfulSystemAction");
    expect(actionCardSource).not.toContain('case "update_wedding_date"');
    expect(actionCardSource).not.toContain('case "update_task_status"');
    expect(actionCardSource).not.toContain('case "update_venue"');
    expect(actionCardSource).not.toContain('case "toggle_checklist_item"');
    expect(actionCardSource).toContain("RETIRED_AMORA_MUTATION_TOOL_NAMES");
  });
});
