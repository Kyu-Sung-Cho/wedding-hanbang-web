import path from "node:path";

import { sha256Text } from "./io.js";
import type { ManifestUnit, SourceFile } from "./types.js";

const PUBLIC_CONTACT_PATTERN_SOURCE = String.raw`(?:\+?82[-.\s]?)?0?1[016789][-.\s]?\d{3,4}[-.\s]?\d{4}|0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}`;
const PUBLIC_CONTACT_PATTERN = new RegExp(PUBLIC_CONTACT_PATTERN_SOURCE, "iu");
const PUBLIC_CONTACT_TOKEN_PATTERN = new RegExp(PUBLIC_CONTACT_PATTERN_SOURCE, "giu");
const PUBLIC_CONTACT_LABEL_PATTERN = /(?:전화|연락처|\btel\b|\bfax\b)/giu;
export const PUBLIC_CONTACT_REDACTION_MARKER = "[CONTACT_REDACTED]" as const;
const OCR_REVIEW_METADATA_LINE_PATTERN = /^(?:\[OCR_REVIEW_ONLY\]|(?:contract_version|contract_hash|language|review_only|authoritative|bulk_approval_eligible|source_image_sha256|page|engine_name|engine_version|engine_hash)\s*:)/iu;

export type ArtifactSourceProvenanceKind =
  | "exact_source_path"
  | "indexed_conversion_path"
  | "single_convertible_source"
  | "ocr_source_image_sha256"
  | "ambiguous";

export interface ArtifactSourceProvenanceResolution {
  sources: SourceFile[];
  kind: ArtifactSourceProvenanceKind;
  authoritative: boolean;
  ocr_review: boolean;
}

export interface ArtifactSourceProvenanceOptions {
  sourceImageSourcesBySha256?: ReadonlyMap<string, readonly SourceFile[]>;
}

export interface StructuredEvidenceText {
  text: string;
  excluded_contact_lines: number;
  excluded_ocr_metadata_lines: number;
}

export interface StructuredEvidenceTextOptions {
  /** True only for an artifact proven by the conversion manifest to be OCR review output. */
  ocrReviewArtifact?: boolean;
}

function isWithin(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameResolvedPath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLocaleLowerCase("en-US") === resolvedRight.toLocaleLowerCase("en-US")
    : resolvedLeft === resolvedRight;
}

function uniqueSources(sources: readonly SourceFile[]): SourceFile[] {
  return [...new Map(sources.map((source) => [sourceFileId(source), source])).values()];
}

function ocrReviewMetadataForArtifact(
  unit: ManifestUnit,
  artifactPath: string,
): NonNullable<NonNullable<ManifestUnit["conversion"]>["ocr_review"]>["artifacts"][number] | null {
  return unit.conversion?.ocr_review?.artifacts.find((artifact) =>
    sameResolvedPath(artifact.artifact_path, artifactPath)
  ) ?? null;
}

function pathBasedSourceResolution(
  unit: ManifestUnit,
  artifactPath: string,
): Omit<ArtifactSourceProvenanceResolution, "ocr_review"> {
  const resolvedArtifactPath = path.resolve(artifactPath);
  const exactSource = unit.source_files.find(
    (source) => sameResolvedPath(source.absolute_path, resolvedArtifactPath),
  );
  if (exactSource) {
    return {
      sources: [exactSource],
      kind: "exact_source_path",
      authoritative: true,
    };
  }

  const convertibleSources = unit.source_files.filter((source) => source.ext !== "hwp");
  const conversionRoot = unit.conversion?.text_artifacts[0]
    ? path.dirname(unit.conversion.text_artifacts[0])
    : null;
  if (conversionRoot && isWithin(conversionRoot, artifactPath)) {
    const firstSegment = path.relative(conversionRoot, artifactPath).split(path.sep)[0] ?? "";
    const sourceIndex = Number(firstSegment.match(/^(\d+)-/u)?.[1] ?? "0") - 1;
    if (sourceIndex >= 0 && sourceIndex < convertibleSources.length) {
      return {
        sources: [convertibleSources[sourceIndex]!],
        kind: "indexed_conversion_path",
        authoritative: true,
      };
    }
  }
  if (convertibleSources.length === 1) {
    return {
      sources: [convertibleSources[0]!],
      kind: "single_convertible_source",
      authoritative: true,
    };
  }
  return {
    sources: convertibleSources.length > 0 ? convertibleSources : unit.source_files,
    kind: "ambiguous",
    authoritative: false,
  };
}

export function sourceFileId(source: SourceFile): string {
  return sha256Text(`${source.path}\0${source.sha256}`);
}

/**
 * Resolves one conversion artifact to one source only when provenance proves it.
 * Shared OCR review paths may use the immutable source-image digest as proof;
 * equal images across multiple source documents intentionally remain ambiguous.
 */
export function resolveArtifactSourceProvenance(
  unit: ManifestUnit,
  artifactPath: string,
  options: ArtifactSourceProvenanceOptions = {},
): ArtifactSourceProvenanceResolution {
  const ocrMetadata = ocrReviewMetadataForArtifact(unit, artifactPath);
  const pathResolution = pathBasedSourceResolution(unit, artifactPath);
  if (!ocrMetadata) return { ...pathResolution, ocr_review: false };
  if (!options.sourceImageSourcesBySha256) {
    return { ...pathResolution, ocr_review: true };
  }

  const digestSources = uniqueSources(
    options.sourceImageSourcesBySha256.get(ocrMetadata.source_image_sha256) ?? [],
  );
  if (digestSources.length === 1) {
    const digestSourceId = sourceFileId(digestSources[0]!);
    if (
      pathResolution.authoritative
      && pathResolution.sources.some((source) => sourceFileId(source) !== digestSourceId)
    ) {
      return {
        sources: uniqueSources([...pathResolution.sources, ...digestSources]),
        kind: "ambiguous",
        authoritative: false,
        ocr_review: true,
      };
    }
    return {
      sources: digestSources,
      kind: "ocr_source_image_sha256",
      authoritative: true,
      ocr_review: true,
    };
  }
  return {
    sources: uniqueSources([
      ...pathResolution.sources,
      ...digestSources,
    ]),
    kind: "ambiguous",
    authoritative: false,
    ocr_review: true,
  };
}

/**
 * Redacts public contact tokens while preserving co-located disclosure facts
 * and line count. Converter metadata is excluded only for an artifact proven
 * by the manifest to be non-authoritative OCR review output.
 */
export function prepareStructuredEvidenceText(
  text: string,
  options: StructuredEvidenceTextOptions = {},
): StructuredEvidenceText {
  let excludedContactLines = 0;
  let excludedOcrMetadataLines = 0;
  const lines = text.split(/\r?\n/u).map((line) => {
    if (options.ocrReviewArtifact && OCR_REVIEW_METADATA_LINE_PATTERN.test(line.trim())) {
      excludedOcrMetadataLines += 1;
      return "";
    }
    if (PUBLIC_CONTACT_PATTERN.test(line)) {
      excludedContactLines += 1;
      return line
        .replace(PUBLIC_CONTACT_TOKEN_PATTERN, PUBLIC_CONTACT_REDACTION_MARKER)
        .replace(PUBLIC_CONTACT_LABEL_PATTERN, "문의");
    }
    return line;
  });
  return {
    text: lines.join("\n"),
    excluded_contact_lines: excludedContactLines,
    excluded_ocr_metadata_lines: excludedOcrMetadataLines,
  };
}

export function sourceFilesForArtifact(unit: ManifestUnit, artifactPath: string): SourceFile[] {
  const resolution = pathBasedSourceResolution(unit, artifactPath);
  if (resolution.authoritative) return resolution.sources;

  const convertibleSources = unit.source_files.filter((source) => source.ext !== "hwp");
  const conversionRoot = unit.conversion?.text_artifacts[0]
    ? path.dirname(unit.conversion.text_artifacts[0])
    : null;
  if (conversionRoot && isWithin(conversionRoot, artifactPath)) {
    const firstSegment = path.relative(conversionRoot, artifactPath).split(path.sep)[0] ?? "";
    // Old v1 conversion artifacts used one shared media directory. Preserve
    // ambiguity instead of inventing a single source; multi-source validation
    // will require explicit human resolution after reconversion.
    if (firstSegment.toLocaleLowerCase("en-US") === "media") {
      const xlsxSources = convertibleSources.filter((source) => source.ext === "xlsx");
      if (xlsxSources.length > 0) return xlsxSources;
    }
  }
  return convertibleSources.length > 0 ? convertibleSources : unit.source_files;
}
