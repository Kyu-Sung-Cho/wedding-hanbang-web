import { readFile, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

export async function removeOwnedWeddingCodeResearchRoute({
  expectedSource,
  generatedRoute,
  routeDirectory,
}) {
  const resolvedRouteDirectory = path.resolve(routeDirectory);
  const resolvedGeneratedRoute = path.resolve(generatedRoute);
  const expectedGeneratedRoute = path.join(resolvedRouteDirectory, "page.tsx");

  if (resolvedGeneratedRoute !== expectedGeneratedRoute) {
    throw new Error(
      "Refusing to remove a WeddingCode research route outside the exact generated page path."
    );
  }

  let currentSource;
  try {
    currentSource = await readFile(resolvedGeneratedRoute, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (currentSource !== undefined) {
    if (currentSource !== expectedSource) {
      throw new Error(
        "Refusing to remove the WeddingCode research route because its nonce or contents changed."
      );
    }
    await unlink(resolvedGeneratedRoute);
  }

  try {
    await rmdir(resolvedRouteDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}
