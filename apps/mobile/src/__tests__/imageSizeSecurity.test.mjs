import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { after } from 'node:test';
import { fileURLToPath, URL } from 'node:url';

const mobileRequire = createRequire(new URL('../../package.json', import.meta.url));
const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
const configRequire = createRequire(expoRequire.resolve('@expo/metro-config/package.json'));
const metroRequire = createRequire(configRequire.resolve('metro/package.json'));
const installedEntry = metroRequire.resolve('image-size');
const installedRoot = dirname(metroRequire.resolve('image-size/package.json'));
const temporaryBase = resolve(tmpdir());
const temporaryPrefix = 'hanbang-image-size-security-';
const temporaryRoot = mkdtempSync(join(temporaryBase, temporaryPrefix));
const parserEntry = join(temporaryRoot, 'dist/index.js');
after(() => {
  const target = resolve(temporaryRoot);
  assert.equal(dirname(target), temporaryBase, 'cleanup must remain a direct child of the temporary directory');
  assert.ok(basename(target).startsWith(temporaryPrefix), 'cleanup may remove only this test run directory');
  rmSync(target, { recursive: true, force: true });
});
cpSync(installedRoot, temporaryRoot, { recursive: true });

// 설치본은 읽기만 한다. 원문 두 함수와 전체 파일 hash로 기반을 고정한 임시 복사본에만 패치를 적용한다.
const upstream = [
  {
    path: 'dist/types/icns.js',
    start: 'function readImageHeader(input, imageOffset) {',
    end: 'function getImageSize(type) {',
    hash: '5e6a097fca237b0bb3b68a1be920e39a3846c0018d8917658b5ed88590a710e8',
    source: `function readImageHeader(input, imageOffset) {
    const imageLengthOffset = imageOffset + ENTRY_LENGTH_OFFSET;
    return [
        (0, utils_1.toUTF8String)(input, imageOffset, imageLengthOffset),
        (0, utils_1.readUInt32BE)(input, imageLengthOffset),
    ];
}
`,
  },
  {
    path: 'dist/types/utils.js',
    start: 'function readBox(input, offset) {',
    end: 'function findBox(input, boxName, offset) {',
    hash: 'e9faf86abcc962a5fc2488a4c3c9d8dc915aa22a0dd6a7bad6556cd9a326c349',
    source: `function readBox(input, offset) {
    if (input.length - offset < 4)
        return;
    const boxSize = (0, exports.readUInt32BE)(input, offset);
    if (input.length - offset < boxSize)
        return;
    return {
        name: (0, exports.toUTF8String)(input, 4 + offset, 8 + offset),
        offset,
        size: boxSize,
    };
}
`,
  },
];
for (const file of upstream) {
  const path = join(temporaryRoot, file.path);
  const installed = readFileSync(path, 'utf8');
  const start = installed.indexOf(file.start);
  const end = installed.indexOf(file.end, start + 1);
  assert.ok(start >= 0 && end > start, 'upstream parser function must exist');
  const restored = installed.slice(0, start) + file.source + installed.slice(end);
  assert.equal(createHash('sha256').update(restored).digest('hex'), file.hash, 'the test must apply the patch to the exact upstream source');
  writeFileSync(path, restored);
}
execFileSync('git', ['-c', 'core.autocrlf=false', 'apply', '--', fileURLToPath(new URL('../../../../patches/image-size@1.2.1.patch', import.meta.url))], { cwd: temporaryRoot, windowsHide: true });

// 실제 파서를 별도 프로세스에서 실행해 무한 반복도 테스트 실행기를 멈추지 못하게 한다.
async function readDimensions(input, entry = parserEntry) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=64', '-e', `
      const imageSize = require(process.argv[1]);
      process.send({ ready: true });
      process.once('message', (input) => {
        try { process.send({ returned: true, result: imageSize(Buffer.from(input, 'base64')) }); }
        catch (error) { process.send({ returned: true, error: { name: error.name, message: error.message } }); }
        process.disconnect();
      });
    `, entry], {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      env: { ...process.env, NODE_PATH: join(dirname(dirname(installedEntry)), '..') },
      windowsHide: true,
    });
    let outcome;
    let ready = false;
    let timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stderr.resume();
    child.on('message', (message) => {
      if (message.ready) {
        ready = true;
        globalThis.clearTimeout(timer);
        timer = globalThis.setTimeout(() => child.kill('SIGKILL'), 2000);
        child.send(input.toString('base64'));
      } else if (message.returned) {
        outcome = message;
      }
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      globalThis.clearTimeout(timer);
      if (!ready) reject(new Error(`image-size child did not start: ${code}/${signal}`));
      else resolve(outcome ?? { returned: false, code, signal });
    });
  });
}

function box(name, payload = Buffer.alloc(0), declaredSize) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(declaredSize ?? result.length, 0);
  result.write(name, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
}

function icns(entries, fileLength) {
  const result = Buffer.concat([Buffer.alloc(8), ...entries]);
  result.write('icns', 0, 'ascii');
  result.writeUInt32BE(fileLength ?? result.length, 4);
  return result;
}

function iconEntry(name, size = 8) {
  const result = Buffer.alloc(8);
  result.write(name, 0, 'ascii');
  result.writeUInt32BE(size, 4);
  return result;
}

const stream = Buffer.from([0xff, 0x0a, 0x01, 0x00]);
const jxlHeader = [box('JXL ', Buffer.from([13, 10, 135, 10])), box('ftyp', Buffer.concat([Buffer.from('jxl '), Buffer.alloc(4)]))];
const partialIndex = Buffer.from([0x80, 0, 0, 0]);
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082', 'hex');

async function expectDimensions(input, width, height, entry = parserEntry) {
  const result = await readDimensions(input, entry);
  assert.equal(result.returned, true, 'the image parser must terminate within the bounded child run');
  assert.equal(result.error, undefined, `valid image metadata must remain readable: ${JSON.stringify(result.error)}`);
  assert.equal(result.result.width, width);
  assert.equal(result.result.height, height);
  return result.result;
}

async function expectRejection(input, entry = parserEntry) {
  const result = await readDimensions(input, entry);
  assert.equal(result.returned, true, 'malformed image must reject instead of looping or exhausting the child heap');
  assert.equal(typeof result.error?.message, 'string', 'malformed metadata must be rejected');
}

test('Metro resolves image-size 1.2.1 and preserves ordinary PNG metadata', async () => {
  assert.equal(metroRequire('image-size/package.json').version, '1.2.1');
  await expectDimensions(png, 1, 1);
});

test('ICNS zero-length first and later entries reject within a bounded process', async () => {
  await expectRejection(icns([iconEntry('is32', 0)]));
  await expectRejection(icns([iconEntry('is32'), iconEntry('icp5', 0)]));
});

test('ICNS incomplete headers and positive entries smaller than the header reject', async () => {
  await expectRejection(icns([Buffer.from('is32')]));
  await expectRejection(icns([iconEntry('is32', 7)]));
});

test('ICNS single, multiple and prefix-only entries keep their previous dimensions', async () => {
  await expectDimensions(icns([iconEntry('is32')]), 16, 16);
  const multiple = await expectDimensions(icns([iconEntry('is32'), iconEntry('icp5')]), 16, 16);
  assert.deepEqual(multiple.images.map(({ width, height }) => [width, height]), [[16, 16], [32, 32]]);
  // image-size의 파일 읽기는 512KiB prefix만 전달하므로 큰 payload 전체를 요구하면 안 된다.
  await expectDimensions(icns([iconEntry('ic10', 700000)], 700008), 1024, 1024);
});

test('JXL zero-length partial box without a codestream rejects without looping', async () => {
  await expectRejection(Buffer.concat([...jxlHeader, box('jxlp', Buffer.alloc(0), 0)]));
});

test('JXL complete and split codestreams retain 8 by 8 dimensions', async () => {
  await expectDimensions(Buffer.concat([...jxlHeader, box('jxlc', stream)]), 8, 8);
  await expectDimensions(Buffer.concat([...jxlHeader, box('jxlp', Buffer.concat([Buffer.alloc(4), stream.subarray(0, 2)])), box('jxlp', Buffer.concat([partialIndex, stream.subarray(2)]))]), 8, 8);
});

test('valid JXL size-zero EOF codestream and partial boxes remain readable', async () => {
  await expectDimensions(Buffer.concat([...jxlHeader, box('jxlc', stream, 0)]), 8, 8);
  await expectDimensions(Buffer.concat([...jxlHeader, box('jxlp', Buffer.concat([partialIndex, stream]), 0)]), 8, 8);
});

test('JXL truncated and undersized box headers reject', async () => {
  await expectRejection(Buffer.concat([...jxlHeader, box('jxlp', Buffer.alloc(0), 7)]));
  await expectRejection(Buffer.concat([...jxlHeader, Buffer.from([0, 0, 0, 8, 106, 120, 108])]));
});

test('AVIF nested dimension boxes, including EOF boxes, remain compatible', async () => {
  for (const size of [undefined, 0]) {
    const dimensions = Buffer.alloc(12);
    dimensions.writeUInt32BE(640, 4);
    dimensions.writeUInt32BE(480, 8);
    const meta = box('meta', Buffer.concat([Buffer.alloc(4), box('iprp', box('ipco', box('ispe', dimensions, size), size), size)]), size);
    await expectDimensions(Buffer.concat([box('ftyp', Buffer.concat([Buffer.from('avif'), Buffer.alloc(4)])), meta]), 640, 480);
  }
});

test('JPEG 2000 uses the same box reader without changing ordinary or EOF dimensions', async () => {
  for (const size of [undefined, 0]) {
    const dimensions = Buffer.alloc(14);
    dimensions.writeUInt32BE(480, 0);
    dimensions.writeUInt32BE(640, 4);
    dimensions.writeUInt16BE(3, 8);
    dimensions[10] = 7;
    dimensions[11] = 7;
    await expectDimensions(Buffer.concat([box('jP  ', Buffer.from([13, 10, 135, 10])), box('ftyp', Buffer.concat([Buffer.from('jp2 '), Buffer.alloc(4)])), box('jp2h', box('ihdr', dimensions, size), size)]), 640, 480);
  }
});

test('the reported HEIF payload returns finitely in this installed version', async () => {
  const reported = Buffer.from('00000010667479706176696600000000000000246d657461000000000000000869707270000000146970636f000000006973706500000000000000000000000000000000', 'hex');
  const result = await readDimensions(reported);
  assert.equal(result.returned, true, 'this control does not establish an upstream HEIF loop in 1.2.1');
});

test('the dependency actually installed for Metro matches the tested patch and rejects both looping inputs', async () => {
  for (const file of upstream) {
    assert.deepEqual(readFileSync(join(installedRoot, file.path)), readFileSync(join(temporaryRoot, file.path)), 'pnpm must install the same parser bytes that the isolated tests exercise');
  }
  await expectDimensions(png, 1, 1, installedEntry);
  await expectRejection(icns([iconEntry('is32', 0)]), installedEntry);
  await expectRejection(Buffer.concat([...jxlHeader, box('jxlp', Buffer.alloc(0), 0)]), installedEntry);
});
