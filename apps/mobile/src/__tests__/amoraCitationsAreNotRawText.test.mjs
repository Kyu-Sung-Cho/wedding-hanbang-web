// 예절 안내 표식이 사용자에게 **글자 그대로** 보이면 안 된다.
//
// 2026-08-22 스테이징 실측: "축의금 보통 얼마 내?" 에 아모라가 정확히 답하고 끝에
// `[etiquette:9]` 를 붙였다. 웹은 그 태그를 안내 카드로 바꾸는데 모바일은 `{item.content}`
// 를 그대로 그려서 사용자가 `[etiquette:9]` 를 읽는다. 더 읽을 곳을 가리키려고 만든 표식이
// 깨진 텍스트로 보이는 것이고, 모바일이 소비자의 주 제품이라 이쪽이 더 나쁘다.
//
// 2026-09-18(wave 2 · 2.7): 표식은 "근거"가 아니라 "더 읽을 곳"이다(프롬프트·웹 테스트가 못 박았다).
// 앱은 "결혼 예절 안내를 근거로 했어요" 라는 사실이 아닌 말을 그리고 있었다. 이제 웹처럼 편 카드로 바꾼다.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

import {
  parseAmoraCitations,
  resolveAmoraMannersLinks,
} from "../lib/amoraCitations.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const chat = readFileSync(join(here, "../../app/(tabs)/chat.tsx"), "utf8");
const card = readFileSync(join(here, "../components/chat/AmoraMannersLinks.tsx"), "utf8");
const citations = readFileSync(join(here, "../lib/amoraCitations.mjs"), "utf8");

test("실제로 받은 답변에서 태그가 사라지고 편 번호만 남는다", () => {
  const live =
    "친구 축의금은 정해진 정답이나 법정 기준이 없어요. 가까운 친구들이 실제로 내는"
    + " 금액대를 먼저 확인하고 그 흐름에 맞추는 것이 가장 무난해요. [etiquette:9]";
  const { text, parts } = parseAmoraCitations(live);
  assert.doesNotMatch(text, /etiquette/i, "표식이 본문에 남았다");
  assert.doesNotMatch(text, /\[\s*\]/u, "빈 대괄호가 남았다");
  assert.deepEqual(parts, [9]);
  assert.ok(text.endsWith("가장 무난해요."), `꼬리 공백이 남았다: ${JSON.stringify(text.slice(-24))}`);
});

test("여러 편을 가리키면 중복 없이 모은다", () => {
  const { text, parts } = parseAmoraCitations(
    "상견례는 집안마다 달라요. [etiquette:2] 인사 순서도 마찬가지예요. [etiquette:2][etiquette:7]",
  );
  assert.doesNotMatch(text, /etiquette/i);
  assert.deepEqual(parts, [2, 7]);
});

test("모양이 조금 달라도 새지 않는다", () => {
  // 표식이 정확 일치로만 잡히면 공백 하나에 원문이 샌다 — 같은 실수를 아모라의
  // pending_action 표식에서 이미 한 번 했다.
  for (const raw of [
    "본문 [ etiquette : 3 ]",
    "본문 [etiquette: 3]",
    "본문 [ETIQUETTE:3]",
  ]) {
    const { text, parts } = parseAmoraCitations(raw);
    assert.doesNotMatch(text, /etiquette/i, `새어 나왔다: ${raw}`);
    assert.deepEqual(parts, [3], raw);
  }
});

test("번호 뒤에 제목이 붙어 와도 새지 않는다", () => {
  // 프롬프트는 `[etiquette:번호]` 만 쓰라고 하지만 모델은 지키지 않는다.
  // 운영 실측(2026-08-26): 표식이 든 assistant 메시지 23건 중 **6건**이 이 형태였다.
  // 웹은 이미 받도록 고쳐져 있었는데(`ChatBubble.tsx:370`) 모바일만 아니어서,
  // 걷어내려고 만든 이 함수를 통과해 사용자 화면에 그대로 남았다.
  const live = [
    ["예약 전에는 룸 여부를 확인하세요. [etiquette:2:상견례]", 2],
    ["청첩장은 보통 이렇게 해요. [etiquette:4:청첩장]", 4],
    ["혼수는 집안마다 달라요. [etiquette:8:혼수]", 8],
    ["예물·예단함은 생략하는 집도 많아요. [etiquette:3:예물예단함]", 3],
  ];
  for (const [raw, part] of live) {
    const { text, parts } = parseAmoraCitations(raw);
    assert.doesNotMatch(text, /etiquette/i, `새어 나왔다: ${raw}`);
    assert.doesNotMatch(text, /\[|\]/u, `대괄호가 남았다: ${JSON.stringify(text)}`);
    assert.deepEqual(parts, [part], raw);
  }
});

test("제목이 비어 있거나 공백이 섞여도 새지 않는다", () => {
  for (const raw of [
    "본문 [etiquette:5:]",
    "본문 [ etiquette : 5 : 축의금 ]",
    "본문 [ETIQUETTE:5:축의금]",
  ]) {
    const { text, parts } = parseAmoraCitations(raw);
    assert.doesNotMatch(text, /etiquette/i, `새어 나왔다: ${raw}`);
    assert.deepEqual(parts, [5], raw);
  }
});

test("웹이 걷어내는 형태는 모바일도 걷어낸다", () => {
  // 한쪽만 고치는 것이 이 저장소의 반복된 실수다. 같은 답변이 두 화면에서 다르게
  // 보이면 안 된다. 정규식 문자열끼리 대조하면 표현만 바뀌어도 깨지므로, **같은
  // 문장을 둘 다 실제로 지우는지** 로 잰다.
  const web = readFileSync(
    join(here, "../../../web/src/components/app/chat/ChatBubble.tsx"),
    "utf8",
  );
  // 정규식 리터럴을 통째로 집는다. 안에 `\[` 처럼 이스케이프가 들어 있으므로
  // 백슬래시 뒤 한 글자는 무조건 본문으로 삼아야 한다 — 처음엔 그걸 빼먹어서
  // 이 대조가 "웹 정규식을 못 찾았다" 로 죽었다.
  const found = web.match(/replace\(\s*\/((?:[^/\\\n]|\\.)*etiquette(?:[^/\\\n]|\\.)*)\/([gimsuy]*)/u);
  assert.ok(found, "웹의 표식 정규식을 찾지 못했다 — 이 대조가 조용히 무의미해졌다");

  const webRe = new RegExp(found[1], found[2].includes("g") ? found[2] : `${found[2]}g`);

  for (const raw of [
    "예약 전에는 룸 여부를 확인하세요. [etiquette:2:상견례]",
    "축의금은 보통 이렇습니다. [etiquette:9]",
    "예물·예단함은 생략하는 집도 많아요. [etiquette:3:예물예단함]",
  ]) {
    webRe.lastIndex = 0;
    assert.doesNotMatch(raw.replace(webRe, ""), /etiquette/i, `웹이 못 지웠다: ${raw}`);
    assert.doesNotMatch(parseAmoraCitations(raw).text, /etiquette/i, `모바일이 못 지웠다: ${raw}`);
  }
});

test("안내에 없는 번호는 링크로 세지 않는다", () => {
  const { text, parts } = parseAmoraCitations("본문 [etiquette:0] [etiquette:26] [etiquette:99]");
  assert.doesNotMatch(text, /etiquette/i, "범위를 벗어나도 본문에 남기지 않는다");
  assert.deepEqual(parts, []);
});

test("표식이 없는 답변은 한 글자도 바뀌지 않는다", () => {
  const plain = "예식장 계약 전에 확인할 것들을 정리해 드릴게요.";
  assert.equal(parseAmoraCitations(plain).text, plain);
  assert.deepEqual(parseAmoraCitations(plain).parts, []);
});

const titles = (content) => resolveAmoraMannersLinks(parseAmoraCitations(content).parts).map((link) => link.title);

test("번호는 웹과 같은 편 카드가 된다 — 제목·부제·slug", () => {
  const links = resolveAmoraMannersLinks(parseAmoraCitations("…가장 무난해요. [etiquette:9]").parts);
  assert.deepEqual(links, [{ number: 9, slug: "gift-money", title: "축의금", subtitle: "형편에 맞게 마음을 전하고 기록하기" }]);
});

test("처음 나온 순서대로, 같은 편은 한 번만 카드가 된다", () => {
  assert.deepEqual(titles("가 [etiquette:1] 나 [etiquette:2] 다 [etiquette:1]"), ["첫인사 예절", "상견례 예절"]);
  assert.deepEqual(titles("예약 전에는 룸 여부를 확인하세요. [etiquette:2:상견례]"), ["상견례 예절"]);
  // 파서를 거치지 않고 번호를 바로 넘겨도 같은 편은 한 번이다.
  assert.deepEqual(resolveAmoraMannersLinks([1, 2, 1]).map((link) => link.title), ["첫인사 예절", "상견례 예절"]);
});

test("안내에 없는 번호는 카드도, 남는 태그도 만들지 않는다", () => {
  const { text, parts } = parseAmoraCitations("본문 [etiquette:0] [etiquette:26] [etiquette:99]");
  assert.equal(text, "본문");
  assert.deepEqual(resolveAmoraMannersLinks(parts), []);
  assert.deepEqual(resolveAmoraMannersLinks([0, 26, 9.5, "9", null]), []);
  assert.deepEqual(resolveAmoraMannersLinks(null), []);
});

test("카드는 앱 안 웹 화면으로 그 편을 연다 — /wedding/manners/<slug>, 사이트 주소 헬퍼로", () => {
  for (const fragment of [
    "buildMobileSiteUrl(`/wedding/manners/${slug}`, siteOrigin)",
    "`/webview?url=${encodeURIComponent(",
    'accessibilityRole="link"',
    "accessibilityLabel={`${link.title} 예절 안내 열기`}",
    "minHeight: 44",
  ]) {
    assert.ok(card.includes(fragment), `카드에 ${fragment} 가 없다`);
  }
  assert.ok(!card.includes("API_BASE") && !card.includes("hanbang.ai"), "사이트 주소를 하드코딩하거나 폴백하지 않는다");
});

/** 소스에서 따옴표·백틱 문자열만 모은다(주석 줄은 뺀다). 화면에 나갈 수 있는 글을 보기 위해서다. */
function quotedStrings(source) {
  const code = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/u.test(line)).join("\n");
  return [...code.matchAll(/"([^"\n]*)"|`([^`]*)`/gu)].map((m) => m[1] ?? m[2]).join("\n");
}

test("카드와 표식 모듈은 예절 안내를 근거·출처로 부르지 않는다", () => {
  assert.doesNotMatch(quotedStrings(card), /근거|출처|기반/u);
  assert.doesNotMatch(quotedStrings(citations), /근거|출처|기반/u);
});

test("앱 어디에도 「근거로 했어요」 문구와 옛 함수가 없다", () => {
  const root = join(here, "../..");
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs|mts)$/u.test(entry)) files.push(full);
    }
  };
  walk(join(root, "app"));
  walk(join(root, "src"));
  assert.ok(files.length > 50, "훑은 파일이 너무 적다 — 경로가 틀렸다");
  const hits = files.filter((file) => /근거로 했어요|describeAmoraCitations/u.test(readFileSync(file, "utf8")));
  assert.deepEqual(hits.map((file) => file.slice(root.length)), []);
});

test("채팅 화면이 본문을 그대로 그리지 않고, 아모라 답에만 편 카드를 붙인다", () => {
  assert.ok(chat.includes("parseAmoraCitations"), "화면이 파서를 쓰지 않는다");
  assert.ok(chat.includes("const mannersLinks = isAi ? resolveAmoraMannersLinks(citation.parts) : [];"), "사람 메시지에도 카드를 붙인다");
  assert.ok(chat.includes("<AmoraMannersLinks links={mannersLinks} siteOrigin={amoraSiteOrigin} />"), "카드를 그리지 않는다");
  // 사람이 쓴 메시지는 파싱하지 않는다 — 대괄호를 직접 쓴 것을 지우거나 카드로 바꾸지 않는다.
  assert.ok(chat.includes(": { text: item.content, parts: [] as number[] };"), "사람 메시지를 파싱한다");
});
