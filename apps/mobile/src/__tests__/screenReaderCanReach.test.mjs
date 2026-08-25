// 스크린리더로 닿을 수 있는지 본다.
//
// 이 저장소는 같은 방식으로 한 번 데였다 — 부모에 접근성 이름이 붙어 있어서 자식
// 승인 버튼이 통째로 삼켜졌고, VoiceOver 로는 승인을 누를 수 없었다.
//
// 두 가지를 본다.
//   1. 이름을 가진 Pressable 안에 또 다른 Pressable 을 넣지 않는다(안쪽이 삼켜진다).
//   2. 아이콘만 든 버튼에는 이름을 준다(글자가 있으면 그 글자가 이름이 된다).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

const MOBILE = resolve(fileURLToPath(new URL("../../", import.meta.url)));
const SKIP = new Set(["__tests__", "node_modules", ".expo", "dist", "assets"]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".tsx") && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

const FILES = [...walk(join(MOBILE, "app")), ...walk(join(MOBILE, "src"))];
const show = (file) => relative(MOBILE, file).split("\\").join("/");

/**
 * 여는 태그의 끝(`>`)을 손으로 찾는다.
 *
 * 정규식 `<Pressable\b([\s\S]*?)>` 는 속성값 안의 `>` 나 중괄호 안의 화살표 함수에서
 * 먼저 멈춘다. 그래서 이름이 붙은 버튼을 이름 없는 것으로 잘못 읽었다. 실제로
 * 그렇게 아홉 곳을 틀리게 잡았다.
 */
function openTagEnd(source, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < source.length; i += 1) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === ">" && depth === 0) return i;
  }
  return -1;
}

/** `<Pressable …>` 하나하나를 태그 단위로 넘겨준다. 자기 닫힘 태그는 body 가 빈 문자열이다. */
function eachPressable(source, visit) {
  const OPEN = /<Pressable\b/g;
  let open;
  while ((open = OPEN.exec(source)) !== null) {
    const end = openTagEnd(source, open.index + "<Pressable".length);
    if (end === -1) break;
    const attrs = source.slice(open.index, end);
    if (attrs.trimEnd().endsWith("/")) {
      // 자기 닫힘 — 자식이 없으니 삼킬 것도 없다. 뒤쪽 `</Pressable>` 을 삼키지 않도록
      // 반드시 여기서 끊는다. 이걸 안 해서 거짓 양성이 한 번 났다.
      visit({ attrs, body: "", index: open.index });
      continue;
    }
    // 짝이 맞는 `</Pressable>` 을 찾는다.
    let cursor = end + 1;
    let nest = 1;
    while (cursor < source.length && nest > 0) {
      const nextOpen = source.indexOf("<Pressable", cursor);
      const nextClose = source.indexOf("</Pressable>", cursor);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        const innerEnd = openTagEnd(source, nextOpen + "<Pressable".length);
        if (innerEnd === -1) break;
        if (!source.slice(nextOpen, innerEnd).trimEnd().endsWith("/")) nest += 1;
        cursor = innerEnd + 1;
        continue;
      }
      nest -= 1;
      if (nest === 0) visit({ attrs, body: source.slice(end + 1, nextClose), index: open.index });
      cursor = nextClose + "</Pressable>".length;
    }
  }
}

const lineOf = (source, index) => source.slice(0, index).split("\n").length;
const hasName = (attrs) =>
  attrs.includes("accessibilityLabel") || attrs.includes("accessibilityRole");

test("검사가 실제로 파일을 읽는다", () => {
  assert.ok(FILES.length > 60, `훑은 파일이 ${FILES.length}개뿐이다`);
  let seen = 0;
  for (const file of FILES) eachPressable(readFileSync(file, "utf8"), () => { seen += 1; });
  assert.ok(seen > 100, `Pressable 을 ${seen}개밖에 못 찾았다 — 판별식이 낡았다`);
});

test("판별식이 실제로 그 모양을 잡는다", () => {
  // 정규식이 낡아 아무것도 못 잡으면서 초록불을 주는 일이 이 저장소에 있었다.
  const found = [];
  eachPressable(
    `<Pressable accessibilityLabel="바깥"><Pressable onPress={x}><X /></Pressable></Pressable>`,
    (p) => found.push(p),
  );
  assert.equal(found.length, 2, "중첩 두 개를 다 못 봤다");
  assert.ok(found.some((p) => hasName(p.attrs) && p.body.includes("<Pressable")), "삼킴을 못 잡는다");

  // 자기 닫힘 태그가 뒤쪽 닫는 태그를 삼키면 안 된다.
  const selfClosing = [];
  eachPressable(
    `<Pressable accessibilityLabel="가" onPress={() => a > b} />\n<Pressable onPress={y}><Send /></Pressable>`,
    (p) => selfClosing.push(p),
  );
  assert.equal(selfClosing.length, 2);
  assert.equal(selfClosing[0].body, "", "자기 닫힘인데 자식이 있다고 읽었다");

  // 속성값 안의 `>` 에서 멈추면 안 된다.
  const tricky = [];
  eachPressable(`<Pressable onPress={() => go()} accessibilityLabel="보내기"><Send /></Pressable>`, (p) => tricky.push(p));
  assert.ok(hasName(tricky[0].attrs), "화살표 함수 뒤의 속성을 놓쳤다");
});

test("아이콘만 든 버튼에는 스크린리더가 읽을 이름이 있다", () => {
  const ICON = /<(Send|ThumbsUp|ChevronUp|ArrowUp|MessageCircle|Heart|Bookmark|Share2|MoreHorizontal|Trash2|Pencil|X)\b/;
  const offenders = [];
  for (const file of FILES) {
    const source = readFileSync(file, "utf8");
    eachPressable(source, ({ attrs, body, index }) => {
      if (attrs.includes("accessibilityLabel")) return;
      if (body.includes("<Text") || body.includes("AppText")) return;
      if (!ICON.test(body)) return;
      offenders.push(`${show(file)}:${lineOf(source, index)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `아이콘만 있는 버튼에 이름이 없다 — 스크린리더는 "버튼" 이라고만 읽는다:\n  ${offenders.join("\n  ")}`,
  );
});

test("이름을 가진 Pressable 이 다른 Pressable 을 삼키지 않는다", () => {
  const offenders = [];
  for (const file of FILES) {
    const source = readFileSync(file, "utf8");
    eachPressable(source, ({ attrs, body, index }) => {
      if (!hasName(attrs)) return;
      if (!body.includes("<Pressable")) return;
      offenders.push(`${show(file)}:${lineOf(source, index)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `이름을 가진 버튼 안에 또 버튼이 있다 — 안쪽은 스크린리더로 못 누른다:\n  ${offenders.join("\n  ")}`,
  );
});
