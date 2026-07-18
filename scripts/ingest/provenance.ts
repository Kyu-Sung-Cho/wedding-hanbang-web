import path from "node:path";

import { sha256Text } from "./io.js";
import type { ManifestUnit, SourceFile } from "./types.js";

function isWithin(parentDirectory: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(parentDirectory), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function sourceFileId(source: SourceFile): string {
  return sha256Text(`${source.path}\0${source.sha256}`);
}

export function sourceFilesForArtifact(unit: ManifestUnit, artifactPath: string): SourceFile[] {
  const resolvedArtifactPath = path.resolve(artifactPath);
  const exactSource = unit.source_files.find(
    (source) => path.resolve(source.absolute_path) === resolvedArtifactPath,
  );
  if (exactSource) return [exactSource];

  const convertibleSources = unit.source_files.filter((source) => source.ext !== "hwp");
  const conversionRoot = unit.conversion?.text_artifacts[0]
    ? path.dirname(unit.conversion.text_artifacts[0])
    : null;
  if (conversionRoot && isWithin(conversionRoot, artifactPath)) {
    const firstSegment = path.relative(conversionRoot, artifactPath).split(path.sep)[0] ?? "";
    const sourceIndex = Number(firstSegment.match(/^(\d+)-/u)?.[1] ?? "0") - 1;
    if (sourceIndex >= 0 && sourceIndex < convertibleSources.length) {
      return [convertibleSources[sourceIndex]];
    }
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
