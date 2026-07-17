import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const script = readFileSync(
  resolve(process.cwd(), "scripts/amora-engine-v2-hosted-integration.mjs"),
  "utf8",
);

describe("hosted Amora integration safety", () => {
  it("unconditionally refuses the production project", () => {
    expect(script).toContain("expectedRef !== productionRef");
    expect(script).not.toContain("AMORA_PRODUCTION_SYNTHETIC_CONFIRM");
  });

  it("claims only the synthetic care jobs it created", () => {
    expect(script).toContain("p_job_id: queued.id");
    expect(script).toContain("p_job_id: optOutQueued.id");
  });

  it("claims only the synthetic memory jobs it created", () => {
    expect(script).toContain("load synthetic memory job ids");
    expect(script).toContain("p_job_id: targetedMemoryJobs[0].id");
    expect(script).toContain("p_job_id: targetedMemoryJobs[1].id");
  });
});
