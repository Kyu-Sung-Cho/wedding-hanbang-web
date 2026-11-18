// 청첩장 디자인 글꼴 파일(2026-11-17 파운더 디자인 아티팩트, 원문: 이 디자인 완전 같아야해).
//
// 아티팩트 글꼴은 고운바탕 + Cormorant Garamond + Noto Sans KR 이다. Google Fonts 원본 아홉 면을 그대로
// 넣으면 37,330,244 바이트(gzip 13,079,075)가 앱과 OTA 업데이트에 더해진다. 그래서 서브셋을 싣는다
// (scripts/subset-invitation-fonts.py):
//   - Noto Sans KR 400·500·700: 현대 한글 음절 11,172자 전부. 사람이 쓰는 글이 들어가는 본문이라 빼지 않는다.
//   - 고운바탕 400·700: KS X 1001 음절 2,350자. 제목·이름·편지에 쓰는 표시용 명조다. 없는 음절은
//     플랫폼 글꼴이 그 글자만 그린다(iOS CoreText 대체, 안드로이드 시스템 대체 사슬, 웹 브라우저 대체).
//   - Cormorant Garamond 넷: 라틴 글자만(숫자·날짜·로고).
// 합계 10,733,628 바이트(gzip 약 3.7MB). 이 검사는 그 결정이 조용히 풀리지 않게 잡는다.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { existsSync, readFileSync, statSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import { TextDecoder } from "node:util";
import ts from "typescript";

const fontsDir = (relative) => fileURLToPath(new URL(`../../assets/fonts/${relative}`, import.meta.url));

const FACES = {
  "noto-sans-kr": ["NotoSansKR-Regular.ttf", "NotoSansKR-Medium.ttf", "NotoSansKR-Bold.ttf"],
  "gowun-batang": ["GowunBatang-Regular.ttf", "GowunBatang-Bold.ttf"],
  "cormorant-garamond": [
    "CormorantGaramond-Regular.ttf",
    "CormorantGaramond-Medium.ttf",
    "CormorantGaramond-Italic.ttf",
    "CormorantGaramond-MediumItalic.ttf",
  ],
};

function tables(buffer) {
  const out = {};
  for (let index = 0; index < buffer.readUInt16BE(4); index += 1) {
    const at = 12 + index * 16;
    out[buffer.toString("latin1", at, at + 4)] = { offset: buffer.readUInt32BE(at + 8), length: buffer.readUInt32BE(at + 12) };
  }
  return out;
}

/** cmap 의 Windows 유니코드 표(형식 12 또는 4): 코드 포인트 → 글리프 번호. */
function glyphMap(buffer) {
  const { offset } = tables(buffer).cmap;
  let chosen = null;
  for (let index = 0; index < buffer.readUInt16BE(offset + 2); index += 1) {
    const at = offset + 4 + index * 8;
    const platform = buffer.readUInt16BE(at);
    const encoding = buffer.readUInt16BE(at + 2);
    const table = offset + buffer.readUInt32BE(at + 4);
    const format = buffer.readUInt16BE(table);
    if (platform === 3 && encoding === 10 && format === 12) chosen = { table, format };
    else if (platform === 3 && encoding === 1 && format === 4 && !chosen) chosen = { table, format };
  }
  assert.ok(chosen, "Windows 유니코드 cmap 이 없다");
  const covered = new Map();
  if (chosen.format === 12) {
    for (let group = 0; group < buffer.readUInt32BE(chosen.table + 12); group += 1) {
      const at = chosen.table + 16 + group * 12;
      const start = buffer.readUInt32BE(at);
      const end = buffer.readUInt32BE(at + 4);
      const glyph = buffer.readUInt32BE(at + 8);
      for (let cp = start; cp <= end; cp += 1) if (glyph + cp - start !== 0) covered.set(cp, glyph + cp - start);
    }
    return covered;
  }
  const segX2 = buffer.readUInt16BE(chosen.table + 6);
  const endAt = chosen.table + 14;
  const startAt = endAt + segX2 + 2;
  const deltaAt = startAt + segX2;
  const rangeAt = deltaAt + segX2;
  for (let segment = 0; segment < segX2 / 2; segment += 1) {
    const end = buffer.readUInt16BE(endAt + segment * 2);
    const start = buffer.readUInt16BE(startAt + segment * 2);
    const delta = buffer.readInt16BE(deltaAt + segment * 2);
    const rangeOffset = buffer.readUInt16BE(rangeAt + segment * 2);
    for (let cp = start; cp <= end && cp !== 0xffff; cp += 1) {
      let glyph = (cp + delta) & 0xffff;
      if (rangeOffset !== 0) {
        glyph = buffer.readUInt16BE(rangeAt + segment * 2 + rangeOffset + (cp - start) * 2);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph !== 0) covered.set(cp, glyph);
    }
  }
  return covered;
}

const codePoints = (buffer) => new Set(glyphMap(buffer).keys());

/** 한 글자의 가로 진행 폭(글꼴 단위). hhea 의 numberOfHMetrics 뒤 글리프는 마지막 폭을 쓴다. */
function advance(buffer, codePoint) {
  const glyph = glyphMap(buffer).get(codePoint);
  assert.ok(glyph !== undefined, `U+${codePoint.toString(16)} 이 없다`);
  const { hhea, hmtx } = tables(buffer);
  const metrics = buffer.readUInt16BE(hhea.offset + 34);
  return buffer.readUInt16BE(hmtx.offset + Math.min(glyph, metrics - 1) * 4);
}

function windowsNames(buffer) {
  const { offset } = tables(buffer).name;
  const storage = offset + buffer.readUInt16BE(offset + 4);
  const names = new Map();
  for (let index = 0; index < buffer.readUInt16BE(offset + 2); index += 1) {
    const at = offset + 6 + index * 12;
    if (buffer.readUInt16BE(at) !== 3) continue;
    const start = storage + buffer.readUInt16BE(at + 10);
    const bytes = Buffer.from(buffer.subarray(start, start + buffer.readUInt16BE(at + 8)));
    names.set(buffer.readUInt16BE(at + 6), bytes.swap16().toString("utf16le"));
  }
  return names;
}

const load = (folder, file) => readFileSync(fontsDir(`${folder}/${file}`));
const hangul = (points) => [...points].filter((cp) => cp >= 0xac00 && cp <= 0xd7a3);

/** KS X 1001 의 한글 2,350자 = EUC-KR 두 바이트 B0A1..C8FE. */
const KSX1001 = (() => {
  const decoder = new TextDecoder("euc-kr");
  const out = new Set();
  for (let lead = 0xb0; lead <= 0xc8; lead += 1) {
    for (let trail = 0xa1; trail <= 0xfe; trail += 1) out.add(decoder.decode(Uint8Array.of(lead, trail)).codePointAt(0));
  }
  return out;
})();

const SCREEN_SOURCES = [
  ...["copy.ts", "exampleCouple.ts", "journey.ts", "invitationFacts.ts"]
    .map((name) => `../../../../packages/shared/src/invitation/${name}`),
  ...["InvitationStart", "InvitationHome", "InvitationFirstChat", "InvitationJourney", "InvitationCompare",
    "InvitationLetterSheet", "InvitationConsultation", "InvitationCard", "InvitationTabBar", "ExampleCouple"]
    .map((name) => `../components/invitation/${name}.tsx`),
];

/**
 * 청첩장 화면이 그릴 수 있는 고정 글자 전부: `@hanbang/shared/invitation` 의 문자열 조각(문구·예시 커플·
 * 준비 순서)과 화면 파일 안의 문자열·JSX 글자. 화면 글자는 공유 모듈에서 오지만, 누가 화면에 글자를
 * 직접 적어도 이 검사가 그 글자까지 본다. 주석은 문자열이 아니라 세지 않는다.
 */
function screenText() {
  const parts = [];
  for (const relative of SCREEN_SOURCES) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    const kind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const tree = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, kind);
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
        || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) parts.push(node.text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  return parts.join("\n");
}

test("the nine invitation faces are TrueType subsets that keep their OFL records", () => {
  for (const [folder, files] of Object.entries(FACES)) {
    const licence = readFileSync(fontsDir(`${folder}/OFL.txt`), "utf8");
    assert.match(licence, /^Copyright /u, `${folder}/OFL.txt`);
    assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/u, `${folder}/OFL.txt`);
    assert.ok(existsSync(fontsDir(`${folder}/README.md`)), `${folder}/README.md 에 출처와 서브셋 범위를 적는다`);
    for (const file of files) {
      const buffer = load(folder, file);
      assert.equal(buffer.readUInt32BE(0), 0x00010000, `${file} 은 TrueType 이어야 한다`);
      const names = windowsNames(buffer);
      assert.match(names.get(0) ?? "", /Copyright|\(c\)/iu, `${file}: 저작권 기록`);
      assert.match(names.get(13) ?? "", /SIL Open Font License, Version 1\.1/u, `${file}: 라이선스 기록`);
    }
  }
});

test("Noto Sans KR keeps every modern Hangul syllable and Gowun Batang keeps exactly KS X 1001", () => {
  assert.equal(KSX1001.size, 2350);
  for (const file of FACES["noto-sans-kr"]) {
    assert.equal(hangul(codePoints(load("noto-sans-kr", file))).length, 11172, file);
  }
  for (const file of FACES["gowun-batang"]) {
    const syllables = hangul(codePoints(load("gowun-batang", file)));
    assert.equal(syllables.length, 2350, file);
    assert.ok(syllables.every((cp) => KSX1001.has(cp)), `${file}: KS X 1001 밖의 음절이 있다`);
  }
});

test("every fixed character the invitation screens draw is in the Korean faces", () => {
  const text = screenText();
  assert.ok(text.includes("청첩장을 보내는 날까지,"), "공유 문구를 못 읽었다");
  const needed = new Set([...text].filter((ch) => !/\s/u.test(ch)).map((ch) => ch.codePointAt(0)));
  assert.ok(needed.size > 300, `문구 글자가 ${needed.size}자뿐이다`);
  for (const [folder, files] of [["noto-sans-kr", FACES["noto-sans-kr"]], ["gowun-batang", FACES["gowun-batang"]]]) {
    for (const file of files) {
      const covered = codePoints(load(folder, file));
      const missing = [...needed].filter((cp) => !covered.has(cp)).map((cp) => String.fromCodePoint(cp));
      assert.deepEqual(missing, [], `${file} 에 없는 글자`);
    }
  }
});

test("Cormorant Garamond draws the numerals, dates and wordmark", () => {
  const needed = [..."0123456789.,_ amoraAMORA"].map((ch) => ch.codePointAt(0));
  for (const file of FACES["cormorant-garamond"]) {
    const covered = codePoints(load("cormorant-garamond", file));
    assert.deepEqual(needed.filter((cp) => !covered.has(cp)), [], file);
  }
});

test("the subsets stay inside the size budget that justified them", () => {
  const sizes = Object.entries(FACES).flatMap(([folder, files]) => files.map((file) => statSync(fontsDir(`${folder}/${file}`)).size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  // 원본 아홉 면은 37,330,244 바이트다. 원본을 다시 넣거나 범위를 넓히면 여기서 걸린다.
  assert.ok(total <= 11_000_000, `청첩장 글꼴 합계 ${total} 바이트`);
  for (const file of FACES["noto-sans-kr"]) assert.ok(statSync(fontsDir(`noto-sans-kr/${file}`)).size < 3_000_000, file);
  for (const file of FACES["gowun-batang"]) assert.ok(statSync(fontsDir(`gowun-batang/${file}`)).size < 2_000_000, file);
  for (const file of FACES["cormorant-garamond"]) assert.ok(statSync(fontsDir(`cormorant-garamond/${file}`)).size < 100_000, file);
});

test("Noto Sans KR spaces are as wide as the web font the artifact was drawn with", () => {
  // Google Fonts 가 브라우저에 주는 Noto Sans KR(v40 웹 조각)의 공백은 280 단위, 정적 TTF 는 224 단위다.
  // 224 로 두자 17px 본문에서 낱말 사이가 1px 좁아 아티팩트와 다른 음절에서 줄이 바뀌었다(2026-11-17 리드 캡처).
  for (const file of FACES["noto-sans-kr"]) {
    const buffer = load("noto-sans-kr", file);
    assert.equal(advance(buffer, 0x20), 280, `${file} 공백`);
    assert.equal(advance(buffer, 0xa0), 280, `${file} 줄바꿈 없는 공백`);
    assert.equal(advance(buffer, "가".codePointAt(0)), 920, `${file} 한글 폭은 그대로`);
  }
});
