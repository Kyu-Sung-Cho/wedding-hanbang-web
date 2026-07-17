import { inflateRawSync } from "node:zlib";

export const AMORA_MAX_ATTACHMENTS = 5;
export const AMORA_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export const AMORA_ATTACHMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;

export type AmoraAttachmentMediaType = typeof AMORA_ATTACHMENT_MEDIA_TYPES[number];

export type ValidatedAmoraAttachment = {
  base64: string;
  mediaType: AmoraAttachmentMediaType;
  fileName?: string;
};

export type AmoraAttachmentValidationCode =
  | "INVALID_ATTACHMENTS"
  | "TOO_MANY_ATTACHMENTS"
  | "INVALID_ATTACHMENT"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "REMOTE_URL_NOT_ALLOWED"
  | "AMBIGUOUS_ATTACHMENT_SOURCE"
  | "MISSING_ATTACHMENT_DATA"
  | "INVALID_BASE64"
  | "MIME_MISMATCH"
  | "ATTACHMENT_TOO_LARGE"
  | "INVALID_FILE_NAME";

const ALLOWED_MEDIA_TYPES = new Set<string>(AMORA_ATTACHMENT_MEDIA_TYPES);

const USER_MESSAGES: Record<AmoraAttachmentValidationCode, string> = {
  INVALID_ATTACHMENTS: "첨부파일 형식이 올바르지 않아요.",
  TOO_MANY_ATTACHMENTS: `첨부파일은 한 번에 ${AMORA_MAX_ATTACHMENTS}개까지 보낼 수 있어요.`,
  INVALID_ATTACHMENT: "첨부파일 정보가 올바르지 않아요. 파일을 다시 선택해주세요.",
  UNSUPPORTED_MEDIA_TYPE: "지원하지 않는 파일 형식이에요. 이미지, PDF 또는 DOCX 파일을 사용해주세요.",
  REMOTE_URL_NOT_ALLOWED: "외부 링크 파일은 안전을 위해 열 수 없어요. 파일을 직접 첨부해주세요.",
  AMBIGUOUS_ATTACHMENT_SOURCE: "첨부파일 데이터가 중복되어 있어요. 파일을 다시 선택해주세요.",
  MISSING_ATTACHMENT_DATA: "첨부파일 내용이 비어 있어요. 파일을 다시 선택해주세요.",
  INVALID_BASE64: "첨부파일을 읽을 수 없어요. 파일을 다시 선택해주세요.",
  MIME_MISMATCH: "첨부파일 형식과 실제 데이터가 일치하지 않아요.",
  ATTACHMENT_TOO_LARGE: "첨부파일은 10MB 이하만 보낼 수 있어요.",
  INVALID_FILE_NAME: "첨부파일 이름이 올바르지 않아요.",
};

export class AmoraAttachmentValidationError extends Error {
  readonly code: AmoraAttachmentValidationCode;

  constructor(code: AmoraAttachmentValidationCode) {
    super(USER_MESSAGES[code]);
    this.name = "AmoraAttachmentValidationError";
    this.code = code;
  }
}

export type AmoraDocxArchiveRejectionReason =
  | "invalid_zip"
  | "entry_count"
  | "entry_size"
  | "total_size"
  | "compression_ratio"
  | "inflated_size"
  | "encrypted"
  | "zip64"
  | "path"
  | "missing_required_entry";

export class AmoraDocxArchiveValidationError extends Error {
  readonly code = "UNSAFE_DOCX_ARCHIVE";

  constructor(readonly reason: AmoraDocxArchiveRejectionReason) {
    super("DOCX archive is malformed, unsafe, or exceeds extraction limits");
    this.name = "AmoraDocxArchiveValidationError";
  }
}

export const AMORA_DOCX_MAX_ENTRIES = 2_048;
export const AMORA_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
export const AMORA_DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
export const AMORA_DOCX_MAX_COMPRESSION_RATIO = 200;

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_FILE_SIGNATURE = 0x02014b50;
const ZIP_EOCD_SIGNATURE = 0x06054b50;
const ZIP64_EOCD_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const ZIP_EOCD_MIN_BYTES = 22;
const ZIP_MAX_COMMENT_BYTES = 0xffff;
const ZIP_ENCRYPTION_FLAGS = 0x2041;
const DOCX_REQUIRED_ENTRIES = new Set([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
]);

function docxArchiveError(reason: AmoraDocxArchiveRejectionReason): never {
  throw new AmoraDocxArchiveValidationError(reason);
}

function findZipEocd(view: DataView): number {
  const minimumOffset = Math.max(
    0,
    view.byteLength - ZIP_EOCD_MIN_BYTES - ZIP_MAX_COMMENT_BYTES,
  );
  for (let offset = view.byteLength - ZIP_EOCD_MIN_BYTES; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP_EOCD_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + ZIP_EOCD_MIN_BYTES + commentLength === view.byteLength) return offset;
  }
  return docxArchiveError("invalid_zip");
}

function decodeZipEntryName(bytes: Uint8Array, flags: number): string {
  if ((flags & 0x0800) === 0) {
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return docxArchiveError("path");
  }
}

function assertSafeZipEntryPath(name: string, encodedLength: number): void {
  if (
    !name
    || encodedLength > 1_024
    || name.startsWith("/")
    || name.startsWith("\\")
    || name.includes("\\")
    || name.includes(":")
    || /[\u0000-\u001f\u007f]/.test(name)
  ) {
    docxArchiveError("path");
  }

  const path = name.endsWith("/") ? name.slice(0, -1) : name;
  const segments = path.split("/");
  if (
    !path
    || segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    docxArchiveError("path");
  }
}

function assertNoZip64Extra(view: DataView, offset: number, length: number): void {
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (cursor + 4 > end) docxArchiveError("invalid_zip");
    const fieldId = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (fieldLength > end - cursor) docxArchiveError("invalid_zip");
    if (fieldId === ZIP64_EXTRA_FIELD_ID) docxArchiveError("zip64");
    cursor += fieldLength;
  }
}

function byteSequencesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/**
 * Validates DOCX ZIP metadata, bounds every entry, and performs a capped
 * preflight inflation before mammoth/JSZip can allocate extraction output.
 */
export function assertSafeDocxArchive(archive: Uint8Array): void {
  if (archive.byteLength < ZIP_EOCD_MIN_BYTES) docxArchiveError("invalid_zip");
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const eocdOffset = findZipEocd(view);
  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const centralDisk = view.getUint16(eocdOffset + 6, true);
  const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);

  if (
    entriesOnDisk === 0xffff
    || entryCount === 0xffff
    || centralSize === 0xffffffff
    || centralOffset === 0xffffffff
    || (eocdOffset >= 20
      && view.getUint32(eocdOffset - 20, true) === ZIP64_EOCD_LOCATOR_SIGNATURE)
  ) {
    docxArchiveError("zip64");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    docxArchiveError("invalid_zip");
  }
  if (entryCount < 1 || entryCount > AMORA_DOCX_MAX_ENTRIES) {
    docxArchiveError("entry_count");
  }
  if (
    centralOffset > eocdOffset
    || centralSize > eocdOffset - centralOffset
    || centralOffset + centralSize !== eocdOffset
  ) {
    docxArchiveError("invalid_zip");
  }

  const names = new Set<string>();
  let totalCompressed = 0;
  let totalUncompressed = 0;
  let cursor = centralOffset;
  const localRanges: Array<{ start: number; end: number }> = [];
  const localOffsets = new Set<number>();
  const inspectedEntries: Array<{
    method: number;
    dataStart: number;
    compressedSize: number;
    uncompressedSize: number;
  }> = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== ZIP_CENTRAL_FILE_SIGNATURE) {
      docxArchiveError("invalid_zip");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const diskStart = view.getUint16(cursor + 34, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const nextCursor = cursor + 46 + nameLength + extraLength + commentLength;

    if (
      compressedSize === 0xffffffff
      || uncompressedSize === 0xffffffff
      || localOffset === 0xffffffff
    ) {
      docxArchiveError("zip64");
    }
    if ((flags & ZIP_ENCRYPTION_FLAGS) !== 0) docxArchiveError("encrypted");
    if (
      (method !== 0 && method !== 8)
      || nameLength < 1
      || nextCursor > eocdOffset
      || diskStart !== 0
      || localOffset + 30 > centralOffset
      || view.getUint32(localOffset, true) !== ZIP_LOCAL_FILE_SIGNATURE
    ) {
      docxArchiveError("invalid_zip");
    }

    const nameStart = cursor + 46;
    assertNoZip64Extra(view, nameStart + nameLength, extraLength);
    const centralNameBytes = archive.subarray(nameStart, nameStart + nameLength);
    const name = decodeZipEntryName(
      centralNameBytes,
      flags,
    );
    assertSafeZipEntryPath(name, nameLength);
    if (names.has(name)) docxArchiveError("invalid_zip");
    names.add(name);

    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localCompressedSize = view.getUint32(localOffset + 18, true);
    const localUncompressedSize = view.getUint32(localOffset + 22, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localNameStart = localOffset + 30;
    const localDataStart = localNameStart + localNameLength + localExtraLength;
    if ((localFlags & ZIP_ENCRYPTION_FLAGS) !== 0) docxArchiveError("encrypted");
    if (localCompressedSize === 0xffffffff || localUncompressedSize === 0xffffffff) {
      docxArchiveError("zip64");
    }
    if (
      localOffsets.has(localOffset)
      || localFlags !== flags
      || localMethod !== method
      || localDataStart > centralOffset
      || compressedSize > centralOffset - localDataStart
      || !byteSequencesEqual(
        archive.subarray(localNameStart, localNameStart + localNameLength),
        centralNameBytes,
      )
      || ((localFlags & 0x0008) === 0
        && (localCompressedSize !== compressedSize
          || localUncompressedSize !== uncompressedSize))
      || ((localFlags & 0x0008) !== 0
        && ((localCompressedSize !== 0 && localCompressedSize !== compressedSize)
          || (localUncompressedSize !== 0 && localUncompressedSize !== uncompressedSize)))
    ) {
      docxArchiveError("invalid_zip");
    }
    assertNoZip64Extra(view, localNameStart + localNameLength, localExtraLength);
    localOffsets.add(localOffset);
    localRanges.push({ start: localOffset, end: localDataStart + compressedSize });
    inspectedEntries.push({
      method,
      dataStart: localDataStart,
      compressedSize,
      uncompressedSize,
    });

    if (uncompressedSize > AMORA_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES) {
      docxArchiveError("entry_size");
    }
    if (
      uncompressedSize > 64 * 1024
      && (compressedSize === 0
        || uncompressedSize > compressedSize * AMORA_DOCX_MAX_COMPRESSION_RATIO)
    ) {
      docxArchiveError("compression_ratio");
    }
    totalCompressed += compressedSize;
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > AMORA_DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      docxArchiveError("total_size");
    }
    cursor = nextCursor;
  }

  if (cursor !== centralOffset + centralSize) docxArchiveError("invalid_zip");
  localRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < localRanges.length; index += 1) {
    if (localRanges[index - 1]!.end > localRanges[index]!.start) {
      docxArchiveError("invalid_zip");
    }
  }
  if (
    totalUncompressed > 64 * 1024
    && (totalCompressed === 0
      || totalUncompressed > totalCompressed * AMORA_DOCX_MAX_COMPRESSION_RATIO)
  ) {
    docxArchiveError("compression_ratio");
  }
  for (const requiredEntry of DOCX_REQUIRED_ENTRIES) {
    if (!names.has(requiredEntry)) docxArchiveError("missing_required_entry");
  }

  let actualTotalUncompressed = 0;
  for (const entry of inspectedEntries) {
    let actualSize: number;
    if (entry.method === 0) {
      actualSize = entry.compressedSize;
    } else {
      try {
        const output = inflateRawSync(
          archive.subarray(
            entry.dataStart,
            entry.dataStart + entry.compressedSize,
          ),
          {
            maxOutputLength: Math.max(
              1,
              Math.min(
                AMORA_DOCX_MAX_ENTRY_UNCOMPRESSED_BYTES,
                entry.uncompressedSize + 1,
              ),
            ),
          },
        );
        actualSize = output.byteLength;
      } catch {
        docxArchiveError("inflated_size");
      }
    }
    if (actualSize !== entry.uncompressedSize) {
      docxArchiveError("inflated_size");
    }
    actualTotalUncompressed += actualSize;
    if (actualTotalUncompressed > AMORA_DOCX_MAX_TOTAL_UNCOMPRESSED_BYTES) {
      docxArchiveError("total_size");
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64AlphabetCode(code: number): boolean {
  return (
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    (code >= 48 && code <= 57) ||
    code === 43 ||
    code === 47
  );
}

function isCanonicalBase64(value: string, padding: number): boolean {
  const payloadEnd = value.length - padding;
  for (let index = 0; index < payloadEnd; index += 1) {
    if (!isBase64AlphabetCode(value.charCodeAt(index))) return false;
  }
  for (let index = payloadEnd; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61) return false;
  }
  return true;
}

function normalizeBase64(value: string, mediaType: AmoraAttachmentMediaType): string {
  let payload = value;
  if (value.startsWith("data:")) {
    const commaIndex = value.indexOf(",");
    if (commaIndex < 0) throw new AmoraAttachmentValidationError("INVALID_BASE64");
    const header = value.slice(5, commaIndex);
    const base64Suffix = ";base64";
    if (!header.endsWith(base64Suffix)) {
      throw new AmoraAttachmentValidationError("INVALID_BASE64");
    }
    if (header.slice(0, -base64Suffix.length).toLowerCase() !== mediaType) {
      throw new AmoraAttachmentValidationError("MIME_MISMATCH");
    }
    payload = value.slice(commaIndex + 1);
  }

  const clean = payload.replace(/\s/g, "");
  if (!clean) throw new AmoraAttachmentValidationError("MISSING_ATTACHMENT_DATA");
  const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
  const byteLength = Math.floor((clean.length * 3) / 4) - padding;
  if (byteLength <= 0) throw new AmoraAttachmentValidationError("MISSING_ATTACHMENT_DATA");
  if (byteLength > AMORA_MAX_ATTACHMENT_BYTES) {
    throw new AmoraAttachmentValidationError("ATTACHMENT_TOO_LARGE");
  }
  if (clean.length % 4 !== 0 || !isCanonicalBase64(clean, padding)) {
    throw new AmoraAttachmentValidationError("INVALID_BASE64");
  }

  return clean;
}

export function validateAmoraAttachments(input: unknown): ValidatedAmoraAttachment[] {
  if (!Array.isArray(input)) {
    throw new AmoraAttachmentValidationError("INVALID_ATTACHMENTS");
  }
  if (input.length > AMORA_MAX_ATTACHMENTS) {
    throw new AmoraAttachmentValidationError("TOO_MANY_ATTACHMENTS");
  }

  return input.map((raw): ValidatedAmoraAttachment => {
    if (!isRecord(raw) || typeof raw.mediaType !== "string") {
      throw new AmoraAttachmentValidationError("INVALID_ATTACHMENT");
    }
    if (!ALLOWED_MEDIA_TYPES.has(raw.mediaType)) {
      throw new AmoraAttachmentValidationError("UNSUPPORTED_MEDIA_TYPE");
    }

    const hasBase64 = raw.base64 !== undefined;
    const hasUrl = raw.url !== undefined;
    if (hasBase64 && hasUrl) {
      throw new AmoraAttachmentValidationError("AMBIGUOUS_ATTACHMENT_SOURCE");
    }
    if (hasUrl) {
      throw new AmoraAttachmentValidationError("REMOTE_URL_NOT_ALLOWED");
    }
    if (!hasBase64 || typeof raw.base64 !== "string" || raw.base64.length === 0) {
      throw new AmoraAttachmentValidationError("MISSING_ATTACHMENT_DATA");
    }

    if (
      raw.fileName !== undefined &&
      (typeof raw.fileName !== "string" || raw.fileName.length < 1 || raw.fileName.length > 255)
    ) {
      throw new AmoraAttachmentValidationError("INVALID_FILE_NAME");
    }

    const mediaType = raw.mediaType as AmoraAttachmentMediaType;
    return {
      base64: normalizeBase64(raw.base64, mediaType),
      mediaType,
      ...(typeof raw.fileName === "string" ? { fileName: raw.fileName } : {}),
    };
  });
}
