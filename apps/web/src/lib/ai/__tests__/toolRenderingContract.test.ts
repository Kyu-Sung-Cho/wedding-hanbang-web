import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(
  join(process.cwd(), "src/app/api/chat/route.ts"),
  "utf8"
);

describe("Amora UI-rendered tool contract", () => {
  it("does not advertise disabled vendor availability cards", () => {
    const setStart = routeSource.indexOf("const UI_RENDERED_TOOLS = new Set([");
    const setEnd = routeSource.indexOf("]);", setStart);
    const renderedTools = routeSource.slice(setStart, setEnd);

    expect(setStart).toBeGreaterThan(-1);
    expect(setEnd).toBeGreaterThan(setStart);
    expect(renderedTools).not.toContain('"check_vendor_availability"');
    expect(renderedTools).not.toContain('"get_available_slots"');
  });
});
