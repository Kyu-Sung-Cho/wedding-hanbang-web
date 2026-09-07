import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';

// 앱이 실제 설치한 Expo→React Navigation→query-string 의존성을 따라간다.
const appRequire = createRequire(new URL('../../package.json', import.meta.url));
const expoRequire = createRequire(appRequire.resolve('expo-router/package.json'));
const navigationPackage = expoRequire.resolve('@react-navigation/core/package.json');
const navigationRequire = createRequire(navigationPackage);
const queryPath = navigationRequire.resolve('query-string');
const query = navigationRequire('query-string');
const queryRequire = createRequire(queryPath);
const decoderPath = queryRequire.resolve('decode-uri-component');
const decode = queryRequire('decode-uri-component');
const { getStateFromPath } = await import(pathToFileURL(join(dirname(navigationPackage), 'lib/module/getStateFromPath.js')).href);
const plain = value => JSON.parse(JSON.stringify(value));
const plusCompatibility = "\t\t// Preserve the query-string 7 decoder contract, including fragment plus signs.\n\t\tencodedURI = encodedURI.replace(/\\+/g, ' ');\n\n";
const patchPath = resolve(import.meta.dirname, '../../../../patches/decode-uri-component@0.5.0.patch');

function boundedDecode(source, input) {
  let nativeCalls = 0;
  const context = { module: { exports: {} }, input, decodeURIComponent: value => {
    nativeCalls++;
    return decodeURIComponent(value);
  } };
  const output = vm.runInNewContext(`${source}\n;module.exports(input);`, context, { timeout: 1000 });
  return { output, nativeCalls };
}

// 설치된 hardlink는 쓰지 않는다. 알려진 wrapper만 되돌려 npm 원문 SHA를 확인한 뒤
// 매번 독립 temp에 tracked patch를 실제 적용한다. 따라서 patch 의미 변이가 실행까지 도달한다.
function withIsolatedPatchedDecoder(run) {
  const installedSource = readFileSync(decoderPath, 'utf8');
  const upstreamSource = installedSource.replace('module.exports = function decodeUriComponent(encodedURI) {', 'export default function decodeUriComponent(encodedURI) {')
    .replace(plusCompatibility, '');
  assert.equal(createHash('sha256').update(upstreamSource).digest('hex'), '9401353df38f8010ad7035fe8d666bce6a4902bc1cff809afc4ab23fa2e0bdaa', 'isolated fixture must be the verified npm 0.5.0 algorithm');
  const packageSource = readFileSync(join(dirname(decoderPath), 'package.json'), 'utf8').replace('"type": "commonjs"', '"type": "module"');
  const patch = readFileSync(patchPath, 'utf8');
  assert.deepEqual([...patch.matchAll(/^diff --git (.+)$/gm)].map(x => x[1]), ['a/index.js b/index.js', 'a/package.json b/package.json']);
  const directory = mkdtempSync(join(tmpdir(), 'hanbang-decoder-'));
  try {
    writeFileSync(join(directory, 'index.js'), upstreamSource);
    writeFileSync(join(directory, 'package.json'), packageSource);
    const applied = spawnSync('git', ['-c', 'core.autocrlf=false', 'apply', '--whitespace=nowarn', patchPath], { cwd: directory, encoding: 'utf8', timeout: 3000 });
    assert.equal(applied.status, 0, applied.stderr || applied.error?.message);
    const candidateSource = readFileSync(join(directory, 'index.js'), 'utf8');
    const candidate = createRequire(join(directory, 'package.json'))('./index.js');
    const module = { exports: {} };
    new Function('require', 'module', 'exports', readFileSync(queryPath, 'utf8'))(name => name === 'decode-uri-component' ? candidate : queryRequire(name), module, module.exports);
    run(module.exports, candidateSource);
    assert.equal(candidateSource, installedSource, 'behavior-checked patch result must equal the installed package');
  } finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep));
    rmSync(directory, { recursive: true, force: true });
  }
}

test('installed query decoder preserves Korean, emoji, spaces, encoded plus and duplicate query keys', () => {
  assert.equal(typeof decode, 'function', 'query-string 7 requires a callable CommonJS decoder');
  assert.deepEqual(plain(query.parse('title=%ED%95%9C%EB%B0%A9&emoji=%F0%9F%92%8D&space=a+b&plus=a%2Bb&tag=one&tag=two&empty=&flag')), {
    title: '한방', emoji: '💍', space: 'a b', plus: 'a+b', tag: ['one', 'two'], empty: '', flag: null,
  });
  assert.equal(decode('a+b%2Bc'), 'a b+c');
  assert.equal(query.parseUrl('/chat?title=a+b#hello+world', { parseFragmentIdentifier: true }).fragmentIdentifier, 'hello world');
});

test('actual React Navigation deep link parsing preserves path params and decoded query values', () => {
  const path = '/chat/anonymous?title=%ED%95%9C%EB%B0%A9&emoji=%F0%9F%92%8D&space=a+b&plus=a%2Bb&tag=one&tag=two&empty=&flag&count=2';
  const state = getStateFromPath(path, { screens: { Chat: { path: 'chat/:name', parse: { count: Number } } } });
  assert.deepEqual(plain(state), { routes: [{ name: 'Chat', path, params: {
    name: 'anonymous', title: '한방', emoji: '💍', space: 'a b', plus: 'a+b', tag: ['one', 'two'], empty: '', flag: null, count: 2,
  } }] });
});

test('query-string retains optional decode, array and numeric parsing contracts', () => {
  assert.deepEqual(plain(query.parse('title=%ED%95%9C+%EB%B0%A9&plus=%2B', { decode: false })), { title: '%ED%95%9C+%EB%B0%A9', plus: '%2B' });
  assert.deepEqual(plain(query.parse('tag[]=a&tag[]=b&count=2&ready=false', { arrayFormat: 'bracket', parseNumbers: true, parseBooleans: true })), { tag: ['a','b'], count: 2, ready: false });
  const input = { title: '한방 💍', plus: 'a+b', tag: ['one','two'], empty: '', flag: null };
  assert.deepEqual(plain(query.parse(query.stringify(input))), input);
  const parsed = query.parse('__proto__=safe&constructor=value');
  assert.equal(Object.getPrototypeOf(parsed), null);
  assert.equal(parsed.__proto__, 'safe');
});

test('malformed escapes remain best effort without recombining a decoded percent separator', () => {
  const fixtures = [
    ['%', '%'], ['%GG', '%GG'], ['%E2%82', '%E2%82'], ['%C3%5A%A5%AB', '%C3Z%A5%AB'],
    ['%FE%FF', '\uFFFD\uFFFD'], ['%C2', '\uFFFD'], ['%F0%9F%98%80%ab', '😀%ab'],
    ['%2525', '%25'], ['%00', '\0'], ['%84%D7%25%88%90', '%84%D7%%88%90'],
  ];
  for (const [input, expected] of fixtures) {
    assert.equal(query.parse(`value=${input}`).value, expected, input);
    const state = getStateFromPath(`/chat?value=${input}`, { screens: { Chat: 'chat' } });
    assert.equal(state.routes[0].params.value, expected, `deep link ${input}`);
  }
});

test('small malformed input keeps native decoder operations bounded instead of retrying recursively', () => {
  const source = readFileSync(decoderPath, 'utf8');
  for (const size of [16, 32]) {
    const input = '%FF'.repeat(size); // 각각 48/96 bytes. 네트워크나 실제 사용자 입력은 사용하지 않는다.
    // VM timeout이 잘못된 알고리즘 변이의 무한 실행도 최대 1초로 제한한다.
    const { output, nativeCalls } = boundedDecode(source, input);
    assert.equal(output, input);
    assert.ok(nativeCalls <= input.length * 4 + 16, `${input.length} byte input caused ${nativeCalls} native decoder operations`);
    assert.equal(query.parse(`value=${input}`).value, input);
  }
});

test('tracked compatibility patch executes in an isolated copy with bounded decoding and installed behavior parity', () => {
  withIsolatedPatchedDecoder((candidateQuery, source) => {
    // 비용 변이는 raw source 동등성 검사보다 먼저 실제 실행 결과로 검출한다.
    const input = '%FF'.repeat(16);
    const { output, nativeCalls } = boundedDecode(source, input);
    assert.equal(output, input);
    assert.ok(nativeCalls <= input.length * 4 + 16, `isolated patch caused ${nativeCalls} native decoder operations`);
    assert.deepEqual(plain(candidateQuery.parse('title=%ED%95%9C%EB%B0%A9&emoji=%F0%9F%92%8D&space=a+b&plus=a%2Bb&tag=one&tag=two')), {
      title: '한방', emoji: '💍', space: 'a b', plus: 'a+b', tag: ['one', 'two'],
    });
    assert.equal(candidateQuery.parseUrl('/chat#hello+world', { parseFragmentIdentifier: true }).fragmentIdentifier, 'hello world');
    assert.equal(candidateQuery.parse('value=%84%D7%25%88%90').value, '%84%D7%%88%90');
  });
});
