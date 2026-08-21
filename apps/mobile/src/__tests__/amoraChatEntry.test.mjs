// 아모라로 가는 문 네 개 — 목적지가 같아도 들고 가는 것이 달라야 한다.
//
// 라운지에는 아모라로 가는 문이 네 개 있다: 우하단 버튼, 전폭 카드, 첫 도착 카드의 CTA,
// 하단 탭. 예전에는 전부 파라미터 없는 같은 push였고, 대화 화면에는 진입 파라미터를 읽는
// 코드가 아예 없었다. 방금 "이제 막 시작했어요"를 고르고 그 카드를 누른 사람과 무작정 탭을
// 누른 사람이 완전히 같은 빈 화면을 만났다는 뜻이다.
//
// 이 파일이 지키는 것은 문구가 아니라 **문마다 다른 것을 들고 간다**는 사실과,
// 그 값이 실제로 입력창까지 도착한다는 배선이다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

function readSource(relativePath) {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

function compileCommonJs(source) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function("exports", "module", "require", result.outputText)(
    module.exports,
    module,
    () => {
      throw new Error("unexpected dependency");
    },
  );
  return module.exports;
}

const entry = compileCommonJs(readSource("../lib/amoraChatEntry.ts"));

const loungeSource = readSource("../../app/(tabs)/lounge.tsx");
const chatSource = readSource("../../app/(tabs)/chat.tsx");
const homeExperienceSource = readSource(
  "../components/dashboard/WeddingHomeExperience.tsx",
);
const arrivalSource = readSource("../components/lounge/LoungeFirstArrival.tsx");

/* ─────────────────────────────────────────────
   (a) 문마다 다른 초안
   ───────────────────────────────────────────── */

test("every entry carries its own draft, and no two doors carry the same one", () => {
  const prefills = entry.AMORA_CHAT_ENTRY_VALUES.map((value) =>
    entry.getAmoraChatEntryPrefill(value),
  );

  for (const prefill of prefills) {
    assert.equal(typeof prefill, "string");
    assert.ok(prefill.length > 0);
  }
  assert.equal(new Set(prefills).size, prefills.length);
  assert.ok(entry.AMORA_CHAT_ENTRY_VALUES.length >= 3);
});

test("the draft is the user's own words — it judges nothing and recommends no vendor", () => {
  for (const value of entry.AMORA_CHAT_ENTRY_VALUES) {
    const prefill = entry.getAmoraChatEntryPrefill(value);
    // 초안은 사람이 할 말이지 아모라의 판정이 아니다. 진척을 단정하거나 업체·가격을
    // 먼저 꺼내면, 사람이 쓴 적 없는 주장이 그 사람 이름으로 전송될 수 있다.
    for (const banned of ["늦", "업체", "가격", "계약", "추천", "플래너", "%"]) {
      assert.ok(
        !prefill.includes(banned),
        `진입 초안 "${value}"에 "${banned}"가 들어 있습니다`,
      );
    }
  }
});

/* ─────────────────────────────────────────────
   (b) 모르는 값은 아무 일도 하지 않는다
   ───────────────────────────────────────────── */

test("an entry the app does not know leaves the composer empty", () => {
  // 이 값은 앱 밖(딥링크·손으로 고친 주소·예전 판이 만든 링크)에서 온다.
  assert.equal(entry.resolveAmoraChatEntry("lounge_time_machine"), null);
  assert.equal(entry.resolveAmoraChatEntry(""), null);
  assert.equal(entry.resolveAmoraChatEntry(undefined), null);
  assert.equal(entry.resolveAmoraChatEntry(null), null);
  assert.equal(entry.resolveAmoraChatEntry(42), null);
  assert.equal(entry.resolveAmoraChatEntry({}), null);
  assert.equal(entry.getAmoraChatEntryPrefill("lounge_time_machine"), null);

  // expo-router는 같은 이름이 여러 번 오면 배열을 준다. 첫 값만 본다.
  assert.equal(entry.resolveAmoraChatEntry(["lounge_fab", "lounge_card"]), "lounge_fab");
  assert.equal(entry.resolveAmoraChatEntry([]), null);
});

/* ─────────────────────────────────────────────
   (c) 네 개의 문이 실제로 다른 것을 들고 간다
   ───────────────────────────────────────────── */

test("the doors into Amora no longer open the same empty screen", () => {
  const doors = new Map([
    ["FAB", loungeSource],
    // 상시 전폭 카드는 지웠다. 여기 남은 것은 "오늘 확인할 게 없다"고 말한 뒤의 CTA다 —
    // 조건이 붙은 문이라 FAB과 같은 자리에 늘 함께 있지 않는다.
    ["히어로 CTA", homeExperienceSource],
    ["첫 도착 CTA", arrivalSource],
  ]);

  const used = [];
  for (const [name, source] of doors) {
    const matches = [...source.matchAll(/\/\(tabs\)\/chat\?entry=([a-z_]+)/g)].map(
      (match) => match[1],
    );
    assert.ok(matches.length > 0, `${name}가 아모라로 가는 문에 맥락이 없습니다`);
    for (const value of matches) {
      assert.ok(
        entry.AMORA_CHAT_ENTRY_VALUES.includes(value),
        `${name}가 대화 화면이 모르는 진입구 "${value}"를 씁니다`,
      );
      used.push(value);
    }
  }
  // 문이 여럿인데 같은 것을 들고 가면, 문을 여러 개 둔 값을 하나도 못 한다.
  assert.equal(new Set(used).size, used.length, "두 문이 같은 맥락을 들고 갑니다");
  // 상시로 겹치던 전폭 카드를 지운 뒤의 수다. 늘어나는 건 괜찮지만, 늘릴 때마다
  // 그 문이 무엇을 다르게 들고 가는지 답할 수 있어야 한다.
  assert.ok(used.length >= 3);

  // 파라미터 없는 예전 push가 남아 있으면 그 문은 다시 같은 빈 화면으로 떨어진다.
  for (const [name, source] of doors) {
    assert.doesNotMatch(
      source,
      /router\.push\("\/\(tabs\)\/chat"\)/,
      `${name}에 맥락 없는 옛 경로가 남아 있습니다`,
    );
  }

  // 네 번째 문인 하단 탭에는 일부러 키를 붙이지 않는다. "그냥 이야기하러 왔다"도 맥락이고,
  // 탭에 초안을 얹으면 대화를 열 때마다 남의 말이 입력창에 들어앉는다.
  assert.ok(!entry.AMORA_CHAT_ENTRY_VALUES.includes("tab"));
});

/* ─────────────────────────────────────────────
   (d) 대화 화면이 실제로 받아서 입력창에 놓는다
   ───────────────────────────────────────────── */

test("the conversation actually reads the entry and drafts it into the shared lane", () => {
  // 예전에는 useLocalSearchParams가 이 파일에 0건이었다 — 문이 무엇을 들고 오든 읽는
  // 쪽이 없으니 전부 같은 화면이었다.
  assert.match(chatSource, /useLocalSearchParams/);
  assert.match(chatSource, /getAmoraChatEntryPrefill\(entryParam\)/);
  assert.match(chatSource, /AMORA_CHAT_ENTRY_PARAM/);

  // 공유 아모라 레인에만 놓는다. 파트너 대화나 비공개 상담에 진입 문구가 섞이면 사람은
  // 자기가 쓰지 않은 말을 상대에게 보낼 뻔한다. 웹도 같은 규칙이다.
  assert.match(
    chatSource,
    /updateAmoraChatLaneRecord\(current, "shared_ai", prefill\)/,
  );
  assert.doesNotMatch(
    chatSource,
    /updateAmoraChatLaneRecord\(current, "shared_partner", prefill\)/,
  );

  // 한 번만 놓는다. 다시 놓으면 사람이 지운 초안이 화면이 다시 그려질 때마다 되살아난다.
  assert.match(chatSource, /entryPrefillAppliedRef\.current = true;/);
  assert.match(chatSource, /if \(entryPrefillAppliedRef\.current\) return;/);

  // 초안은 입력창에 놓일 뿐, 사람 대신 전송되지 않는다.
  assert.doesNotMatch(chatSource, /getAmoraChatEntryPrefill[\s\S]{0,200}sendMessage/);
});

test("the entry adds no new dependency", () => {
  const packageJson = JSON.parse(readSource("../../package.json"));
  const declared = new Set([
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
  ]);

  const specifiers = [...readSource("../lib/amoraChatEntry.ts").matchAll(/from "([^"]+)"/g)];
  // 이 모듈은 아무것도 import하지 않는다 — 문구와 키만 들고 있다.
  assert.equal(specifiers.length, 0);
  assert.ok(declared.has("expo-router"));
});
