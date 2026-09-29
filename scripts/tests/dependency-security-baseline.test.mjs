import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("installed fast-uri rejects malformed authority brackets without breaking valid IPv6", () => {
  const webRequire = createRequire(new URL("apps/web/package.json", root));
  const ajvRequire = createRequire(webRequire.resolve("ajv"));
  const uri = ajvRequire("fast-uri");
  // 호스트 정책과 실제 HTTP 목적지가 달라지던 입력이다. 네트워크 요청은 하지 않는다.
  const ambiguous = "http://user@[@127.0.0.1/";
  assert.equal(new URL(ambiguous).hostname, "127.0.0.1");
  for (const input of [ambiguous, "http://[fe80", "https://example.test]/path"]) {
    assert.equal(uri.parse(input).error, "URI host is malformed.");
  }
  assert.equal(uri.parse("http://[::1]/path").error, undefined);
  assert.equal(uri.parse("https://example.test/path").host, "example.test");
});

test("dependency security floors and compatibility patches stay pinned", async () => {
  const [
    rootPackage,
    webPackage,
    workspace,
    minimatchPatch,
    decoderPatch,
    imageSizePatch,
  ] = await Promise.all([
    readFile(new URL("package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("apps/web/package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("pnpm-workspace.yaml", root), "utf8"),
    readFile(new URL("patches/minimatch@3.1.5.patch", root), "utf8"),
    readFile(new URL("patches/decode-uri-component@0.5.0.patch", root), "utf8"),
    readFile(new URL("patches/image-size@1.2.1.patch", root), "utf8"),
  ]);

  assert.equal(webPackage.dependencies.next, "16.3.4");
  assert.equal(webPackage.devDependencies["eslint-config-next"], "16.3.4");
  assert.equal(webPackage.dependencies.sharp, "0.35.4");
  assert.equal(rootPackage.devDependencies.sharp, "0.35.4");
  assert.equal(webPackage.devDependencies.vitest, "4.1.11");

  for (const requiredOverride of [
    'postcss: "8.5.23"',
    '"shell-quote@<=1.8.4": "1.9.0"',
    '"undici@<6.28.0": "6.28.0"',
    '"undici@>=7.0.0 <7.29.0": "7.29.0"',
    '"tar@<=7.5.20": "7.5.21"',
    '"dompurify@<=3.4.12": "3.4.13"',
    // 아래 셋은 오버라이드가 **수정판 바로 한 단계 아래에 박혀** 경보가 열려 있던 것들이다.
    // 값만 올리고 여기 안 적으면 다음에 조용히 되돌아가도 아무도 모른다.
    '"js-yaml@>=3.0.0 <3.15.2": "3.15.2"',
    '"js-yaml@>=4.0.0 <4.3.2": "4.3.2"',
    '"nanoid@<3.3.18": "3.3.18"',
    'brace-expansion: "5.0.9"',
    'fast-uri: "3.1.7"',
    'browserslist: "4.28.7"',
    '"@humanfs/node": "0.16.8"',
    'fflate: "0.4.9"',
    '"@xmldom/xmldom": "0.8.15"',
    'postcss-selector-parser: "6.1.3"',
    'decode-uri-component: "0.5.0"',
    'sharp: "0.35.4"',
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
  // 0.35.4는 import/require용 types export를 제공하므로 옛 호환 패치가 필요 없다.
  assert.doesNotMatch(workspace, /sharp@0\.35\.0/);
  assert.match(
    minimatchPatch,
    /var expand = braceExpansion\.expand \|\| braceExpansion/,
  );
  assert.match(workspace, /decode-uri-component@0\.5\.0:\s+patches\/decode-uri-component@0\.5\.0\.patch/);
  assert.match(decoderPatch, /\+module\.exports = function decodeUriComponent/);
  assert.match(decoderPatch, /\+\s*"type": "commonjs"/);
  assert.match(workspace, /image-size@1\.2\.1:\s+patches\/image-size@1\.2\.1\.patch/);
  assert.match(imageSizePatch, /\+\s*if \(imageLength < SIZE_HEADER\)/);
  assert.match(imageSizePatch, /\+\s*const boxSize = declaredSize === 0 \? remaining : declaredSize/);
});

test("September advisory fixes are resolved in the lockfile, not only requested by overrides", async () => {
  const lockfile = (await readFile(new URL("pnpm-lock.yaml", root), "utf8")).replace(/\r\n?/g, "\n");
  const packages = lockfile.split("\npackages:\n")[1]?.split("\nsnapshots:\n")[0];
  assert.ok(packages, "lockfile package inventory must be present");
  const identities = packages.split(/\r?\n/)
    .filter(line => /^  \S.*:$/.test(line))
    .map(line => line.trim().slice(0, -1).replace(/^'|'$/g, ""));
  for (const [name, version] of [
    ["next", "16.3.4"],
    ["eslint-config-next", "16.3.4"],
    ["sharp", "0.35.4"],
    ["fast-uri", "3.1.7"],
    ["browserslist", "4.28.7"],
    ["@humanfs/node", "0.16.8"],
    ["fflate", "0.4.9"],
    ["@xmldom/xmldom", "0.8.15"],
    ["postcss-selector-parser", "6.1.3"],
    ["decode-uri-component", "0.5.0"],
    ["vitest", "4.1.11"],
    ["@vitest/mocker", "4.1.11"],
  ]) {
    assert.deepEqual(
      identities.filter(identity => identity.startsWith(`${name}@`)),
      [`${name}@${version}`],
      `${name} must resolve only to the reviewed security patch`,
    );
  }
  assert.deepEqual(
    identities.filter(identity => identity.startsWith("js-yaml@")),
    ["js-yaml@3.15.2", "js-yaml@4.3.2"],
    "both js-yaml majors must count empty merge sources against the work limit",
  );
});
