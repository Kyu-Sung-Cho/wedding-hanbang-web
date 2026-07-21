import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import ts from "typescript";

const execFileAsync = promisify(execFile);

function forbiddenTrackedArtifact(filePath: string): boolean {
  const normalized = filePath.replaceAll("\\", "/");
  const baseName = path.posix.basename(normalized);
  const isRealEnvironmentFile = (
    baseName === ".env"
    || baseName.startsWith(".env.")
  ) && !baseName.endsWith(".example");
  return isRealEnvironmentFile
    || normalized.startsWith("data/raw/")
    || normalized.startsWith("scripts/ingest/.state/")
    || normalized.startsWith("scripts/ingest/.converted/")
    || normalized.startsWith("scripts/ingest/.cache/")
    || normalized.startsWith("scripts/ingest/validated/")
    || normalized === "scripts/ingest/manifest.json";
}

async function collectStaticImportGraph(entryPath: string): Promise<{
  files: Set<string>;
  packages: Set<string>;
}> {
  const files = new Set<string>();
  const packages = new Set<string>();
  const pending = [path.resolve(entryPath)];

  while (pending.length > 0) {
    const filePath = pending.pop()!;
    if (files.has(filePath)) continue;
    files.add(filePath);
    const sourceText = await readFile(filePath, "utf8");
    const sourceFile = ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.ES2022,
      false,
      ts.ScriptKind.TS,
    );
    for (const statement of sourceFile.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) {
        continue;
      }
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith(".")) {
        packages.add(specifier);
        continue;
      }
      const resolved = path.resolve(
        path.dirname(filePath),
        specifier.replace(/\.js$/u, ".ts"),
      );
      pending.push(resolved);
    }
  }

  return { files, packages };
}

test("ordinary ingest CLI loading has no static edge to paid extraction or OpenAI", async () => {
  const ingestDirectory = path.resolve(process.cwd(), "scripts", "ingest");
  const graph = await collectStaticImportGraph(path.join(ingestDirectory, "index.ts"));

  assert.equal(graph.files.has(path.join(ingestDirectory, "extract.ts")), false);
  assert.equal(graph.files.has(path.join(ingestDirectory, "local-candidate.ts")), false);
  assert.equal(
    [...graph.packages].some(
      (specifier) => specifier === "openai" || specifier.startsWith("openai/"),
    ),
    false,
  );
});

test("Git never tracks vendor raw data, ingest state, generated artifacts, or real env files", async () => {
  const repositoryRoot = path.resolve(process.cwd());
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const forbidden = stdout
    .split("\0")
    .filter(Boolean)
    .filter(forbiddenTrackedArtifact)
    .sort();

  assert.deepEqual(
    forbidden,
    [],
    `forbidden files are tracked; remove them from the Git index without deleting local originals:\n${forbidden.join("\n")}`,
  );
});
