import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWeddingCodeResearchLock } from "../wedding-code-research-lock.mjs";
import { removeOwnedWeddingCodeResearchRoute } from "../wedding-code-research-route-artifact.mjs";
import { buildWeddingCodeResearchEnvironment } from "../wedding-code-research-env.mjs";
import {
  assertWeddingCodeResearchRouteAbsent,
  isAllowedWeddingCodeResearchRequest,
} from "../wedding-code-research-safety.mjs";

test("research dev environment inherits only non-secret operating-system keys", () => {
  const environment = buildWeddingCodeResearchEnvironment({
    Path: "C:\\Windows\\System32",
    TEMP: "C:\\Temp",
    OPENAI_API_KEY: "must-not-cross-the-boundary",
    SUPABASE_SERVICE_ROLE_KEY: "must-not-cross-the-boundary",
    VERCEL_OIDC_TOKEN: "must-not-cross-the-boundary",
    NEXT_PUBLIC_POSTHOG_KEY: "must-not-cross-the-boundary",
  });

  assert.equal(environment.Path, "C:\\Windows\\System32");
  assert.equal(environment.TEMP, "C:\\Temp");
  assert.equal(environment.NODE_ENV, "development");
  assert.equal(environment.WEDDING_CODE_RESEARCH_PREVIEW, "true");
  assert.equal(environment.NEXT_PUBLIC_POSTHOG_KEY, "");
  assert.equal(environment.OPENAI_API_KEY, undefined);
  assert.equal(environment.SUPABASE_SERVICE_ROLE_KEY, undefined);
  assert.equal(environment.VERCEL_OIDC_TOKEN, undefined);
});

test("research request allowlisting compares parsed origins and rejects userinfo prefix spoofing", () => {
  const appOrigin = "http://127.0.0.1:3108";

  assert.equal(
    isAllowedWeddingCodeResearchRequest(
      {
        url: "http://127.0.0.1:3108/_next/static/chunks/app.js",
        method: "GET",
        resourceType: "script",
      },
      appOrigin
    ),
    true
  );
  assert.equal(isAllowedWeddingCodeResearchRequest({
    url: "data:image/png;base64,AA==", method: "GET", resourceType: "image",
  }, appOrigin), true);
  assert.equal(isAllowedWeddingCodeResearchRequest({
    url: "blob:http://127.0.0.1:3108/id", method: "GET", resourceType: "image",
  }, appOrigin), true);
  assert.equal(
    isAllowedWeddingCodeResearchRequest({
      url: "http://127.0.0.1:3108@external.example/leak",
      method: "GET",
      resourceType: "script",
    }, appOrigin),
    false
  );
  assert.equal(
    isAllowedWeddingCodeResearchRequest({
      url: "https://external.example/collect", method: "POST", resourceType: "fetch",
    }, appOrigin),
    false
  );
  for (const request of [
    { url: `${appOrigin}/api/wedding-code/answers`, method: "GET", resourceType: "fetch" },
    { url: `${appOrigin}/api/auth/me`, method: "POST", resourceType: "xhr" },
    { url: `${appOrigin}/ingest/collect`, method: "POST", resourceType: "fetch" },
    {
      url: `${appOrigin}/internal/wedding-code-research?form=A`,
      method: "POST",
      resourceType: "document",
    },
  ]) {
    assert.equal(isAllowedWeddingCodeResearchRequest(request, appOrigin), false);
  }
  assert.equal(isAllowedWeddingCodeResearchRequest({
    url: `${appOrigin}/internal/wedding-code-research?form=A`,
    method: "GET",
    resourceType: "document",
  }, appOrigin), true);
  assert.equal(isAllowedWeddingCodeResearchRequest({
    url: `${appOrigin}/_next/image?url=%2Fimages%2Ffavicon.png&w=64&q=75`,
    method: "GET",
    resourceType: "image",
  }, appOrigin), true);
  assert.equal(isAllowedWeddingCodeResearchRequest({
    url: `${appOrigin}/_next/image?url=https%3A%2F%2Fleak.supabase.co%2Fprivate.png&w=64&q=75`,
    method: "GET",
    resourceType: "image",
  }, appOrigin), false);
});

test("a lock release never deletes a replacement owned by a different nonce", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wedding-code-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "research.lock");
  const lock = createWeddingCodeResearchLock({
    lockPath,
    ownerPid: 101,
    nonceFactory: () => "owner-a",
  });
  const release = await lock.acquire("test-owner-a");
  const replacement = {
    mode: "test-owner-b",
    pid: 202,
    nonce: "owner-b",
    startedAt: "2026-07-19T00:00:00.000Z",
  };
  await writeFile(lockPath, `${JSON.stringify(replacement)}\n`, "utf8");

  await release();

  assert.deepEqual(JSON.parse(await readFile(lockPath, "utf8")), replacement);
});

test("dead and malformed locks fail closed without automatic deletion", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wedding-code-stale-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "research.lock");
  const staleOwnerRaw = `${JSON.stringify({
    mode: "crashed-owner",
    pid: 303,
    nonce: "stale-owner",
    startedAt: "2026-07-18T00:00:00.000Z",
  })}\n`;
  await writeFile(lockPath, staleOwnerRaw, "utf8");
  const lock = createWeddingCodeResearchLock({
    lockPath,
    ownerPid: 404,
    nonceFactory: () => "recovered-owner",
  });

  await assert.rejects(
    lock.acquire("recovered-build"),
    /Automatic stale-lock deletion is disabled/
  );
  assert.equal(await readFile(lockPath, "utf8"), staleOwnerRaw);

  await writeFile(lockPath, "not-json\n", "utf8");
  await assert.rejects(lock.acquire("malformed-build"), /metadata is missing or malformed/);
  assert.equal(await readFile(lockPath, "utf8"), "not-json\n");
});

test("manual stale-lock removal restores exclusive acquisition without double owners", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wedding-code-manual-lock-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const lockPath = path.join(directory, "research.lock");
  await writeFile(lockPath, '{"pid":303,"nonce":"stale"}\n', "utf8");

  const first = createWeddingCodeResearchLock({
    lockPath,
    ownerPid: 404,
    nonceFactory: () => "owner-a",
  });
  const second = createWeddingCodeResearchLock({
    lockPath,
    ownerPid: 505,
    nonceFactory: () => "owner-b",
  });
  const blocked = await Promise.allSettled([
    first.acquire("first-before-manual-removal"),
    second.acquire("second-before-manual-removal"),
  ]);
  assert.equal(blocked.filter((result) => result.status === "fulfilled").length, 0);
  assert.equal(await readFile(lockPath, "utf8"), '{"pid":303,"nonce":"stale"}\n');

  await rm(lockPath);
  const contenders = await Promise.allSettled([
    first.acquire("first-after-manual-removal"),
    second.acquire("second-after-manual-removal"),
  ]);
  const owners = contenders.filter((result) => result.status === "fulfilled");
  assert.equal(owners.length, 1);
  await Promise.all([owners[0].value(), owners[0].value()]);
  await assert.rejects(readFile(lockPath, "utf8"), { code: "ENOENT" });
});

test("generated research route cleanup removes the owned page and its empty directory", async (context) => {
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "wedding-code-route-cleanup-"));
  context.after(() => rm(webRoot, { recursive: true, force: true }));
  const routeDirectory = path.join(
    webRoot,
    "src/app/internal/wedding-code-research"
  );
  const generatedRoute = path.join(routeDirectory, "page.tsx");
  const expectedSource = "// Artifact nonce: owned-by-this-process\nexport default null;\n";
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(generatedRoute, expectedSource, "utf8");

  await removeOwnedWeddingCodeResearchRoute({
    expectedSource,
    generatedRoute,
    routeDirectory,
  });

  await assert.rejects(readFile(generatedRoute, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(routeDirectory, "utf8"), { code: "ENOENT" });
});

test("generated research route cleanup preserves a replaced page", async (context) => {
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "wedding-code-route-replaced-"));
  context.after(() => rm(webRoot, { recursive: true, force: true }));
  const routeDirectory = path.join(
    webRoot,
    "src/app/internal/wedding-code-research"
  );
  const generatedRoute = path.join(routeDirectory, "page.tsx");
  const replacementSource = "export default function UserOwnedPage() {}\n";
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(generatedRoute, replacementSource, "utf8");

  await assert.rejects(
    removeOwnedWeddingCodeResearchRoute({
      expectedSource: "// Artifact nonce: stale-owner\n",
      generatedRoute,
      routeDirectory,
    }),
    /nonce or contents changed/
  );

  assert.equal(await readFile(generatedRoute, "utf8"), replacementSource);
});

test("generated research route cleanup reports an unexpected non-empty directory", async (context) => {
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "wedding-code-route-nonempty-"));
  context.after(() => rm(webRoot, { recursive: true, force: true }));
  const routeDirectory = path.join(
    webRoot,
    "src/app/internal/wedding-code-research"
  );
  const generatedRoute = path.join(routeDirectory, "page.tsx");
  const expectedSource = "// Artifact nonce: owned-by-this-process\n";
  const unexpectedFile = path.join(routeDirectory, "keep.txt");
  await mkdir(routeDirectory, { recursive: true });
  await writeFile(generatedRoute, expectedSource, "utf8");
  await writeFile(unexpectedFile, "keep", "utf8");

  await assert.rejects(
    removeOwnedWeddingCodeResearchRoute({
      expectedSource,
      generatedRoute,
      routeDirectory,
    }),
    (error) => error?.code === "ENOTEMPTY" || error?.code === "EEXIST"
  );

  assert.equal(await readFile(unexpectedFile, "utf8"), "keep");
});

test("the direct route check never deletes unlocked Next development artifacts", async (context) => {
  const webRoot = await mkdtemp(path.join(os.tmpdir(), "wedding-code-route-check-"));
  context.after(() => rm(webRoot, { recursive: true, force: true }));
  const developmentArtifact = path.join(webRoot, ".next/dev/server/sentinel.txt");
  await mkdir(path.dirname(developmentArtifact), { recursive: true });
  await writeFile(developmentArtifact, "keep", "utf8");

  await assertWeddingCodeResearchRouteAbsent(webRoot);

  assert.equal(await readFile(developmentArtifact, "utf8"), "keep");

  const generatedRoute = path.join(
    webRoot,
    "src/app/internal/wedding-code-research/page.tsx"
  );
  await mkdir(path.dirname(generatedRoute), { recursive: true });
  await writeFile(generatedRoute, "export default function Page() {}", "utf8");
  await assert.rejects(assertWeddingCodeResearchRouteAbsent(webRoot), /production build blocked/);
  assert.equal(await readFile(developmentArtifact, "utf8"), "keep");

  await rm(path.dirname(generatedRoute), { recursive: true, force: true });
  const generatedJavaScriptRoute = path.join(
    webRoot,
    "src/app/internal/wedding-code-research/[slug]/route.js"
  );
  await mkdir(path.dirname(generatedJavaScriptRoute), { recursive: true });
  await writeFile(generatedJavaScriptRoute, "export function POST() {}", "utf8");
  await assert.rejects(assertWeddingCodeResearchRouteAbsent(webRoot), /route directory still exists/);
});
