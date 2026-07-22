import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

import {
  extractHwpBuffer,
  HwpExtractionError,
} from "../hwp-extract.js";

const HWP_FILE_HEADER_BYTES = 256;

function createFileHeader(flags = 1, version = [5, 1, 0, 1]): Buffer {
  const header = Buffer.alloc(HWP_FILE_HEADER_BYTES);
  header.write("HWP Document File", 0, "ascii");
  header[32] = version[3] ?? 0;
  header[33] = version[2] ?? 0;
  header[34] = version[1] ?? 0;
  header[35] = version[0] ?? 0;
  header.writeUInt32LE(flags, 36);
  return header;
}

function createRecord(tagId: number, payload: Buffer, level = 0): Buffer {
  assert.ok(payload.length < 0xfff, "fixture only supports compact HWP records");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(tagId | (level << 10) | (payload.length << 20));
  return Buffer.concat([header, payload]);
}

function extendedControl(code: number, controlId: string): Buffer {
  const control = Buffer.alloc(16);
  control.writeUInt16LE(code, 0);
  control.write(controlId, 2, 4, "ascii");
  return control;
}

function createHwpFixture(options: {
  flags?: number;
  version?: number[];
  sectionPayloads?: Buffer[];
  images?: Array<{ name: string; content: Buffer }>;
}): Buffer {
  const cfb = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(
    cfb,
    "FileHeader",
    createFileHeader(options.flags, options.version),
  );
  for (const [index, payload] of (options.sectionPayloads ?? []).entries()) {
    const body = (options.flags ?? 1) & 1 ? deflateRawSync(payload) : payload;
    XLSX.CFB.utils.cfb_add(cfb, `BodyText/Section${index}`, body);
  }
  for (const image of options.images ?? []) {
    XLSX.CFB.utils.cfb_add(cfb, `BinData/${image.name}`, image.content);
  }
  return Buffer.from(XLSX.CFB.write(cfb, { type: "buffer" }));
}

test("local HWP extraction exposes compressed paragraph evidence without leaking control payloads", () => {
  const paragraph = Buffer.concat([
    Buffer.from("󰊱 가격", "utf16le"),
    extendedControl(0x000b, "tbl "),
    Buffer.from("식대 57,000원", "utf16le"),
  ]);
  const source = createHwpFixture({
    sectionPayloads: [createRecord(67, paragraph)],
  });

  const result = extractHwpBuffer(source);

  assert.equal(result.format, "hwp5");
  assert.equal(result.extractorVersion, "hwp5-cfb-zlib-v1");
  assert.equal(result.version, "5.1.0.1");
  assert.equal(result.compressed, true);
  assert.equal(result.sectionCount, 1);
  assert.equal(result.paragraphCount, 1);
  assert.match(result.text, /가격/u);
  assert.match(result.text, /식대 57,000원/u);
  assert.doesNotMatch(result.text, /tbl|氠瑢/u);
  assert.doesNotMatch(result.text, /\p{Co}/u);
  assert.deepEqual(result.images, []);
  assert.deepEqual(result.review, {
    required: false,
    authoritative: true,
    bulkApprovalEligible: false,
    reasonCodes: [],
  });
});

test("image-led HWP evidence remains pending visual review and exposes OCR-safe images", () => {
  const sparseParagraph = createRecord(
    67,
    Buffer.from("MH컨벤션\n① 가격(VAT 포함)", "utf16le"),
  );
  const jpeg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46,
    0x49, 0x46, 0x00, 0x01, 0xff, 0xd9,
  ]);
  const source = createHwpFixture({
    sectionPayloads: [sparseParagraph],
    images: [
      { name: "BIN0001.jpg", content: jpeg },
      { name: "BIN0002.jpeg", content: jpeg },
    ],
  });
  const sourceSha256 = createHash("sha256").update(source).digest("hex");

  const result = extractHwpBuffer(source);

  assert.equal(createHash("sha256").update(source).digest("hex"), sourceSha256);
  assert.equal(result.text, "MH컨벤션\n① 가격(VAT 포함)");
  assert.equal(result.images.length, 2);
  assert.deepEqual(result.images.map(({ name, mediaType, sha256 }) => ({
    name,
    mediaType,
    sha256,
  })), [
    {
      name: "BIN0001.jpg",
      mediaType: "image/jpeg",
      sha256: createHash("sha256").update(jpeg).digest("hex"),
    },
    {
      name: "BIN0002.jpeg",
      mediaType: "image/jpeg",
      sha256: createHash("sha256").update(jpeg).digest("hex"),
    },
  ]);
  assert.deepEqual(result.images.map(({ content }) => content), [jpeg, jpeg]);
  assert.deepEqual(result.review, {
    required: true,
    authoritative: false,
    bulkApprovalEligible: false,
    reasonCodes: ["hwp_embedded_images_require_ocr"],
  });
});

test("the HWP5 extractor fails closed for an unsupported major version", () => {
  const source = createHwpFixture({
    version: [4, 0, 0, 0],
    sectionPayloads: [createRecord(67, Buffer.from("unsupported", "utf16le"))],
  });

  assert.throws(
    () => extractHwpBuffer(source),
    (error: unknown) => error instanceof HwpExtractionError
      && error.code === "hwp_version_unsupported",
  );
});

test("protected HWP sources fail closed instead of emitting partial evidence", () => {
  const protectedFlags = [
    { flags: 0x0000_0003, code: "hwp_encrypted" },
    { flags: 0x0000_0005, code: "hwp_distribution_protected" },
    { flags: 0x0000_0011, code: "hwp_drm_protected" },
  ];

  for (const { flags, code } of protectedFlags) {
    const source = createHwpFixture({
      flags,
      sectionPayloads: [createRecord(67, Buffer.from("protected", "utf16le"))],
    });
    assert.throws(
      () => extractHwpBuffer(source),
      (error: unknown) => error instanceof HwpExtractionError && error.code === code,
    );
  }
});
