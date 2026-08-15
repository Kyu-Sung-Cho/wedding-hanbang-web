import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("dependency security floors and compatibility patches stay pinned", async () => {
  const [
    rootPackage,
    webPackage,
    workspace,
    imageSizePatch,
    minimatchPatch,
    sharpPatch,
  ] = await Promise.all([
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("apps/web/package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("pnpm-workspace.yaml", root), "utf8"),
    readFile(new URL("patches/image-size@1.2.1.patch", root), "utf8"),
    readFile(new URL("patches/minimatch@3.1.5.patch", root), "utf8"),
    readFile(new URL("patches/sharp@0.35.0.patch", root), "utf8"),
  ]);

  assert.equal(webPackage.dependencies.next, "16.2.11");
  assert.equal(webPackage.dependencies.sharp, "0.35.0");
  assert.equal(rootPackage.devDependencies.sharp, "0.35.0");
  assert.match(
    rootPackage.scripts["test:repo"],
    /scripts\/tests\/image-size-security-patch\.test\.mjs/,
  );

  for (const requiredOverride of [
    'postcss: "8.5.23"',
    '"shell-quote@<=1.8.4": "1.9.0"',
    '"undici@<6.28.0": "6.28.0"',
    '"undici@>=7.0.0 <7.29.0": "7.29.0"',
    '"tar@<=7.5.20": "7.5.21"',
    '"dompurify@<=3.4.12": "3.4.13"',
    '"js-yaml@>=3.0.0 <3.15.1": "3.15.1"',
    '"js-yaml@>=4.0.0 <4.3.1": "4.3.1"',
    '"nanoid@<3.3.18": "3.3.18"',
    'brace-expansion: "5.0.9"',
    'fast-uri: "3.1.5"',
    'sharp: "0.35.0"',
  ]) {
    assert.match(
      workspace,
      new RegExp(requiredOverride.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      `missing security override: ${requiredOverride}`,
    );
  }

  assert.match(
    workspace,
    /image-size@1\.2\.1:\s+patches\/image-size@1\.2\.1\.patch/,
  );
  assert.match(
    workspace,
    /auditConfig:\s+ignoreGhsas:\s+- GHSA-w3rx-r6r6-pgpr\s+- GHSA-5p2g-fcmc-qvqq/,
  );
  assert.match(
    workspace,
    /minimatch@3\.1\.5:\s+patches\/minimatch@3\.1\.5\.patch/,
  );
  assert.match(workspace, /sharp@0\.35\.0:\s+patches\/sharp@0\.35\.0\.patch/);
  assert.match(imageSizePatch, /Invalid ICNS entry length/);
  assert.match(imageSizePatch, /if \(box\.size < 8\)/);
  assert.match(
    minimatchPatch,
    /var expand = braceExpansion\.expand \|\| braceExpansion/,
  );
  assert.match(sharpPatch, /"types": "\.\/lib\/index\.d\.ts"/);
});
