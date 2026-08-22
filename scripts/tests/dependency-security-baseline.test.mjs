import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("dependency security floors and compatibility patches stay pinned", async () => {
  const [
    rootPackage,
    webPackage,
    workspace,
    minimatchPatch,
    sharpPatch,
  ] = await Promise.all([
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("apps/web/package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("pnpm-workspace.yaml", root), "utf8"),
    readFile(new URL("patches/minimatch@3.1.5.patch", root), "utf8"),
    readFile(new URL("patches/sharp@0.35.0.patch", root), "utf8"),
  ]);

  assert.equal(webPackage.dependencies.next, "16.2.11");
  assert.equal(webPackage.dependencies.sharp, "0.35.0");
  assert.equal(rootPackage.devDependencies.sharp, "0.35.0");

  for (const requiredOverride of [
    'postcss: "8.5.23"',
    '"shell-quote@<=1.8.4": "1.9.0"',
    '"undici@<6.28.0": "6.28.0"',
    '"undici@>=7.0.0 <7.29.0": "7.29.0"',
    '"tar@<=7.5.20": "7.5.21"',
    '"dompurify@<=3.4.12": "3.4.13"',
    // 아래 셋은 오버라이드가 **수정판 바로 한 단계 아래에 박혀** 경보가 열려 있던 것들이다.
    // 값만 올리고 여기 안 적으면 다음에 조용히 되돌아가도 아무도 모른다.
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
    /minimatch@3\.1\.5:\s+patches\/minimatch@3\.1\.5\.patch/,
  );
  assert.match(workspace, /sharp@0\.35\.0:\s+patches\/sharp@0\.35\.0\.patch/);
  assert.match(
    minimatchPatch,
    /var expand = braceExpansion\.expand \|\| braceExpansion/,
  );
  assert.match(sharpPatch, /"types": "\.\/lib\/index\.d\.ts"/);
});
