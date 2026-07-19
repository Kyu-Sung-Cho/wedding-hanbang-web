import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertWeddingCodeResearchRouteAbsent } from "./wedding-code-research-safety.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(scriptDirectory, "../apps/web");

await assertWeddingCodeResearchRouteAbsent(webRoot);
console.log("[wedding-code-research] production route absent");
