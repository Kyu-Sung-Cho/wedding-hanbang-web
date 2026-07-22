import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const WINDOWS_OCR_CONTRACT_VERSION = "v1-windows-media-ocr-ko-KR-review-only";
export const WINDOWS_OCR_LANGUAGE = "ko-KR";
export const WINDOWS_OCR_HELPER_SHA256 = "d5f361f9c56c8c315c64ffd9a16e4527a641745b05c68853b7329b1545fad02d";
const MAX_OCR_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_OCR_PAGES = 200;
const MAX_OCR_LINES_PER_PAGE = 10_000;
const MAX_OCR_TEXT_CHARACTERS_PER_PAGE = 500_000;
const MAX_OCR_LINE_CHARACTERS = 2_000;
const MAX_OCR_PROCESS_MS = 60_000;
const MAX_OCR_STDOUT_BYTES = 1024 * 1024;
const MAX_OCR_STDERR_BYTES = 16 * 1024;
const MAX_SAFE_INPUT_PATH_CHARACTERS = 180;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");

const WINDOWS_OCR_CONTRACT_DESCRIPTOR = {
  contract_version: WINDOWS_OCR_CONTRACT_VERSION,
  helper_sha256: WINDOWS_OCR_HELPER_SHA256,
  language: WINDOWS_OCR_LANGUAGE,
  limits: {
    image_bytes: MAX_OCR_IMAGE_BYTES,
    pages: MAX_OCR_PAGES,
    lines: MAX_OCR_LINES_PER_PAGE,
    text_characters: MAX_OCR_TEXT_CHARACTERS_PER_PAGE,
    line_characters: MAX_OCR_LINE_CHARACTERS,
    process_ms: MAX_OCR_PROCESS_MS,
  },
} as const;

export interface WindowsOcrImageInput {
  imagePath: string;
  expectedSha256: string;
  page: number;
}

export interface WindowsOcrRunnerRequest {
  safeImagePath: string;
  language: typeof WINDOWS_OCR_LANGUAGE;
  timeoutMs: number;
}

export interface WindowsOcrRunnerResult {
  schema_version: 1;
  engine_name: "Windows.Media.Ocr";
  engine_version: string;
  language: typeof WINDOWS_OCR_LANGUAGE;
  lines: Array<{ line: number; text: string }>;
}

export type WindowsOcrRunner = (
  request: WindowsOcrRunnerRequest,
) => Promise<WindowsOcrRunnerResult>;

export interface WindowsOcrReviewArtifact {
  artifact_path: string;
  source_image_sha256: string;
  page: number;
  engine_name: "Windows.Media.Ocr";
  engine_version: string;
  engine_hash: string;
  line_count: number;
}

export interface WindowsOcrReviewResult {
  contract_version: string;
  contract_hash: string;
  language: typeof WINDOWS_OCR_LANGUAGE;
  review_only: true;
  authoritative: false;
  bulk_approval_eligible: false;
  artifacts: WindowsOcrReviewArtifact[];
  text_characters: number;
}

export class WindowsOcrReviewError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "WindowsOcrReviewError";
  }
}

const helperPath = path.join(__dirname, "windows-media-ocr.ps1");

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

export const WINDOWS_OCR_CONTRACT_HASH = sha256(
  JSON.stringify(WINDOWS_OCR_CONTRACT_DESCRIPTOR),
);

function validateImageBytes(content: Buffer): void {
  if (content.byteLength === 0 || content.byteLength > MAX_OCR_IMAGE_BYTES) {
    throw new WindowsOcrReviewError("ocr_image_size_limit");
  }
  const png = content.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE);
  const jpeg = content.byteLength >= 3
    && content[0] === 0xff
    && content[1] === 0xd8
    && content[2] === 0xff;
  if (!png && !jpeg) throw new WindowsOcrReviewError("ocr_image_format_invalid");
}

function validateRunnerResult(raw: WindowsOcrRunnerResult): WindowsOcrRunnerResult {
  if (
    raw.schema_version !== 1
    || raw.engine_name !== "Windows.Media.Ocr"
    || raw.language !== WINDOWS_OCR_LANGUAGE
    || typeof raw.engine_version !== "string"
    || raw.engine_version.length < 1
    || raw.engine_version.length > 200
    || !Array.isArray(raw.lines)
    || raw.lines.length > MAX_OCR_LINES_PER_PAGE
  ) {
    throw new WindowsOcrReviewError("ocr_result_contract_invalid");
  }
  let characters = 0;
  for (const [index, line] of raw.lines.entries()) {
    if (
      line.line !== index + 1
      || typeof line.text !== "string"
      || line.text.length < 1
      || line.text.length > MAX_OCR_LINE_CHARACTERS
      || /[\r\n\0]/u.test(line.text)
    ) {
      throw new WindowsOcrReviewError("ocr_result_line_invalid");
    }
    characters += line.text.length;
  }
  if (characters > MAX_OCR_TEXT_CHARACTERS_PER_PAGE) {
    throw new WindowsOcrReviewError("ocr_result_text_limit");
  }
  return raw;
}

function boundedProcess(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number | null; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflow = false;
    let timedOut = false;
    let settled = false;
    let forcedTimer: NodeJS.Timeout | null = null;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.kill("SIGKILL")) finish(null);
      else forcedTimer = setTimeout(() => finish(null), 5_000);
    }, timeoutMs);
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forcedTimer) clearTimeout(forcedTimer);
      resolve({
        stdout: overflow ? "" : Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode,
        timedOut,
      });
    };
    child.stdout.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stdoutBytes + bytes.byteLength > MAX_OCR_STDOUT_BYTES) {
        overflow = true;
        child.kill("SIGKILL");
        return;
      }
      stdout.push(bytes);
      stdoutBytes += bytes.byteLength;
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_OCR_STDERR_BYTES - stderrBytes;
      if (remaining > 0) {
        const kept = bytes.subarray(0, remaining);
        stderr.push(kept);
        stderrBytes += kept.byteLength;
      }
    });
    child.once("error", () => finish(null));
    child.once("close", (code) => finish(code));
  });
}

export async function runWindowsMediaOcr(
  request: WindowsOcrRunnerRequest,
): Promise<WindowsOcrRunnerResult> {
  if (process.platform !== "win32") {
    throw new WindowsOcrReviewError("ocr_platform_unsupported");
  }
  const systemRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim();
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
    throw new WindowsOcrReviewError("ocr_system_root_invalid");
  }
  if (
    !path.isAbsolute(request.safeImagePath)
    || request.safeImagePath.length > MAX_SAFE_INPUT_PATH_CHARACTERS
    || request.language !== WINDOWS_OCR_LANGUAGE
  ) {
    throw new WindowsOcrReviewError("ocr_runner_request_invalid");
  }
  const executable = path.win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const result = await boundedProcess(executable, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath,
  ], {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HANBANG_OCR_INPUT: request.safeImagePath,
    HANBANG_OCR_LANGUAGE: request.language,
  }, request.timeoutMs);
  if (result.timedOut) throw new WindowsOcrReviewError("ocr_process_timeout");
  if (result.exitCode !== 0 || !result.stdout.trim()) {
    throw new WindowsOcrReviewError("ocr_process_failed");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
  } catch {
    throw new WindowsOcrReviewError("ocr_result_json_invalid");
  }
  return validateRunnerResult(parsed as WindowsOcrRunnerResult);
}

function serializeArtifact(input: {
  page: number;
  sourceSha256: string;
  contractHash: string;
  engineHash: string;
  result: WindowsOcrRunnerResult;
}): string {
  return [
    "[OCR_REVIEW_ONLY]",
    `contract_version: ${WINDOWS_OCR_CONTRACT_VERSION}`,
    `contract_hash: ${input.contractHash}`,
    `language: ${WINDOWS_OCR_LANGUAGE}`,
    "review_only: true",
    "authoritative: false",
    "bulk_approval_eligible: false",
    `source_image_sha256: ${input.sourceSha256}`,
    `page: ${input.page}`,
    `engine_name: ${input.result.engine_name}`,
    `engine_version: ${input.result.engine_version}`,
    `engine_hash: ${input.engineHash}`,
    "",
    ...input.result.lines.map((line) =>
      `ocr:page:${input.page}:line:${line.line}: ${line.text}`
    ),
    "",
  ].join("\n");
}

export async function createWindowsOcrReviewArtifacts(
  options: { images: WindowsOcrImageInput[]; outputDirectory: string },
  runner: WindowsOcrRunner = runWindowsMediaOcr,
): Promise<WindowsOcrReviewResult> {
  if (options.images.length < 1 || options.images.length > MAX_OCR_PAGES) {
    throw new WindowsOcrReviewError("ocr_page_count_limit");
  }
  const pages = options.images.map((image) => image.page);
  if (new Set(pages).size !== pages.length) {
    throw new WindowsOcrReviewError("ocr_page_locator_duplicate");
  }
  const helper = await readFile(helperPath);
  if (sha256(helper) !== WINDOWS_OCR_HELPER_SHA256) {
    throw new WindowsOcrReviewError("ocr_helper_contract_hash_mismatch");
  }
  const contractHash = WINDOWS_OCR_CONTRACT_HASH;
  const outputRoot = path.resolve(options.outputDirectory);
  const outputParent = path.dirname(outputRoot);
  await mkdir(outputParent, { recursive: true });
  const publicationDirectory = await mkdtemp(path.join(outputParent, ".ocr-review-publish-"));
  const stagingDirectory = path.join(publicationDirectory, "next");
  await mkdir(stagingDirectory);
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "hbo-"));
  const artifacts: WindowsOcrReviewArtifact[] = [];
  let textCharacters = 0;
  try {
    for (const [index, image] of options.images.entries()) {
      if (
        !Number.isSafeInteger(image.page)
        || image.page < 1
        || image.page > MAX_OCR_PAGES
        || !SHA256_PATTERN.test(image.expectedSha256)
      ) {
        throw new WindowsOcrReviewError("ocr_image_identity_invalid");
      }
      const metadataBefore = await lstat(image.imagePath);
      if (metadataBefore.isSymbolicLink() || !metadataBefore.isFile()) {
        throw new WindowsOcrReviewError("ocr_image_not_plain_file");
      }
      const content = await readFile(image.imagePath);
      validateImageBytes(content);
      if (sha256(content) !== image.expectedSha256) {
        throw new WindowsOcrReviewError("ocr_image_sha256_mismatch");
      }
      const metadataAfter = await lstat(image.imagePath);
      if (
        metadataAfter.isSymbolicLink()
        || !metadataAfter.isFile()
        || metadataAfter.size !== metadataBefore.size
        || metadataAfter.mtimeMs !== metadataBefore.mtimeMs
      ) {
        throw new WindowsOcrReviewError("ocr_image_changed_during_snapshot");
      }
      const extension = content.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)
        ? ".png"
        : ".jpg";
      const safeImagePath = path.join(temporaryDirectory, `input-${index + 1}${extension}`);
      if (safeImagePath.length > MAX_SAFE_INPUT_PATH_CHARACTERS) {
        throw new WindowsOcrReviewError("ocr_temporary_path_too_long");
      }
      await writeFile(safeImagePath, content, { flag: "wx" });
      if (sha256(await readFile(safeImagePath)) !== image.expectedSha256) {
        throw new WindowsOcrReviewError("ocr_temporary_copy_mismatch");
      }
      const result = validateRunnerResult(await runner({
        safeImagePath,
        language: WINDOWS_OCR_LANGUAGE,
        timeoutMs: MAX_OCR_PROCESS_MS,
      }));
      const engineHash = sha256(JSON.stringify({
        contract_hash: contractHash,
        engine_name: result.engine_name,
        engine_version: result.engine_version,
        language: result.language,
      }));
      const artifactText = serializeArtifact({
        page: image.page,
        sourceSha256: image.expectedSha256,
        contractHash,
        engineHash,
        result,
      });
      const artifactPath = path.join(stagingDirectory, `${String(image.page).padStart(3, "0")}-ocr-review.txt`);
      await writeFile(artifactPath, artifactText, { encoding: "utf8", flag: "wx" });
      textCharacters += artifactText.length;
      artifacts.push({
        artifact_path: artifactPath,
        source_image_sha256: image.expectedSha256,
        page: image.page,
        engine_name: result.engine_name,
        engine_version: result.engine_version,
        engine_hash: engineHash,
        line_count: result.lines.length,
      });
    }
    await rename(stagingDirectory, outputRoot);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
    await rm(publicationDirectory, { recursive: true, force: true });
  }
  return {
    contract_version: WINDOWS_OCR_CONTRACT_VERSION,
    contract_hash: contractHash,
    language: WINDOWS_OCR_LANGUAGE,
    review_only: true,
    authoritative: false,
    bulk_approval_eligible: false,
    artifacts: artifacts.map((artifact) => ({
      ...artifact,
      artifact_path: path.join(outputRoot, path.basename(artifact.artifact_path)),
    })),
    text_characters: textCharacters,
  };
}
