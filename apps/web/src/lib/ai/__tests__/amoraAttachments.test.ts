import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  AMORA_DOCX_MAX_ENTRIES,
  AmoraAttachmentValidationError,
  AmoraDocxArchiveValidationError,
  assertSafeDocxArchive,
  validateAmoraAttachments,
} from "@/lib/ai/amoraAttachments";
import {
  docxRequiredEntries as docxEntries,
  makeDocxZipFixture as makeZip,
} from "./docxArchiveFixture";

function expectDocxArchiveError(
  archive: Uint8Array,
  reason: AmoraDocxArchiveValidationError["reason"],
) {
  expect(typeof assertSafeDocxArchive).toBe("function");
  try {
    assertSafeDocxArchive(archive);
    throw new Error("expected DOCX archive validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AmoraDocxArchiveValidationError);
    expect((error as AmoraDocxArchiveValidationError).code).toBe("UNSAFE_DOCX_ARCHIVE");
    expect((error as AmoraDocxArchiveValidationError).reason).toBe(reason);
  }
}

function expectAttachmentError(
  input: unknown,
  code: AmoraAttachmentValidationError["code"],
) {
  try {
    validateAmoraAttachments(input);
    throw new Error("expected attachment validation to fail");
  } catch (error) {
    expect(error).toBeInstanceOf(AmoraAttachmentValidationError);
    expect((error as AmoraAttachmentValidationError).code).toBe(code);
  }
}

describe("validateAmoraAttachments", () => {
  it("accepts bounded raw base64 and strips whitespace", () => {
    expect(validateAmoraAttachments([{
      base64: "aGVs\n bG8=",
      mediaType: "image/png",
      fileName: "sample.png",
    }])).toEqual([{
      base64: "aGVsbG8=",
      mediaType: "image/png",
      fileName: "sample.png",
    }]);
  });

  it("accepts only a data URL whose declared MIME matches the attachment", () => {
    expect(validateAmoraAttachments([{
      base64: "data:image/png;base64,aGVsbG8=",
      mediaType: "image/png",
      fileName: "sample.png",
    }])).toEqual([{
      base64: "aGVsbG8=",
      mediaType: "image/png",
      fileName: "sample.png",
    }]);

    expectAttachmentError([{
      base64: "data:image/jpeg;base64,aGVsbG8=",
      mediaType: "image/png",
    }], "MIME_MISMATCH");
  });

  it("rejects malformed attachment objects instead of silently dropping them", () => {
    for (const input of [[null], ["not-an-object"], [{}], [{ mediaType: 42, base64: "aGVsbG8=" }]]) {
      expectAttachmentError(input, "INVALID_ATTACHMENT");
    }
  });

  it("rejects unsupported media types and legacy DOC files", () => {
    expectAttachmentError([{
      base64: "aGVsbG8=",
      mediaType: "text/plain",
    }], "UNSUPPORTED_MEDIA_TYPE");
    expectAttachmentError([{
      base64: "aGVsbG8=",
      mediaType: "application/msword",
    }], "UNSUPPORTED_MEDIA_TYPE");
  });

  it("rejects PDF until a vetted metadata sanitizer is available", () => {
    expectAttachmentError([{
      base64: "JVBERi0xLjQ=",
      mediaType: "application/pdf",
      fileName: "contract.pdf",
    }], "PDF_NOT_SUPPORTED");
  });

  it("rejects remote URLs, ambiguous sources, and missing payloads", () => {
    expectAttachmentError([{
      url: "https://example.com/image.png",
      mediaType: "image/png",
    }], "REMOTE_URL_NOT_ALLOWED");
    expectAttachmentError([{
      url: "https://example.com/image.png",
      base64: "aGVsbG8=",
      mediaType: "image/png",
    }], "AMBIGUOUS_ATTACHMENT_SOURCE");
    expectAttachmentError([{
      mediaType: "image/png",
    }], "MISSING_ATTACHMENT_DATA");
  });

  it("rejects invalid, empty, and oversized base64 payloads", () => {
    expectAttachmentError([{
      base64: "not!base64",
      mediaType: "image/png",
    }], "INVALID_BASE64");
    expectAttachmentError([{
      base64: "",
      mediaType: "image/png",
    }], "MISSING_ATTACHMENT_DATA");
    expectAttachmentError([{
      base64: Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64"),
      mediaType: "image/png",
    }], "ATTACHMENT_TOO_LARGE");
  });

  it("rejects excessive counts and invalid filenames", () => {
    const item = { base64: "aGVsbG8=", mediaType: "image/png" };
    expectAttachmentError(Array.from({ length: 6 }, () => item), "TOO_MANY_ATTACHMENTS");
    expectAttachmentError([{ ...item, fileName: 42 }], "INVALID_FILE_NAME");
    expectAttachmentError([{ ...item, fileName: "x".repeat(256) }], "INVALID_FILE_NAME");
  });
});

describe("assertSafeDocxArchive", () => {
  it("accepts a bounded DOCX-shaped archive with the required package entries", () => {
    expect(() => assertSafeDocxArchive(makeZip(docxEntries()))).not.toThrow();
  });

  it("accepts mammoth's real single-paragraph DOCX compatibility fixture", () => {
    const require = createRequire(import.meta.url);
    const mammothRoot = dirname(require.resolve("mammoth/package.json"));
    const archive = readFileSync(resolve(mammothRoot, "test/test-data/single-paragraph.docx"));

    expect(() => assertSafeDocxArchive(archive)).not.toThrow();
  });

  it("rejects a malformed payload that is not a ZIP archive", () => {
    expectDocxArchiveError(Buffer.from("not-a-docx"), "invalid_zip");
  });

  it("rejects ZIP packages missing a required DOCX entry", () => {
    const archive = makeZip(docxEntries().filter((entry) => entry.name !== "word/document.xml"));

    expectDocxArchiveError(archive, "missing_required_entry");
  });

  it("rejects a small compressed entry that declares bomb-sized output", () => {
    const archive = makeZip(docxEntries([{
      name: "word/bomb.bin",
      data: Buffer.from("x"),
      method: 8,
      uncompressedSize: 10 * 1024 * 1024,
    }]));

    expectDocxArchiveError(archive, "compression_ratio");
  });

  it("rejects a deflate stream whose real output exceeds its declared size", () => {
    const compressed = deflateRawSync(Buffer.alloc(512 * 1024, 0x41));
    const archive = makeZip(docxEntries([{
      name: "word/forged-size.bin",
      data: compressed,
      method: 8,
      uncompressedSize: 1,
    }]));

    expectDocxArchiveError(archive, "inflated_size");
  });

  it("rejects encrypted entries before extraction", () => {
    const archive = makeZip(docxEntries().map((entry, index) => (
      index === 2 ? { ...entry, flags: 0x0801 } : entry
    )));

    expectDocxArchiveError(archive, "encrypted");
  });

  it("rejects encryption declared only by a local header", () => {
    const archive = makeZip(docxEntries());
    archive.writeUInt16LE(0x0801, 6);

    expectDocxArchiveError(archive, "encrypted");
  });

  it("rejects ZIP64 metadata instead of trusting truncated 32-bit sizes", () => {
    const zip64Extra = Buffer.alloc(4);
    zip64Extra.writeUInt16LE(0x0001, 0);
    zip64Extra.writeUInt16LE(0, 2);
    const archive = makeZip(docxEntries().map((entry, index) => (
      index === 2 ? { ...entry, extra: zip64Extra } : entry
    )));

    expectDocxArchiveError(archive, "zip64");
  });

  it.each([
    "word/../outside.xml",
    "/absolute.xml",
    "C:/drive.xml",
    "word\\backslash.xml",
    "word//empty-segment.xml",
    "word/./dot.xml",
    "word/\u0000control.xml",
  ])("rejects an abnormal archive path: %s", (name) => {
    expectDocxArchiveError(makeZip(docxEntries([{ name }])), "path");
  });

  it("rejects a central-directory entry that disagrees with its local header", () => {
    const archive = makeZip(docxEntries());
    archive.writeUInt16LE(0, 26); // local filename length; central directory still declares the real name

    expectDocxArchiveError(archive, "invalid_zip");
  });

  it("rejects an excessive central-directory entry count", () => {
    const extras = Array.from(
      { length: AMORA_DOCX_MAX_ENTRIES - 2 },
      (_, index) => ({ name: `word/media/item-${index}.bin`, data: Buffer.alloc(0) }),
    );

    expectDocxArchiveError(makeZip(docxEntries(extras)), "entry_count");
  });

  it("rejects an oversized individual uncompressed entry", () => {
    const archive = makeZip(docxEntries([{
      name: "word/large.xml",
      data: Buffer.alloc(100 * 1024),
      method: 8,
      uncompressedSize: 17 * 1024 * 1024,
    }]));

    expectDocxArchiveError(archive, "entry_size");
  });

  it("rejects excessive aggregate uncompressed output", () => {
    const extras = Array.from({ length: 5 }, (_, index) => ({
      name: `word/large-${index}.xml`,
      data: Buffer.alloc(64 * 1024),
      method: 8 as const,
      uncompressedSize: 8 * 1024 * 1024,
    }));

    expectDocxArchiveError(makeZip(docxEntries(extras)), "total_size");
  });
});
