/**
 * 라운지가 저장된 한글을 `?? ???` 로 보여주던 것에 대한 계약.
 *
 * 되살릴 수 있는 것만 되살리고, 멀쩡한 글은 절대 건드리지 않으며, 이미 없어진
 * 글자를 되살린 척하지 않는다.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../textEncodingRepair.ts", import.meta.url));
const compiled = ts.transpileModule(readFileSync(helperPath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const module = { exports: {} };
new Function("exports", "module", "require", compiled.outputText)(
  module.exports,
  module,
  () => {
    throw new Error("unexpected dependency");
  },
);
const {
  repairMojibake,
  repairMojibakeDeep,
  hasIrrecoverableTextCorruption,
  isUnreadableText,
  recoverUserText,
} = module.exports;

/** UTF-8 바이트를 Latin-1 로 잘못 읽었을 때 실제로 나오는 문자열을 만든다. */
function misreadAsLatin1(text) {
  const bytes = Buffer.from(text, "utf8");
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

test("UTF-8 을 Latin-1 로 읽어 깨진 한글을 글자 그대로 되살린다", () => {
  for (const original of [
    "드레스 매장 방문",
    "본식 스냅 계약",
    "양가 상견례",
    "스튜디오 촬영 · 2차 미팅",
    "예산 확인(홀 대관료)",
  ]) {
    const broken = misreadAsLatin1(original);
    assert.notEqual(broken, original, "테스트 재료가 실제로 깨지지 않았습니다");
    assert.equal(repairMojibake(broken), original);
  }
});

test("두 겹으로 깨진 것도 되살린다", () => {
  const original = "청첩장 발송";
  const twiceBroken = misreadAsLatin1(misreadAsLatin1(original));
  assert.equal(repairMojibake(twiceBroken), original);
});

test("멀쩡한 글은 한 글자도 바꾸지 않는다", () => {
  for (const intact of [
    "드레스 매장 방문",
    "Studio visit",
    "café 미팅",
    "2026-10-05 예약",
    "왜 이걸 두 번 물어봐??",
    "",
    "가격 확인 ?",
  ]) {
    assert.equal(repairMojibake(intact), intact);
  }
});

test("한글이 나오지 않는 변환은 되살리기가 아니므로 거절한다", () => {
  // 라틴 문자만 나오는 문자열은 되돌려도 한글이 안 나온다. 손대지 않는다.
  for (const latin of ["café", "naïve", "Ärger", "Ã©"]) {
    assert.equal(repairMojibake(latin), latin);
  }
});

test("문자열이 아니면 빈 문자열", () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(repairMojibake(value), "");
  }
});

test("이미 없어진 글자는 되살리지 않고 그렇다고 알린다", () => {
  assert.equal(hasIrrecoverableTextCorruption("?? ???"), true);
  assert.equal(hasIrrecoverableTextCorruption("\ufffd\ufffd \ufffd"), true);
  assert.equal(hasIrrecoverableTextCorruption("??"), true);
});

test("사람이 쓴 물음표를 깨짐으로 몰지 않는다", () => {
  assert.equal(hasIrrecoverableTextCorruption("왜 두 번 물어봐??"), false);
  assert.equal(hasIrrecoverableTextCorruption("가격 확인?"), false);
  assert.equal(hasIrrecoverableTextCorruption("Really?"), false);
  assert.equal(hasIrrecoverableTextCorruption(""), false);
  assert.equal(hasIrrecoverableTextCorruption(null), false);
});

test("읽을 글자가 남지 않은 잔해만 제목에서 물러난다", () => {
  assert.equal(isUnreadableText("?? ???"), true);
  assert.equal(isUnreadableText("???"), true);
  assert.equal(isUnreadableText("\ufffd\ufffd \ufffd"), true);
  assert.equal(isUnreadableText("? - ?"), true);
});

test("물음표가 붙었다는 이유로 사람이 쓴 제목을 감추지 않는다", () => {
  assert.equal(isUnreadableText("D-DAY??"), false);
  assert.equal(isUnreadableText("왜 두 번 물어봐??"), false);
  assert.equal(isUnreadableText("드레스 \ufffd 매장"), false);
  assert.equal(isUnreadableText("드레스 매장 방문"), false);
  assert.equal(isUnreadableText("   "), false);
  assert.equal(isUnreadableText(null), false);
});

test("recoverUserText 는 되살림 여부와 읽을 수 없음을 함께 돌려준다", () => {
  const broken = misreadAsLatin1("드레스 매장 방문");
  assert.deepEqual(recoverUserText(broken), {
    text: "드레스 매장 방문",
    repaired: true,
    unreadable: false,
  });

  assert.deepEqual(recoverUserText("드레스 매장 방문"), {
    text: "드레스 매장 방문",
    repaired: false,
    unreadable: false,
  });

  assert.deepEqual(recoverUserText("?? ???"), {
    text: "?? ???",
    repaired: false,
    unreadable: true,
  });
});

test("중첩된 값 안의 문자열도 되돌린다", () => {
  // 채팅 한 줄의 실제 모양. 화면에 나가는 글이 `content` 하나가 아니다.
  const metadata = {
    toolResults: [
      { toolName: "add_schedule_event", displayMessage: misreadAsLatin1("일정을 넣었어요") },
    ],
    pending_amora_action: { confirmation: misreadAsLatin1("예산에 반영할까요?") },
    mediation: { empathy: misreadAsLatin1("두 분 다 지치셨네요"), schemaVersion: 2 },
    imagePaths: ["couple/2026/09/a1b2.png"],
  };

  const repaired = repairMojibakeDeep(metadata);
  assert.equal(repaired.toolResults[0].displayMessage, "일정을 넣었어요");
  assert.equal(repaired.pending_amora_action.confirmation, "예산에 반영할까요?");
  assert.equal(repaired.mediation.empathy, "두 분 다 지치셨네요");

  // 기계가 쓴 값은 손대지 않는다.
  assert.equal(repaired.toolResults[0].toolName, "add_schedule_event");
  assert.equal(repaired.mediation.schemaVersion, 2);
  assert.deepEqual(repaired.imagePaths, ["couple/2026/09/a1b2.png"]);
});

test("바뀐 것이 없으면 받은 참조를 그대로 돌려준다", () => {
  // React 가 같은 객체를 다시 그리지 않으려면 이 성질이 필요하다.
  const intact = { mediation: { empathy: "두 분 다 지치셨네요" }, count: 3 };
  assert.equal(repairMojibakeDeep(intact), intact);

  const list = [{ displayMessage: "일정을 넣었어요" }];
  assert.equal(repairMojibakeDeep(list), list);
});

test("깊게 중첩된 값이 화면 그리기를 멈춰 세우지 않는다", () => {
  // 상한에 닿으면 그 아래는 손대지 않고 그대로 돌려준다 — 값을 버리지 않는다.
  let deep = { text: misreadAsLatin1("맨 아래") };
  for (let level = 0; level < 40; level += 1) deep = { nested: deep };

  const repaired = repairMojibakeDeep(deep);
  let cursor = repaired;
  while (cursor.nested) cursor = cursor.nested;
  assert.equal(typeof cursor.text, "string");
  assert.ok(cursor.text.length > 0, "상한에 닿았다고 값을 잃으면 안 된다");
});

test("평범한 객체가 아닌 것은 열지 않는다", () => {
  const when = new Date("2026-09-02T00:00:00.000Z");
  const payload = { when, title: misreadAsLatin1("드레스") };
  const repaired = repairMojibakeDeep(payload);
  assert.equal(repaired.when, when);
  assert.equal(repaired.title, "드레스");
});

test("문자열이 아닌 것을 넣어도 그대로 나온다", () => {
  for (const value of [null, undefined, 42, true]) {
    assert.equal(repairMojibakeDeep(value), value);
  }
});

test("ASCII 뿐인 문자열은 되돌리기 계산을 아예 하지 않는다", () => {
  // 채팅 기록은 문자열이 수천 개다. 되돌릴 여지가 없는 값이 바이트 변환과 UTF-8
  // 디코딩을 전부 지나면 기록을 여는 것이 느려진다.
  const ascii = "couple/2026/09/a1b2c3d4.png";
  assert.equal(repairMojibake(ascii), ascii);

  const started = process.hrtime.bigint();
  for (let index = 0; index < 20_000; index += 1) repairMojibake(ascii);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(elapsedMs < 500, `ASCII 2만 건에 ${elapsedMs.toFixed(0)}ms 걸렸습니다`);
});

test("되돌리기가 깨진 UTF-8 바이트열을 조용히 통과시키지 않는다", () => {
  // 0xEB 뒤에 이어지는 바이트가 없다. 엄격한 디코더는 실패해야 하고, 실패하면
  // 받은 문자열이 그대로 나와야 한다.
  const truncated = String.fromCharCode(0xeb, 0x93);
  assert.equal(repairMojibake(truncated), truncated);

  // 과잉 인코딩(0xC0 0x80)은 UTF-8 이 아니다.
  const overlong = String.fromCharCode(0xc0, 0x80);
  assert.equal(repairMojibake(overlong), overlong);

  // 서로게이트 값을 UTF-8 로 적은 것(0xED 0xA0 0x80)도 거절한다.
  const surrogate = String.fromCharCode(0xed, 0xa0, 0x80);
  assert.equal(repairMojibake(surrogate), surrogate);
});
