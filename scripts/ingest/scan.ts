import { lstat, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  assertGeneratedStateOutsideRaw,
  readJsonFile,
  resolveIngestStateDirectory,
  sha256File,
  sha256Text,
  toPortableRelativePath,
  writeJsonFile,
} from "./io.js";
import { IngestManifestSchema } from "./schemas.js";
import {
  SUPPORTED_SOURCE_EXTENSIONS,
  type DocumentKindHint,
  type IngestManifest,
  type ManifestUnit,
  type ParsedUnitName,
  type SkippedSourceFile,
  type SourceExtension,
  type SourceFile,
} from "./types.js";

const DEFAULT_AGENCY_DIRECTORY = "결혼준비대행서비스";
const DEFAULT_HALL_DIRECTORY = "예식장";
const supportedExtensions = new Set<string>(SUPPORTED_SOURCE_EXTENSIONS);
export const SCANNER_PARSER_VERSION = "v4-convertible-content-duplicates";
export const DUPLICATE_SOURCE_NOTICE_PREFIX = "duplicate_source_content:";
export const SKIPPED_SOURCE_NOTICE_PREFIX = "unsupported_source_file:";

/**
 * Files the operating system writes next to real sources. They carry no
 * disclosure content, so counting them would bury the CSV and JPEG price
 * sheets that actually do.
 */
const IGNORED_SOURCE_FILENAMES = new Set([".ds_store", "thumbs.db", "desktop.ini"]);

function isOperatingSystemMetadataFile(fileName: string): boolean {
  const normalized = fileName.normalize("NFKC").toLocaleLowerCase("en-US");
  return IGNORED_SOURCE_FILENAMES.has(normalized) || normalized.startsWith("._");
}

function deterministicTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPathWithin(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === ""
    || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function resolveKindRoot(
  rootDir: string,
  configuredDirectory: string,
  label: "agency" | "hall",
): string {
  if (!configuredDirectory.trim()) {
    throw new Error(`${label} directory must be a non-empty path inside the raw root.`);
  }
  const candidate = path.resolve(rootDir, configuredDirectory);
  if (candidate === path.resolve(rootDir) || !isPathWithin(rootDir, candidate)) {
    throw new Error(`${label} directory must stay inside the declared raw root; path escape is blocked.`);
  }
  return candidate;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

async function assertTreeRealPathsInside(
  rootRealPath: string,
  targetPath: string,
): Promise<string | null> {
  let targetRealPath: string;
  try {
    targetRealPath = await realpath(targetPath);
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      try {
        await lstat(targetPath);
      } catch (metadataError) {
        if (hasErrorCode(metadataError, "ENOENT")) return null;
        throw metadataError;
      }
      throw new Error(`Source realpath could not be resolved safely: ${targetPath}`);
    }
    throw error;
  }
  if (!isPathWithin(rootRealPath, targetRealPath)) {
    throw new Error(`Source realpath escaped the declared raw root: ${targetPath}`);
  }
  const visitedDirectories = new Set<string>();
  const walk = async (candidatePath: string): Promise<void> => {
    const candidateRealPath = await realpath(candidatePath);
    if (!isPathWithin(rootRealPath, candidateRealPath)) {
      throw new Error(`Source realpath escaped the declared raw root: ${candidatePath}`);
    }
    const metadata = await stat(candidatePath);
    if (!metadata.isDirectory() || visitedDirectories.has(candidateRealPath)) return;
    visitedDirectories.add(candidateRealPath);
    const entries = await readdir(candidatePath, { withFileTypes: true });
    for (const entry of entries) await walk(path.join(candidatePath, entry.name));
  };
  await walk(targetPath);
  return targetRealPath;
}

function isSourceExtension(value: string): value is SourceExtension {
  return supportedExtensions.has(value);
}

export interface ScanOptions {
  rootDir: string;
  stateDir?: string;
  agencyDir?: string;
  hallDir?: string;
}

export function regionCodeFromDirectory(directoryName: string): string {
  const compact = directoryName.replace(/[\s_]/g, "");
  const canonical = directoryName.trim().toLocaleLowerCase("en-US");
  const canonicalCodes = new Set([
    "seoul_gangnam3",
    "seoul_etc",
    "jeju",
    "gangwon",
    "gyeongsang",
    "jeolla",
    "chungcheong",
    "gyeonggi",
    "ulsan",
    "gwangju",
    "daejeon",
    "busan",
    "incheon",
    "daegu",
  ]);
  if (canonicalCodes.has(canonical)) return canonical;
  if (compact.includes("강남") && !compact.includes("강남외")) return "seoul_gangnam3";
  if (compact.includes("서울")) return "seoul_etc";
  if (compact.includes("제주")) return "jeju";
  if (compact.includes("강원")) return "gangwon";
  if (/경상|경남|경북/.test(compact)) return "gyeongsang";
  if (/전라|전남|전북/.test(compact)) return "jeolla";
  if (/충청|충남|충북/.test(compact)) return "chungcheong";
  if (compact.includes("경기")) return "gyeonggi";
  if (compact.includes("울산")) return "ulsan";
  if (compact.includes("광주")) return "gwangju";
  if (compact.includes("대전")) return "daejeon";
  if (compact.includes("부산")) return "busan";
  if (compact.includes("인천")) return "incheon";
  if (compact.includes("대구")) return "daegu";
  return "unknown";
}

function removeRegionPrefix(value: string): string {
  const withoutSquareRegion = value.replace(/^\[[^\]]+\][\s_-]*/, "");
  if (/^\((?:주|유)\)/.test(withoutSquareRegion)) return withoutSquareRegion;
  return withoutSquareRegion.replace(/^\([^)]*(?:\([^)]*\)[^)]*)?\)[\s_-]*/, "");
}

function removeResidualRegionPrefix(value: string, regionDirectory: string): string {
  if (regionCodeFromDirectory(regionDirectory) !== "daejeon") return value;
  return value.replace(/^대전[\s_-]+/u, "");
}

function filenameRegionCode(value: string): string {
  const square = value.match(/^\[([^\]]+)\]/)?.[1];
  if (square) return regionCodeFromDirectory(square);
  if (/^\((?:주|유)\)/.test(value)) return "unknown";
  const round = value.match(/^\(([^)]+)\)/)?.[1];
  return round ? regionCodeFromDirectory(round) : "unknown";
}

function splitCorporateName(value: string): { name: string; corporateName: string | null } {
  const trimmed = value.trim();
  if (!trimmed.endsWith(")")) return { name: trimmed, corporateName: null };

  let depth = 0;
  for (let index = trimmed.length - 1; index >= 0; index -= 1) {
    const character = trimmed[index];
    if (character === ")") depth += 1;
    if (character !== "(") continue;
    depth -= 1;
    if (depth !== 0) continue;

    if (index === 0) return { name: trimmed, corporateName: null };
    const corporateName = trimmed.slice(index + 1, -1).trim();
    if (!/(?:\((?:주|유)\)|㈜|주식회사)/u.test(corporateName)) {
      return { name: trimmed, corporateName: null };
    }
    return {
      name: trimmed.slice(0, index).trimEnd(),
      corporateName,
    };
  }
  return { name: trimmed, corporateName: null };
}

export function normalizeVendorName(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^(?:\(주\)|\(유\)|주식회사)/, "")
    .replace(/결혼준비대행(?:서비스)?/g, "")
    .replace(/[^0-9a-zA-Z가-힣]/g, "")
    .toLocaleLowerCase("ko-KR");
}

export function parseUnitName(
  displayName: string,
  regionDirectory: string,
  kindHint: DocumentKindHint,
): ParsedUnitName {
  const withoutExtension = displayName.replace(/\.(?:xlsx|docx|hwp|pdf|png)$/i, "");
  const withoutRegion = removeResidualRegionPrefix(
    removeRegionPrefix(withoutExtension),
    regionDirectory,
  );
  const withoutDocumentSuffix = withoutRegion
    .replace(/[\s_-]*결혼준비대행(?:서비스)?[\s_-]*$/u, "")
    .replace(/[\s_-]+(?:예식장|표준양식)[\s_-]*$/u, "")
    .replace(/\s+\(1\)\s*$/u, "")
    .trim();
  const { name, corporateName } = splitCorporateName(withoutDocumentSuffix);

  return {
    region_code: regionCodeFromDirectory(regionDirectory),
    raw_name: name,
    normalized_name: normalizeVendorName(name),
    corporate_name: corporateName,
    kind_hint: kindHint,
  };
}

interface CollectedFiles {
  supported: string[];
  unsupported: string[];
}

async function collectSupportedFiles(targetPath: string): Promise<CollectedFiles> {
  const entries = await readdir(targetPath, { withFileTypes: true });
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectSupportedFiles(entryPath);
      supported.push(...nested.supported);
      unsupported.push(...nested.unsupported);
      continue;
    }
    if (!entry.isFile()) continue;
    const extension = path.extname(entry.name).slice(1).toLocaleLowerCase("en-US");
    if (supportedExtensions.has(extension)) supported.push(entryPath);
    else if (!isOperatingSystemMetadataFile(entry.name)) unsupported.push(entryPath);
  }
  const byPortablePath = (left: string, right: string): number => deterministicTextCompare(
    toPortableRelativePath(targetPath, left),
    toPortableRelativePath(targetPath, right),
  );
  return {
    supported: supported.sort(byPortablePath),
    unsupported: unsupported.sort(byPortablePath),
  };
}

async function toSourceFile(rootDir: string, filePath: string): Promise<SourceFile> {
  if (!isPathWithin(rootDir, filePath)) {
    throw new Error("Source path escaped the declared raw root.");
  }
  const extension = path.extname(filePath).slice(1).toLocaleLowerCase("en-US");
  if (!isSourceExtension(extension)) {
    throw new Error(`지원하지 않는 원본 확장자입니다: ${extension || "(없음)"}`);
  }
  const [rootRealPath, fileRealPath] = await Promise.all([realpath(rootDir), realpath(filePath)]);
  if (!isPathWithin(rootRealPath, fileRealPath)) {
    throw new Error("Source realpath escaped the declared raw root.");
  }
  const digest = await sha256File(filePath);
  return {
    path: toPortableRelativePath(rootDir, filePath),
    absolute_path: path.resolve(filePath),
    ext: extension,
    sha256: digest.sha256,
    bytes: digest.bytes,
  };
}

async function scanKindRoot(
  rootDir: string,
  kindRoot: string,
  kindHint: DocumentKindHint,
): Promise<{ units: ManifestUnit[]; skipped: SkippedSourceFile[] }> {
  let regions;
  try {
    regions = await readdir(kindRoot, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return { units: [], skipped: [] };
    throw error;
  }

  const units: ManifestUnit[] = [];
  const skipped: SkippedSourceFile[] = [];
  for (const regionEntry of regions.filter((entry) => entry.isDirectory())) {
    const regionPath = path.join(kindRoot, regionEntry.name);
    const entries = await readdir(regionPath, { withFileTypes: true });
    const groupedFilePaths = new Map<string, string[]>();
    const unsupportedFilePaths = new Map<string, string[]>();
    const candidates: Array<{ name: string; isDirectory(): boolean }> = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        candidates.push(entry);
        continue;
      }
      if (!entry.isFile()) continue;
      const extension = path.extname(entry.name).slice(1).toLocaleLowerCase("en-US");
      if (!supportedExtensions.has(extension)) {
        // Group by stem like convertible files do: `업체.csv` next to
        // `업체.xlsx` belongs to that vendor, while a lone `업체.csv` is an
        // entire 대행사 that never reaches convert. Both must stay visible.
        if (!isOperatingSystemMetadataFile(entry.name)) {
          const unsupportedStem = path.basename(entry.name, path.extname(entry.name));
          const unsupportedKey = unsupportedStem.normalize("NFKC").toLocaleLowerCase("ko-KR");
          const existingUnsupported = unsupportedFilePaths.get(unsupportedKey);
          const unsupportedPath = path.join(regionPath, entry.name);
          if (existingUnsupported) existingUnsupported.push(unsupportedPath);
          else unsupportedFilePaths.set(unsupportedKey, [unsupportedPath]);
        }
        continue;
      }
      const stem = path.basename(entry.name, path.extname(entry.name));
      const groupKey = stem.normalize("NFKC").toLocaleLowerCase("ko-KR");
      const sourcePath = path.join(regionPath, entry.name);
      const existing = groupedFilePaths.get(groupKey);
      if (existing) existing.push(sourcePath);
      else {
        groupedFilePaths.set(groupKey, [sourcePath]);
        candidates.push(entry);
      }
    }
    for (const candidate of candidates) {
      const candidatePath = path.join(regionPath, candidate.name);
      const candidateStem = path.basename(candidate.name, path.extname(candidate.name));
      const groupKey = candidateStem.normalize("NFKC").toLocaleLowerCase("ko-KR");
      const collected = candidate.isDirectory()
        ? await collectSupportedFiles(candidatePath)
        : {
          supported: groupedFilePaths.get(groupKey) ?? [],
          unsupported: unsupportedFilePaths.get(groupKey) ?? [],
        };
      if (!candidate.isDirectory()) unsupportedFilePaths.delete(groupKey);
      const sourcePaths = collected.supported;
      const unsupportedPaths = collected.unsupported.map(
        (unsupportedPath) => toPortableRelativePath(rootDir, unsupportedPath),
      );
      if (sourcePaths.length === 0) {
        // The whole vendor folder is unreadable. It still has to stay on the
        // record; otherwise it exists only in the download folder.
        for (const unsupportedPath of unsupportedPaths) {
          skipped.push({
            path: unsupportedPath,
            ext: path.extname(unsupportedPath).slice(1).toLocaleLowerCase("en-US"),
            unit_id: null,
          });
        }
        continue;
      }

      const sourceFiles = (await Promise.all(sourcePaths.map((sourcePath) => toSourceFile(rootDir, sourcePath))))
        .sort((left, right) => deterministicTextCompare(left.path, right.path));
      const unitIdentityPath = candidate.isDirectory()
        ? candidatePath
        : path.join(regionPath, groupKey);
      const unitRelativePath = toPortableRelativePath(rootDir, unitIdentityPath);
      const sourceFingerprint = sha256Text(
        sourceFiles.map((source) => `${source.path}\0${source.sha256}`).join("\n"),
      );
      const parsed = parseUnitName(candidate.name, regionEntry.name, kindHint);
      const fileRegion = filenameRegionCode(candidate.name);
      const notices = fileRegion !== "unknown" && fileRegion !== parsed.region_code
        ? [`region_mismatch: 폴더=${parsed.region_code}, 파일명=${fileRegion} (폴더 지역을 우선 사용)`]
        : [];
      if (parsed.region_code === "unknown") {
        notices.push("unknown_region: unsupported first-level region directory; manual mapping is required before conversion.");
      }
      const unitId = sha256Text(unitRelativePath);
      for (const unsupportedPath of unsupportedPaths) {
        skipped.push({
          path: unsupportedPath,
          ext: path.extname(unsupportedPath).slice(1).toLocaleLowerCase("en-US"),
          unit_id: unitId,
        });
        notices.push(`${SKIPPED_SOURCE_NOTICE_PREFIX} ${unsupportedPath}`);
      }
      units.push({
        unit_id: unitId,
        display_name: candidate.name,
        parsed,
        source_files: sourceFiles,
        source_fingerprint: sourceFingerprint,
        stage: parsed.region_code === "unknown" ? "error" : "scanned",
        notices,
      });
    }
    // Whatever no unit claimed is a vendor that exists only in the download
    // folder. It gets no unit, so the manifest entry is its only record.
    for (const unclaimedPaths of unsupportedFilePaths.values()) {
      for (const unclaimedPath of unclaimedPaths) {
        skipped.push({
          path: toPortableRelativePath(rootDir, unclaimedPath),
          ext: path.extname(unclaimedPath).slice(1).toLocaleLowerCase("en-US"),
          unit_id: null,
        });
      }
    }
  }
  return { units, skipped };
}

function markDuplicateCompleteSourceSets(units: ManifestUnit[]): void {
  const unitsByContentSet = new Map<string, ManifestUnit[]>();
  for (const unit of units) {
    const contentSet = unit.source_files
      .map((source) => `${source.ext}\0${source.bytes}\0${source.sha256}`)
      .sort(deterministicTextCompare)
      .join("\n");
    const matchingUnits = unitsByContentSet.get(contentSet);
    if (matchingUnits) matchingUnits.push(unit);
    else unitsByContentSet.set(contentSet, [unit]);
  }

  for (const matchingUnits of unitsByContentSet.values()) {
    if (matchingUnits.length < 2) continue;
    const matchingUnitIds = matchingUnits
      .map((unit) => unit.unit_id)
      .sort(deterministicTextCompare);
    const notice = `${DUPLICATE_SOURCE_NOTICE_PREFIX} identical complete source set across unit_ids=${matchingUnitIds.join(",")}; immutable paths retained and automatic merge/approval excluded pending manual resolution.`;
    for (const unit of matchingUnits) {
      unit.notices = Array.from(new Set([...unit.notices, notice]));
    }
  }
}

export async function scanSources(options: ScanOptions): Promise<IngestManifest> {
  const rootDir = await realpath(path.resolve(options.rootDir));
  const stateDir = path.resolve(options.stateDir ?? resolveIngestStateDirectory(undefined));
  assertGeneratedStateOutsideRaw(rootDir, stateDir);
  try {
    const stateRealPath = await realpath(stateDir);
    if (isPathWithin(rootDir, stateRealPath)) {
      throw new Error("Generated state realpath must remain outside the immutable raw source root.");
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  const agencyRoot = resolveKindRoot(
    rootDir,
    options.agencyDir ?? DEFAULT_AGENCY_DIRECTORY,
    "agency",
  );
  const hallRoot = resolveKindRoot(
    rootDir,
    options.hallDir ?? DEFAULT_HALL_DIRECTORY,
    "hall",
  );
  if (agencyRoot === hallRoot) {
    throw new Error("agency and hall directories must be different paths inside the raw root.");
  }
  const [agencyRealRoot, hallRealRoot] = await Promise.all([
    assertTreeRealPathsInside(rootDir, agencyRoot),
    assertTreeRealPathsInside(rootDir, hallRoot),
  ]);
  if (agencyRealRoot && hallRealRoot && agencyRealRoot === hallRealRoot) {
    throw new Error("agency and hall directories must resolve to different real paths inside the raw root.");
  }
  const [agencyScan, hallScan] = [
    await scanKindRoot(rootDir, agencyRoot, "agency"),
    await scanKindRoot(rootDir, hallRoot, "hall"),
  ];
  const scannedUnits = [...agencyScan.units, ...hallScan.units]
    .sort((left, right) => left.display_name.localeCompare(right.display_name, "ko"));
  const skippedSources = [...agencyScan.skipped, ...hallScan.skipped]
    .sort((left, right) => deterministicTextCompare(left.path, right.path));
  markDuplicateCompleteSourceSets(scannedUnits);
  if (scannedUnits.length === 0) {
    throw new Error("No supported source files were found. Check the raw root and its agency/hall directories.");
  }

  let existingManifest: IngestManifest | null = null;
  try {
    const parsed = IngestManifestSchema.safeParse(await readJsonFile(path.join(stateDir, "manifest.json")));
    if (parsed.success) {
      if (path.resolve(parsed.data.state_dir) !== stateDir) {
        throw new Error("manifest state_dir does not match the requested state directory.");
      }
      existingManifest = parsed.data;
    }
  } catch (error) {
    if (!hasErrorCode(error, "ENOENT")) throw error;
  }
  const mayReuseDownstream = existingManifest?.scanner_parser_version === SCANNER_PARSER_VERSION;
  const existingById = new Map(existingManifest?.units.map((unit) => [unit.unit_id, unit]));
  const units = scannedUnits.map((unit) => {
    const previous = existingById.get(unit.unit_id);
    const previousDuplicateNotice = previous?.notices.find(
      (notice) => notice.startsWith(DUPLICATE_SOURCE_NOTICE_PREFIX),
    );
    const currentDuplicateNotice = unit.notices.find(
      (notice) => notice.startsWith(DUPLICATE_SOURCE_NOTICE_PREFIX),
    );
    if (
      unit.stage === "error"
      || previousDuplicateNotice !== currentDuplicateNotice
      || !mayReuseDownstream
      || !previous
      || previous.source_fingerprint !== unit.source_fingerprint
    ) return unit;
    // An unsupported sibling never entered conversion, so it cannot invalidate
    // it. Re-apply the current notice anyway: reusing the previous notice list
    // verbatim is what made the dropped file invisible on every later scan.
    const carriedNotices = previous.notices.filter(
      (notice) => !notice.startsWith(SKIPPED_SOURCE_NOTICE_PREFIX),
    );
    const freshSkippedNotices = unit.notices.filter(
      (notice) => notice.startsWith(SKIPPED_SOURCE_NOTICE_PREFIX),
    );
    return {
      ...previous,
      display_name: unit.display_name,
      parsed: unit.parsed,
      source_files: unit.source_files,
      source_fingerprint: unit.source_fingerprint,
      notices: [...carriedNotices, ...freshSkippedNotices],
    };
  });

  const manifest: IngestManifest = {
    schema_version: 1,
    scanner_parser_version: SCANNER_PARSER_VERSION,
    root_dir: rootDir,
    state_dir: stateDir,
    scanned_at: new Date().toISOString(),
    units,
    skipped_sources: skippedSources,
  };
  await writeJsonFile(path.join(stateDir, "manifest.json"), manifest);
  return manifest;
}
