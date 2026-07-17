import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "../apps/web");
const nextRoot = path.join(webRoot, ".next");
const candidateMarkers = [
  "wedding-code-candidate6-research",
  "C6-DS1",
  "C6-ES1",
  "WeddingCode 로컬 연구 미리보기",
];
const searchableExtensions = new Set([".html", ".js", ".json", ".txt"]);

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return collectFiles(fullPath);
      return searchableExtensions.has(path.extname(entry.name)) ? [fullPath] : [];
    })
  );
  return nested.flat();
}

await readFile(path.join(nextRoot, "BUILD_ID"), "utf8");

const artifactRoots = [path.join(nextRoot, "static"), path.join(nextRoot, "server")];
const files = (await Promise.all(artifactRoots.map(collectFiles))).flat();
const violations = [];

for (const file of files) {
  const source = await readFile(file, "utf8");
  for (const marker of candidateMarkers) {
    if (source.includes(marker)) {
      violations.push(`${path.relative(webRoot, file)} contains ${JSON.stringify(marker)}`);
    }
  }
  if (
    path.basename(file) === "app-paths-manifest.json" &&
    source.includes("/internal/wedding-code-research")
  ) {
    violations.push(`${path.relative(webRoot, file)} exposes the local research app route`);
  }
}

if (violations.length > 0) {
  throw new Error(
    `[wedding-code-research] unsafe production artifact:\n${violations.join("\n")}`
  );
}

console.log(
  `[wedding-code-research] production artifact clean (${files.length} files scanned)`
);
