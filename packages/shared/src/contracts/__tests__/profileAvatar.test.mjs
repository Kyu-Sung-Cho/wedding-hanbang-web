import assert from "node:assert/strict";
import test from "node:test";
import {
  getProfileInitial,
  isProfileAvatarEmoji,
  PROFILE_AVATAR_EMOJIS,
} from "../profileAvatar.mjs";

const cases = [
  ["김서연", "김"],
  ["김서연", "김"],
  ["ᄀ각준비", "ᄀ각".normalize("NFC")],
  ["  두부랑  ", "두"],
  ["emily", "E"],
  ["e\u0301milie", "É"],
  ["a\u0308\u0301lex", "Ä\u0301"],
  ["ｶﾞﾄ", "ｶﾞ"],
  ["ß봄", "S"],
  ["ﬃrst", "F"],
  ["💍예신", "💍"],
  ["👩🏽‍💻준비", "👩🏽‍💻"],
  ["👨‍👩‍👧‍👦가족", "👨‍👩‍👧‍👦"],
  ["👩‍❤️‍💋‍👩커플", "👩‍❤️‍💋‍👩"],
  ["☀️햇살", "☀️"],
  ["1️⃣준비", "1️⃣"],
  ["🇰🇷커플", "🇰🇷"],
  ["🇰🇷🇯🇵모임", "🇰🇷"],
  ["🇰준비", "🇰"],
  ["🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}준비", "🏴\u{e0067}\u{e0062}\u{e0065}\u{e006e}\u{e0067}\u{e007f}"],
  ["\u0000\r\n\t\u202e\u200b 김서연", "김"],
  ["\u200d두부", "두"],
  ["\ufe0f두부", "두"],
  ["\u200d\ufe0f", "?"],
  ["\ud83d두부", "두"],
  ["\udc00두부", "두"],
  ["\u200d\u200c", "?"],
  ["\u{e0067}\u{e007f}", "?"],
  ["\u0000\u202e\u200b\ufeff", "?"],
  ["", "?"],
  ["  \n  ", "?"],
  [null, "?"],
  [undefined, "?"],
  [123, "?"],
];

function assertInitials() {
  for (const [name, expected] of cases) {
    const result = getProfileInitial(name);
    assert.equal(result, expected, JSON.stringify(name));
    assert.doesNotMatch(result, /\p{Cs}/u, "unpaired UTF-16 surrogate escaped into an avatar");
  }
}

function withSegmenter(Segmenter, callback) {
  const descriptor = Object.getOwnPropertyDescriptor(Intl, "Segmenter");
  Object.defineProperty(Intl, "Segmenter", { configurable: true, writable: true, value: Segmenter });
  try {
    callback();
  } finally {
    Object.defineProperty(Intl, "Segmenter", descriptor);
  }
}

test("이름은 NFC로 정리된 첫 표시 글자 한 개이며 대문자 확장도 한 개로 제한된다", () => {
  assertInitials();
  const oracle = new Intl.Segmenter("ko", { granularity: "grapheme" });
  for (const [name] of cases) {
    assert.equal([...oracle.segment(getProfileInitial(name))].length, 1);
  }
});

test("Segmenter 없는 런타임도 한글·악센트·ZWJ·피부색·국기·keycap·tag를 보존한다", () => {
  withSegmenter(undefined, assertInitials);
});

test("Intl 자체가 없거나 Segmenter 생성이 실패해도 이름 표시를 중단하지 않는다", () => {
  const original = globalThis.Intl;
  try {
    globalThis.Intl = undefined;
    assertInitials();
  } finally {
    globalThis.Intl = original;
  }
  withSegmenter(class { constructor() { throw new Error("unsupported"); } }, assertInitials);
});

test("fallback은 연속된 이모지·국기를 한 아바타에 합치지 않는다", () => {
  const examples = [["🌿🌸", "🌿"], ["👩🏽‍💻👩🏽‍💻", "👩🏽‍💻"], ["🇰🇷🇺🇸", "🇰🇷"], ["A‍B", "A‍"]];
  withSegmenter(undefined, () => {
    for (const [name, expected] of examples) assert.equal(getProfileInitial(name), expected);
  });
});

test("사진 URL과 이름은 프리셋 이모지 허용 검사와 분리되며 기존 여섯 선택값을 보존한다", () => {
  for (const { emoji, label } of PROFILE_AVATAR_EMOJIS) {
    assert.equal(isProfileAvatarEmoji(emoji), true);
    assert.ok(label.trim());
  }
  for (const emoji of ["🌿", "💍", "🌸", "🤍", "✨", "👑"]) assert.equal(isProfileAvatarEmoji(emoji), true);
  for (const value of ["1", "#", "1a", "🌷문자", " 🌷", "🌷🌷", "👩🏽‍💻", "https://example.invalid/avatar.png", "/avatar.png", "data:image/svg+xml,test", "", null, undefined, {}, 1]) {
    assert.equal(isProfileAvatarEmoji(value), false, String(value));
  }
  assert.equal(new Set(PROFILE_AVATAR_EMOJIS.map(({ emoji }) => emoji)).size, PROFILE_AVATAR_EMOJIS.length);
});
