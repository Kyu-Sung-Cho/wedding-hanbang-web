import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";

const HWP_SIGNATURE = "HWP Document File";
const HWP_FILE_HEADER_MIN_BYTES = 40;
const HWP_PARA_TEXT_TAG = 67;
const MAX_HWP_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_HWP_SECTION_COUNT = 200;
const MAX_HWP_SECTION_BYTES = 16 * 1024 * 1024;
const MAX_HWP_TEXT_CHARACTERS = 2_000_000;
const MAX_HWP_RECORDS = 200_000;
const MAX_HWP_IMAGE_COUNT = 100;
const MAX_HWP_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_HWP_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024;
const MIN_HWP_STRUCTURED_TEXT_CHARACTERS = 200;

export const HWP_LOCAL_EXTRACTOR_VERSION = "hwp5-cfb-zlib-v1";

const EXTENDED_CONTROL_CODES = new Set([
  0x0002,
  0x0003,
  0x0008,
  0x0009,
  0x000b,
  0x000f,
  0x0010,
  0x0011,
  0x0012,
  0x0013,
  0x0014,
  0x0015,
  0x0016,
  0x0017,
]);

export type HwpReviewReason =
  | "hwp_embedded_images_require_ocr"
  | "hwp_no_extractable_content";

export interface HwpEmbeddedImage {
  name: string;
  mediaType: "image/jpeg" | "image/png";
  content: Buffer;
  sha256: string;
}

export interface HwpLocalExtraction {
  format: "hwp5";
  extractorVersion: typeof HWP_LOCAL_EXTRACTOR_VERSION;
  version: string;
  compressed: boolean;
  text: string;
  textCharacters: number;
  sectionCount: number;
  paragraphCount: number;
  images: HwpEmbeddedImage[];
  review: {
    required: boolean;
    authoritative: boolean;
    bulkApprovalEligible: false;
    reasonCodes: HwpReviewReason[];
  };
}

export class HwpExtractionError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "HwpExtractionError";
  }
}

interface CfbEntry {
  content?: Uint8Array;
}

interface CfbContainer {
  FullPaths: string[];
  FileIndex: CfbEntry[];
}

interface HwpRecord {
  tagId: number;
  payload: Buffer;
}

function asBuffer(content: Uint8Array | undefined, code: string): Buffer {
  if (content === undefined) throw new HwpExtractionError(code);
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
}

function readHeader(cfb: CfbContainer): {
  version: string;
  compressed: boolean;
} {
  const entry = XLSX.CFB.find(cfb, "FileHeader") as CfbEntry | null;
  const header = asBuffer(entry?.content, "hwp_file_header_missing");
  if (header.length < HWP_FILE_HEADER_MIN_BYTES) {
    throw new HwpExtractionError("hwp_file_header_truncated");
  }
  if (header.subarray(0, HWP_SIGNATURE.length).toString("ascii") !== HWP_SIGNATURE) {
    throw new HwpExtractionError("hwp_signature_invalid");
  }
  if (header[35] !== 5) throw new HwpExtractionError("hwp_version_unsupported");

  const flags = header.readUInt32LE(36);
  if ((flags & 0x0000_0002) !== 0) throw new HwpExtractionError("hwp_encrypted");
  if ((flags & 0x0000_0004) !== 0) {
    throw new HwpExtractionError("hwp_distribution_protected");
  }
  if ((flags & 0x0000_0310) !== 0) throw new HwpExtractionError("hwp_drm_protected");

  return {
    version: [header[35], header[34], header[33], header[32]].join("."),
    compressed: (flags & 0x0000_0001) !== 0,
  };
}

function sectionStreams(cfb: CfbContainer): Buffer[] {
  const sections = cfb.FullPaths.flatMap((entryPath, index) => {
    const match = /(?:^|\/)BodyText\/Section(\d+)$/u.exec(entryPath);
    if (match === null) return [];
    const sectionNumber = Number(match[1]);
    if (!Number.isSafeInteger(sectionNumber)) {
      throw new HwpExtractionError("hwp_section_number_invalid");
    }
    return [{
      sectionNumber,
      content: asBuffer(cfb.FileIndex[index]?.content, "hwp_section_content_missing"),
    }];
  }).sort((left, right) => left.sectionNumber - right.sectionNumber);

  if (sections.length > MAX_HWP_SECTION_COUNT) {
    throw new HwpExtractionError("hwp_section_count_limit");
  }
  return sections.map(({ content }) => content);
}

function embeddedImages(cfb: CfbContainer): HwpEmbeddedImage[] {
  const images = cfb.FullPaths.flatMap((entryPath, index) => {
    const match = /(?:^|\/)BinData\/([^/]+\.(?:jpe?g|png))$/iu.exec(entryPath);
    if (match === null) return [];
    const name = match[1];
    if (name === undefined) throw new HwpExtractionError("hwp_image_name_invalid");
    const content = Buffer.from(asBuffer(
      cfb.FileIndex[index]?.content,
      "hwp_image_content_missing",
    ));
    if (content.length === 0 || content.length > MAX_HWP_IMAGE_BYTES) {
      throw new HwpExtractionError("hwp_image_size_limit");
    }
    const jpeg = content.length >= 3
      && content[0] === 0xff
      && content[1] === 0xd8
      && content[2] === 0xff;
    const png = content.length >= 8
      && content.subarray(0, 8).equals(Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]));
    if (!jpeg && !png) throw new HwpExtractionError("hwp_image_format_invalid");
    return [{
      name,
      mediaType: jpeg ? "image/jpeg" as const : "image/png" as const,
      content,
      sha256: sha256(content),
    }];
  }).sort((left, right) => left.name.localeCompare(right.name, "en", { numeric: true }));

  if (images.length > MAX_HWP_IMAGE_COUNT) {
    throw new HwpExtractionError("hwp_image_count_limit");
  }
  if (images.reduce((total, image) => total + image.content.length, 0) > MAX_HWP_IMAGE_TOTAL_BYTES) {
    throw new HwpExtractionError("hwp_image_total_size_limit");
  }
  if (new Set(images.map(({ name }) => name.toLocaleLowerCase("en-US"))).size !== images.length) {
    throw new HwpExtractionError("hwp_image_name_duplicate");
  }
  return images;
}

function records(section: Buffer): HwpRecord[] {
  const parsed: HwpRecord[] = [];
  let offset = 0;
  while (offset < section.length) {
    if (section.length - offset < 4) {
      throw new HwpExtractionError("hwp_record_header_truncated");
    }
    const header = section.readUInt32LE(offset);
    offset += 4;
    const tagId = header & 0x03ff;
    let payloadBytes = header >>> 20;
    if (payloadBytes === 0x0fff) {
      if (section.length - offset < 4) {
        throw new HwpExtractionError("hwp_extended_record_size_truncated");
      }
      payloadBytes = section.readUInt32LE(offset);
      offset += 4;
    }
    if (payloadBytes > MAX_HWP_SECTION_BYTES || payloadBytes > section.length - offset) {
      throw new HwpExtractionError("hwp_record_payload_invalid");
    }
    parsed.push({ tagId, payload: section.subarray(offset, offset + payloadBytes) });
    if (parsed.length > MAX_HWP_RECORDS) {
      throw new HwpExtractionError("hwp_record_count_limit");
    }
    offset += payloadBytes;
  }
  return parsed;
}

function normalizeParagraphText(value: string): string {
  return value
    .replace(/\p{Co}/gu, " ")
    .replace(/\r\n?/gu, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/gu, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

function decodeParagraph(payload: Buffer): string {
  if (payload.length % 2 !== 0) {
    throw new HwpExtractionError("hwp_paragraph_utf16_truncated");
  }
  let decoded = "";
  for (let offset = 0; offset < payload.length;) {
    const code = payload.readUInt16LE(offset);
    if (EXTENDED_CONTROL_CODES.has(code)) {
      if (payload.length - offset < 16) {
        throw new HwpExtractionError("hwp_extended_control_truncated");
      }
      if (code === 0x0009) decoded += "\t";
      if (code === 0x000b) decoded += "\n";
      offset += 16;
      continue;
    }
    if (code === 0x000a || code === 0x000d) {
      decoded += "\n";
    } else if (code === 0x001e || code === 0x001f) {
      decoded += " ";
    } else if (code >= 0x0020) {
      decoded += String.fromCharCode(code);
    }
    offset += 2;
  }
  return normalizeParagraphText(decoded);
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export function extractHwpBuffer(source: Buffer): HwpLocalExtraction {
  if (source.length === 0 || source.length > MAX_HWP_SOURCE_BYTES) {
    throw new HwpExtractionError("hwp_source_size_limit");
  }

  let cfb: CfbContainer;
  try {
    cfb = XLSX.CFB.read(Buffer.from(source), { type: "buffer" }) as CfbContainer;
  } catch {
    throw new HwpExtractionError("hwp_compound_file_invalid");
  }
  const header = readHeader(cfb);
  const streams = sectionStreams(cfb);
  const images = embeddedImages(cfb);
  const paragraphs: string[] = [];

  for (const stream of streams) {
    let section: Buffer;
    try {
      section = header.compressed
        ? inflateRawSync(stream, { maxOutputLength: MAX_HWP_SECTION_BYTES })
        : Buffer.from(stream);
    } catch {
      throw new HwpExtractionError("hwp_section_decompression_failed");
    }
    if (section.length > MAX_HWP_SECTION_BYTES) {
      throw new HwpExtractionError("hwp_section_size_limit");
    }
    for (const record of records(section)) {
      if (record.tagId !== HWP_PARA_TEXT_TAG) continue;
      const paragraph = decodeParagraph(record.payload);
      if (paragraph.length > 0) paragraphs.push(paragraph);
    }
  }

  const text = paragraphs.join("\n");
  if (text.length > MAX_HWP_TEXT_CHARACTERS) {
    throw new HwpExtractionError("hwp_text_character_limit");
  }
  const reasonCodes: HwpReviewReason[] = [];
  if (images.length > 0 && text.length < MIN_HWP_STRUCTURED_TEXT_CHARACTERS) {
    reasonCodes.push("hwp_embedded_images_require_ocr");
  }
  if (text.length === 0 && images.length === 0) {
    reasonCodes.push("hwp_no_extractable_content");
  }
  const requiresReview = reasonCodes.length > 0;

  return {
    format: "hwp5",
    extractorVersion: HWP_LOCAL_EXTRACTOR_VERSION,
    version: header.version,
    compressed: header.compressed,
    text,
    textCharacters: text.length,
    sectionCount: streams.length,
    paragraphCount: paragraphs.length,
    images,
    review: {
      required: requiresReview,
      authoritative: !requiresReview,
      bulkApprovalEligible: false,
      reasonCodes,
    },
  };
}
