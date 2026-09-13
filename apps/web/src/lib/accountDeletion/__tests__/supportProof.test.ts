// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { issueDeletionSupportProof, verifyDeletionSupportProof, SUPPORT_PROOF_LIFETIME_SECONDS } from "../supportProof";

const subject = "11111111-1111-4111-8111-111111111111";
const projectRef = "abcdefghijklmnopqrst";
const secret = "local-proof-test-secret-only-".repeat(3);
const now = Date.parse("2026-09-13T09:00:00Z");
const purpose = "hanbang:deletion-support-identity:v1";
function issue() { return issueDeletionSupportProof({ subject, projectRef, secret, now }); }
function sign(value: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  const key = createHmac("sha256", secret).update(purpose).digest();
  return `HBDEL1.${payload}.${createHmac("sha256", key).update(`HBDEL1.${payload}`).digest("base64url")}`;
}
function body(proof: string): Record<string, unknown> { return JSON.parse(Buffer.from(proof.split(".")[1], "base64url").toString("utf8")); }
function verify(proof: string, overrides: Partial<Parameters<typeof verifyDeletionSupportProof>[0]> = {}) {
  return verifyDeletionSupportProof({ proof, projectRef, secret, now, ...overrides });
}

describe("deletion support identity proof", () => {
  it("binds the authenticated subject, project, purpose and exact 24-hour lifetime", () => {
    const result = issue();
    expect(verify(result.proof)).toEqual({ v: 1, purpose, projectRef, subject, reference: result.reference,
      issuedAt: now / 1000, expiresAt: now / 1000 + SUPPORT_PROOF_LIFETIME_SECONDS });
    expect(result.expiresAt).toBe("2026-09-14T09:00:00.000Z");
    expect(issue().reference).not.toBe(result.reference);
    expect(result.proof).not.toContain(secret);
  });
  it("accepts the last live millisecond but rejects exact expiry and future issue times", () => {
    const { proof } = issue();
    expect(verify(proof, { now: now + 86_400_000 - 1 }).subject).toBe(subject);
    expect(() => verify(proof, { now: now + 86_400_000 })).toThrow("DELETION_SUPPORT_PROOF_INVALID");
    expect(() => verify(proof, { now: now - 1 })).toThrow("DELETION_SUPPORT_PROOF_INVALID");
  });
  it("rejects a wrong project, a wrong secret, tampering and noncanonical encodings without reflecting input", () => {
    const { proof } = issue();
    const parts = proof.split(".");
    const tampered = [proof.replace("HBDEL1", "HBDEL2"), `${parts[0]}.${parts[1]}A.${parts[2]}`,
      `${parts[0]}.${parts[1]}.${parts[2]}=`, "private-customer-input", "a".repeat(2049)];
    for (const value of tampered) {
      try { verify(value); throw new Error("accepted invalid proof"); }
      catch (error) { expect((error as Error).message).toBe("DELETION_SUPPORT_PROOF_INVALID"); }
    }
    expect(() => verify(proof, { projectRef: "tsrqponmlkjihgfedcba" })).toThrow("DELETION_SUPPORT_PROOF_INVALID");
    expect(() => verify(proof, { secret: "different-secret-".repeat(4) })).toThrow("DELETION_SUPPORT_PROOF_INVALID");
  });
  it.each([
    { purpose: "account-delete-approved" }, { v: 2 }, { expiresAt: now / 1000 + 86_401 },
    { subject: "not-an-owner" }, { reference: "invalid-reference" }, { deletionApproved: true },
    { issuedAt: now / 1000 + 0.5 }, { projectRef: "not-a-project" },
  ])("rejects even correctly signed wrong-purpose or malformed claims: %j", mutation => {
    expect(() => verify(sign({ ...body(issue().proof), ...mutation }))).toThrow("DELETION_SUPPORT_PROOF_INVALID");
  });
  it("rejects malformed issue parameters and unusable signing secrets", () => {
    for (const overrides of [{ subject: "" }, { projectRef: "" }, { secret: "short" }, { secret: "a".repeat(8193) }, { now: 0 }, { now: NaN }]) {
      expect(() => issueDeletionSupportProof({ subject, projectRef, secret, now, ...overrides })).toThrow("DELETION_SUPPORT_PROOF_INVALID");
    }
  });
});
