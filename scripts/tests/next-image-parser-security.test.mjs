import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const webManifest = fileURLToPath(new URL("../../apps/web/package.json", import.meta.url));
const webRequire = createRequire(webManifest);
const installedEntry = webRequire.resolve("next/dist/compiled/image-size");
const detectorEntry = webRequire.resolve("next/dist/compiled/image-detector/detector.js");

// 무한 반복/메모리 소진이 주 테스트 프로세스를 멈추지 않도록 실제 Next 사본을 격리한다.
function parseInChild(input, mode = "compiled", extension = "icns") {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=64", "-e", `
      const req = require("node:module").createRequire(process.argv[1]);
      const mode = process.argv[2];
      let parse;
      if (mode === "compiled") parse = req("next/dist/compiled/image-size").imageSize;
      else if (mode === "detector") parse = req("next/dist/compiled/image-detector/detector.js").detector;
      else if (mode === "getImageSize") parse = req("next/dist/server/image-optimizer").getImageSize;
      else {
        const loader = req("next/dist/build/webpack/loaders/next-image-loader").default;
        const trace = { traceChild: () => trace, traceAsyncFn: fn => fn(), traceFn: fn => fn() };
        parse = input => loader.call({
          currentTraceSpan: trace, rootContext: "/fixture", resourcePath: "/fixture/image." + process.argv[3],
          getOptions: () => ({ compilerType: "client", isDev: true, assetPrefix: "", basePath: "" }),
          emitFile: () => {},
        }, input);
      }
      process.send({ ready: true });
      process.once("message", async encoded => {
        try { process.send({ returned: true, result: await parse(Buffer.from(encoded, "base64")) }); }
        catch (error) { process.send({ returned: true, error: { name: error.name, message: error.message } }); }
        process.disconnect();
      });
    `, webManifest, mode, extension], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true });
    let outcome;
    let ready = false;
    let timer = setTimeout(() => child.kill("SIGKILL"), 10000);
    child.stderr.resume();
    child.on("message", message => {
      if (message.ready) {
        ready = true;
        clearTimeout(timer);
        timer = setTimeout(() => child.kill("SIGKILL"), 2000);
        child.send(input.toString("base64"));
      } else if (message.returned) outcome = message;
    });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      if (!ready) reject(new Error(`Next parser child failed to start: ${code}/${signal}`));
      else resolve(outcome ?? { returned: false, code, signal });
    });
  });
}

function entry(type, length = 8) {
  const input = Buffer.alloc(8);
  input.write(type, 0, 4, "ascii");
  input.writeUInt32BE(length, 4);
  return input;
}
function icns(entries, declaredLength) {
  const input = Buffer.concat([Buffer.alloc(8), ...entries]);
  input.write("icns", 0, 4, "ascii");
  input.writeUInt32BE(declaredLength ?? input.length, 4);
  return input;
}
async function expectRejection(input, mode) {
  // png 파일명이어도 내용은 ICNS다. 실제 loader의 내용 파싱 경계를 확인한다.
  const result = await parseInChild(input, mode, "png");
  assert.equal(result.returned, true, "malformed entry must reject, not loop or exhaust the child heap");
  assert.equal(typeof result.error?.message, "string", "malformed entry must be rejected");
}

test("Next stays exact and its detector remains the reviewed validate-only bundle", () => {
  assert.equal(webRequire("next/package.json").version, "16.3.4");
  assert.equal(createHash("sha256").update(readFileSync(detectorEntry)).digest("hex"),
    "09523f849d97f24a7956274f789d55ad78b34d2b987561bbf760c84fc84e0348");
  const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.match(workspace, /next@16\.3\.4:\s+patches\/next@16\.3\.4\.patch/);
  // 다른 패키지 image-size의 Metro용 패치를 vendored 사본 패치로 대체하지 않는다.
  assert.match(workspace, /image-size@1\.2\.1:\s+patches\/image-size@1\.2\.1\.patch/);
  assert.ok(installedEntry.includes("next"), "must use the web-resolved Next parser");
});

for (const mode of ["compiled", "getImageSize", "loader"]) {
  for (const position of ["first", "later"]) {
    test(`actual Next ${mode}: zero-length ${position} ICNS entry terminates by rejection`, async () => {
      const entries = position === "first" ? [entry("is32", 0)] : [entry("is32"), entry("icp5", 0)];
      await expectRejection(icns(entries), mode);
    });
  }
}
test("undersized entry lengths and incomplete headers reject", async () => {
  for (const length of [1, 4, 7]) await expectRejection(icns([entry("is32", length)]), "compiled");
  await expectRejection(icns([Buffer.from("is32")]), "compiled");
  await expectRejection(icns([entry("is32"), Buffer.from("icp5")]), "compiled");
});

test("single, multiple and prefix-only ICNS preserve dimensions and order", async () => {
  const single = await parseInChild(icns([entry("is32")]));
  assert.equal(single.error, undefined);
  assert.deepEqual(single.result, { width: 16, height: 16, type: "is32" });
  const multiple = await parseInChild(icns([entry("is32"), entry("icp5"), entry("ic08")]));
  assert.equal(multiple.returned, true);
  assert.equal(multiple.error, undefined);
  assert.equal(multiple.result.type, "icns");
  assert.deepEqual(multiple.result.images.map(({ width, height }) => [width, height]),
    [[16, 16], [32, 32], [256, 256]]);
  // image-size의 파일 읽기는 prefix만 넘길 수 있다. 전체 payload 강제는 범위 밖이다.
  const prefix = await parseInChild(icns([entry("ic10", 700000)], 700008));
  assert.equal(prefix.error, undefined);
  assert.deepEqual([prefix.result.width, prefix.result.height], [1024, 1024]);
});

test("detector classifies ICNS without claiming payload validity", async () => {
  const result = await parseInChild(icns([entry("is32", 0)]), "detector");
  assert.equal(result.returned, true);
  assert.equal(result.result, "icns");
});

for (const [format, type, detected] of [
  ["png", "png", "png"], ["jpeg", "jpg", "jpg"], ["webp", "webp", "webp"], ["avif", "avif", "heif"],
]) {
  test(`normal ${format}: dimensions survive compiled parser, Next getImageSize and static loader`, async () => {
    const input = await webRequire("sharp")({ create: { width: 31, height: 17, channels: 3,
      background: { r: 30, g: 70, b: 90 } } })[format]().toBuffer();
    const parsed = await parseInChild(input);
    assert.equal(parsed.returned, true);
    assert.equal(parsed.error, undefined);
    assert.deepEqual([parsed.result.width, parsed.result.height, parsed.result.type], [31, 17, type]);
    const next = await parseInChild(input, "getImageSize");
    assert.equal(next.error, undefined);
    assert.deepEqual(next.result, { width: 31, height: 17 });
    const detection = await parseInChild(input, "detector");
    assert.equal(detection.result, detected);
    const loaded = await parseInChild(input, "loader", format);
    assert.equal(loaded.returned, true);
    assert.equal(loaded.error, undefined);
    const metadata = JSON.parse(loaded.result.replace(/^export default /, "").replace(/;\s*$/, ""));
    assert.deepEqual([metadata.width, metadata.height], [31, 17]);
  });
}
