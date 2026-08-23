import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

const helperPath = fileURLToPath(new URL("../publicPostPrivacy.ts", import.meta.url));
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
const { findPublicPostContactDetails, describePublicPostContactWarning } = module.exports;

const found = (text) => findPublicPostContactDetails(text);

test("본인 연락처를 알아본다", () => {
  const cases = [
    ["010-1234-5678로 연락 주세요", "phone"],
    ["01012345678 입니다", "phone"],
    ["010 1234 5678", "phone"],
    ["카톡 아이디 wedding2026 입니다", "kakao"],
    ["카톡 bride_kim_26 으로 주세요", "kakao"],
    ["https://open.kakao.com/o/abcd1234", "kakao"],
    ["아이디: wedding_bride_2026", "kakao"],
    ["mail@example.com 으로 보내주세요", "email"],
  ];
  for (const [text, kind] of cases) {
    assert.ok(found(text).includes(kind), `못 잡았습니다: ${text}`);
  }
});

// 여기가 이 검사의 핵심이다. 넣을 낱말을 **겨냥해서** 만든 평범한 결혼 글이다.
// 여기가 걸리면 어휘가 잘못됐고, 사용자는 매번 뜨는 경고를 무시하게 된다.
test("평범한 결혼 글은 걸리지 않는다", () => {
  const ordinary = [
    "예식일은 2026.10.10 이에요",
    "총예산 3,010,000원 정도로 잡았어요",
    "하객 010명 예상이라고 적었다가 고쳤어요",
    "스드메 견적이 2,010,000원 나왔어요",
    "청첩장 010번째 장까지 인쇄했어요",
    "결혼식장 대관료가 10,100,000원이래요",
    "웨딩홀 계약금 1,010,000원 냈어요",
    "신랑이 아이디어를 많이 냈어요",
    "드레스 아이디 어쩌고 하는 브랜드가 있대요",
    "예단은 생략하기로 했어요. 양가 모두 동의하셨어요",
    "상견례 장소는 강남역 근처로 정했어요",
    "축가는 친구가 불러주기로 했어요",
  ];
  for (const text of ordinary) {
    assert.deepEqual(found(text), [], `평범한 글이 걸렸습니다: ${text}`);
  }
});

test("카톡을 말하기만 한 글은 잡지 않는다", () => {
  // 처음 만든 정규식은 언급만으로 걸렸다. 한국 결혼 커뮤니티는 카톡을 매 글에서
  // 말하므로, 그러면 경고가 늘 떠서 사용자가 무시하게 된다.
  // 아래 문장들에는 공개된 연락처가 **없다.**
  const mentionsOnly = [
    "카톡 아이디 물어봤는데 안 알려주더라고요",
    "업체가 카톡으로 문의하라고 해서 했어요",
    "카카오톡 상담 링크가 홈페이지에 있어요",
    "오픈채팅방 분위기가 좋더라고요",
    "카톡 아이디 알려드릴게요",
    "아이디: 아직 안 정했어요",
  ];
  for (const text of mentionsOnly) {
    assert.deepEqual(found(text), [], `언급만인데 걸렸습니다: ${text}`);
  }
});

test("업체 유선번호는 일부러 잡지 않는다", () => {
  // 업체 대표번호 공유는 이 커뮤니티가 하라고 있는 일에 가깝다.
  for (const text of ["02-1234-5678 로 예약했어요", "031-123-4567 이라고 적혀 있었어요"]) {
    assert.deepEqual(found(text), [], `업체 번호가 걸렸습니다: ${text}`);
  }
});

test("숫자에 파묻힌 010 은 전화번호가 아니다", () => {
  // \b 를 쓰면 `3,010,000` 을 문다. 숫자 경계를 직접 봐야 한다.
  assert.deepEqual(found("계좌 12301012345678 로 입금했어요"), []);
  assert.deepEqual(found("주문번호 0101234567890"), []);
});

test("제목과 본문을 한 번에 본다", () => {
  const kinds = findPublicPostContactDetails("스드메 후기", "궁금하면 010-1234-5678");
  assert.deepEqual(kinds, ["phone"]);
});

test("여러 종류가 있으면 모두 알린다", () => {
  const kinds = found("010-1234-5678 또는 mail@example.com 으로 주세요");
  assert.deepEqual(kinds.sort(), ["email", "phone"]);
});

test("빈 값에도 던지지 않는다", () => {
  assert.deepEqual(findPublicPostContactDetails(), []);
  assert.deepEqual(findPublicPostContactDetails(null, undefined, "   "), []);
});

test("경고문은 무엇이 들었는지 말하고 결정을 넘긴다", () => {
  const message = describePublicPostContactWarning(["phone", "kakao"]);
  assert.match(message, /전화번호/u);
  assert.match(message, /카카오톡 아이디/u);
  // 공개 범위를 먼저 알린다.
  assert.match(message, /로그인하지 않아도 볼 수 있어요/u);
  // 막지 않는다 — 사용자가 정한다.
  assert.match(message, /그대로 올릴까요\?/u);
  assert.equal(describePublicPostContactWarning([]), null);
});
