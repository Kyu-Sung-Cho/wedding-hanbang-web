import { access } from "node:fs/promises";
import path from "node:path";

const STATIC_RESOURCE_TYPES = new Set(["script", "stylesheet", "font", "image"]);

export function isAllowedWeddingCodeResearchRequest(request, appOrigin) {
  if (!request || typeof request !== "object") return false;
  try {
    const parsed = new URL(request.url);
    const method = String(request.method ?? "").toUpperCase();
    const resourceType = String(request.resourceType ?? "");
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") {
      return method === "GET";
    }
    if (parsed.origin !== new URL(appOrigin).origin || method !== "GET") return false;
    if (resourceType === "document") {
      return parsed.pathname === "/internal/wedding-code-research";
    }
    if (parsed.pathname.startsWith("/_next/static/")) {
      return STATIC_RESOURCE_TYPES.has(resourceType);
    }
    if (parsed.pathname === "/_next/image") {
      const source = parsed.searchParams.get("url");
      if (!source || resourceType !== "image") return false;
      const sourceUrl = new URL(source, parsed.origin);
      return sourceUrl.origin === parsed.origin
        && (sourceUrl.pathname.startsWith("/images/") || sourceUrl.pathname === "/favicon.ico");
    }
    if (parsed.pathname === "/favicon.ico") return resourceType === "image";
    if (parsed.pathname.startsWith("/fonts/paperlogy/")) return resourceType === "font";
    if (parsed.pathname === "/images/favicon.png") {
      return resourceType === "image" || resourceType === "other";
    }
    if (parsed.pathname === "/_next/webpack-hmr") {
      return resourceType === "eventsource" || resourceType === "websocket";
    }
    return false;
  } catch {
    return false;
  }
}

export async function assertWeddingCodeResearchRouteAbsent(webRoot) {
  const resolvedWebRoot = path.resolve(webRoot);
  const routeDirectory = path.resolve(
    resolvedWebRoot,
    "src/app/internal/wedding-code-research"
  );
  if (!routeDirectory.startsWith(`${resolvedWebRoot}${path.sep}`)) {
    throw new Error("Refusing to inspect a WeddingCode research route outside apps/web.");
  }
  try {
    await access(routeDirectory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(
    "[wedding-code-research] production build blocked: the generated local research route directory still exists. Stop the local research server, verify its contents, and remove it before retrying."
  );
}
