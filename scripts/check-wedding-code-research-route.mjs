import { access, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "../apps/web");
const generatedRoute = path.resolve(
  webRoot,
  "src/app/internal/wedding-code-research/page.tsx"
);
const developmentArtifacts = path.resolve(webRoot, ".next/dev");

try {
  await access(generatedRoute);
  console.error(
    "[wedding-code-research] production build blocked: the generated local research route still exists. Stop the local research server and retry."
  );
  process.exit(1);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

if (!developmentArtifacts.startsWith(`${webRoot}${path.sep}`)) {
  throw new Error("Refusing to remove development artifacts outside apps/web");
}
await rm(developmentArtifacts, { recursive: true, force: true });

console.log("[wedding-code-research] production route absent");
