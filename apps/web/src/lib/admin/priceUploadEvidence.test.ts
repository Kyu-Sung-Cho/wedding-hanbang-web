// @vitest-environment node

import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createAdminJsonEvidence,
  persistAdminJsonEvidence,
  verifyAdminJsonEvidence,
} from "./priceUploadEvidence";

describe("admin JSON upload evidence", () => {
  it("content-addresses the exact UTF-8 request bytes and stores them privately without overwrite", async () => {
    const raw = "{\n  \"source\": \"kca_tprice\",\n  \"메모\": \"샘플\"\n}";
    const expectedHash = createHash("sha256").update(raw, "utf8").digest("hex");
    const upload = vi.fn().mockResolvedValue({ error: null });
    const download = vi.fn();
    const from = vi.fn().mockReturnValue({ upload, download });

    await expect(persistAdminJsonEvidence({ storage: { from } } as never, raw))
      .resolves.toEqual({
        bytes: Buffer.byteLength(raw, "utf8"),
        objectKey: `${expectedHash}.json`,
        sha256: expectedHash,
      });

    expect(from).toHaveBeenCalledWith("disclosure-raw");
    expect(upload).toHaveBeenCalledWith(
      `${expectedHash}.json`,
      expect.any(Uint8Array),
      { contentType: "application/json", upsert: false },
    );
    expect(download).not.toHaveBeenCalled();
  });

  it("accepts an idempotent retry only when the existing object has the same bytes", async () => {
    const raw = "{\"source\":\"kca_tprice\"}";
    const evidence = createAdminJsonEvidence(raw);
    const upload = vi.fn().mockResolvedValue({ error: { message: "already exists" } });
    const download = vi.fn().mockResolvedValue({
      data: new Blob([raw], { type: "application/json" }),
      error: null,
    });
    const from = vi.fn().mockReturnValue({ upload, download });

    await expect(persistAdminJsonEvidence({ storage: { from } } as never, raw))
      .resolves.toEqual(evidence);
    expect(download).toHaveBeenCalledWith(evidence.objectKey);
  });

  it("fails closed when an existing content-addressed object does not match its key", async () => {
    const upload = vi.fn().mockResolvedValue({ error: { message: "already exists" } });
    const download = vi.fn().mockResolvedValue({
      data: new Blob(["different bytes"], { type: "application/json" }),
      error: null,
    });
    const from = vi.fn().mockReturnValue({ upload, download });

    await expect(persistAdminJsonEvidence(
      { storage: { from } } as never,
      "{\"source\":\"kca_tprice\"}",
    )).rejects.toThrow("PRICE_UPLOAD_EVIDENCE_INTEGRITY_FAILED");
  });

  it("rechecks JSON object existence, size, hash and syntax before approval", async () => {
    const raw = '{"source":"kca_tprice"}';
    const evidence = createAdminJsonEvidence(raw);
    const download = vi.fn().mockResolvedValue({
      data: new Blob([raw], { type: "application/json" }),
      error: null,
    });
    const from = vi.fn().mockReturnValue({ download });

    await expect(verifyAdminJsonEvidence(
      { storage: { from } } as never,
      [evidence.objectKey],
    )).resolves.toBe(true);
    expect(download).toHaveBeenCalledWith(evidence.objectKey);

    download.mockResolvedValue({
      data: new Blob(["{not-json"], { type: "application/json" }),
      error: null,
    });
    await expect(verifyAdminJsonEvidence(
      { storage: { from } } as never,
      [evidence.objectKey],
    )).resolves.toBe(false);
  });
});
