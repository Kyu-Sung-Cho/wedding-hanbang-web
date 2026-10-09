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
      else if (mode === "productionOptimizer") {
        const { imageOptimizer } = req("next/dist/server/image-optimizer");
        const { defaultConfig } = req("next/dist/server/config-shared");
        parse = async input => {
          const result = await imageOptimizer({ buffer: input, etag: "synthetic-image", cacheControl: "max-age=60" },
            { href: "/synthetic.png", width: 8, quality: 70, mimeType: "image/webp" }, defaultConfig,
            { isDev: false, silent: true });
          return { contentType: result.contentType, bytes: result.buffer.length, fallback: Boolean(result.error) };
        };
      }
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

function box(name, payload = Buffer.alloc(0), declaredSize) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(declaredSize ?? result.length, 0);
  result.write(name, 4, 4, "ascii");
  payload.copy(result, 8);
  return result;
}
const jxlStream = Buffer.from([0xff, 0x0a, 0x01, 0x00]);
const jxlHeader = [box("JXL ", Buffer.from([13, 10, 135, 10])),
  box("ftyp", Buffer.concat([Buffer.from("jxl "), Buffer.alloc(4)]))];
const partialIndex = Buffer.from([0x80, 0, 0, 0]);

for (const mode of ["compiled", "getImageSize", "loader"]) {
  test(`actual Next ${mode}: zero-size JXL partial box rejects without exhausting memory`, async () => {
    await expectRejection(Buffer.concat([...jxlHeader, box("jxlp", Buffer.alloc(0), 0)]), mode);
  });

  test(`actual Next ${mode}: complete, split and EOF JXL codestreams keep their dimensions`, async () => {
    const streams = [
      box("jxlc", jxlStream),
      Buffer.concat([box("jxlp", Buffer.concat([Buffer.alloc(4), jxlStream.subarray(0, 2)])),
        box("jxlp", Buffer.concat([partialIndex, jxlStream.subarray(2)]))]),
      box("jxlc", jxlStream, 0),
      box("jxlp", Buffer.concat([partialIndex, jxlStream]), 0),
    ];
    for (const stream of streams) {
      const result = await parseInChild(Buffer.concat([...jxlHeader, stream]), mode, "jxl");
      assert.equal(result.returned, true);
      assert.equal(result.error, undefined);
      const dimensions = mode === "loader"
        ? JSON.parse(result.result.replace(/^export default /, "").replace(/;\s*$/, "")) : result.result;
      assert.deepEqual([dimensions.width, dimensions.height], [8, 8]);
    }
  });
}

test("ISO box header bounds reject malformed lengths and do not scan inside an EOF box", async () => {
  for (const size of [1, 7, 1000]) {
    await expectRejection(Buffer.concat([...jxlHeader, box("jxlp", Buffer.alloc(0), size)]), "compiled");
  }
  await expectRejection(Buffer.concat([...jxlHeader, Buffer.from([0, 0, 0, 8, 106, 120, 108])]), "compiled");
  const hiddenCodestream = box("jxlp", Buffer.concat([partialIndex, jxlStream]));
  await expectRejection(Buffer.concat([...jxlHeader, box("free", hiddenCodestream, 0)]), "compiled");
});

test("the shared ISO reader preserves HEIF and JPEG 2000 dimensions with normal and EOF boxes", async () => {
  for (const size of [undefined, 0]) {
    const dimensions = Buffer.alloc(12);
    dimensions.writeUInt32BE(640, 4);
    dimensions.writeUInt32BE(480, 8);
    const meta = box("meta", Buffer.concat([Buffer.alloc(4),
      box("iprp", box("ipco", box("ispe", dimensions, size), size), size)]), size);
    const heif = Buffer.concat([box("ftyp", Buffer.concat([Buffer.from("avif"), Buffer.alloc(4)])), meta]);
    const jp2Dimensions = Buffer.alloc(14);
    jp2Dimensions.writeUInt32BE(480, 0);
    jp2Dimensions.writeUInt32BE(640, 4);
    const jp2 = Buffer.concat([box("jP  ", Buffer.from([13, 10, 135, 10])),
      box("ftyp", Buffer.concat([Buffer.from("jp2 "), Buffer.alloc(4)])),
      box("jp2h", box("ihdr", jp2Dimensions, size), size)]);
    for (const input of [heif, jp2]) {
      for (const mode of ["compiled", "getImageSize"]) {
        const result = await parseInChild(input, mode);
        assert.equal(result.returned, true);
        assert.equal(result.error, undefined);
        assert.deepEqual([result.result.width, result.result.height], [640, 480]);
      }
    }
  }
});

test("production optimizer terminates for malformed JXL and still optimizes ordinary PNG", async () => {
  const malformed = await parseInChild(Buffer.concat([...jxlHeader, box("jxlp", Buffer.alloc(0), 0)]), "productionOptimizer");
  assert.equal(malformed.returned, true, "the production optimizer must terminate in the bounded child");
  const input = await webRequire("sharp")({ create: { width: 31, height: 17, channels: 3,
    background: { r: 30, g: 70, b: 90 } } }).png().toBuffer();
  const result = await parseInChild(input, "productionOptimizer");
  assert.equal(result.returned, true);
  assert.equal(result.error, undefined);
  assert.equal(result.result.contentType, "image/webp");
  assert.equal(result.result.fallback, false);
  assert.ok(result.result.bytes > 0);
});

test("Next stays exact and its detector remains the reviewed validate-only bundle", () => {
  assert.equal(webRequire("next/package.json").version, "16.3.8");
  assert.equal(createHash("sha256").update(readFileSync(detectorEntry)).digest("hex"),
    "09523f849d97f24a7956274f789d55ad78b34d2b987561bbf760c84fc84e0348");
  const workspace = readFileSync(new URL("../../pnpm-workspace.yaml", import.meta.url), "utf8");
  assert.match(workspace, /next@16\.3\.8:\s+patches\/next@16\.3\.8\.patch/);
  // 다른 패키지 image-size의 Metro용 패치를 vendored 사본 패치로 대체하지 않는다.
  assert.match(workspace, /image-size@1\.2\.1:\s+patches\/image-size@1\.2\.1\.patch/);
  assert.ok(installedEntry.includes("next"), "must use the web-resolved Next parser");
  const patch = readFileSync(new URL("../../patches/next@16.3.8.patch", import.meta.url), "utf8");
  const patchedBundle = patch.split(/\r?\n/).find(line => line.startsWith("+(()=>"));
  assert.ok(patchedBundle, "the pinned patch must contain the vendored parser");
  assert.equal(readFileSync(installedEntry, "utf8").trimEnd(), patchedBundle.slice(1),
    "the actual installed Next parser must contain the tested patch bytes");
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
