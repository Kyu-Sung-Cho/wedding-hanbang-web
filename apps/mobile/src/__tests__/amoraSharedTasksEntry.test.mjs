import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, URL } from "node:url";
import ts from "typescript";

/**
 * 공유 할 일 — 한 목록에 한 이름 (2026-09-18).
 *
 * 앱은 같은 목록(`/api/amora/actions`, 화면 `/amora-preparation`)을 네 이름으로 불렀다 — 「준비 기록」(화면
 * 제목·대화 정리 버튼·도구 결과 카드), 「준비 보드」(중재 카드·공용 오류 문구), 「아모라가 챙기기로 한 것」
 * (라운지), 「공유 할 일」(중재 성공 문구). 웹은 이 목록을 「공유 할 일」이라 부른다.
 *
 * 「결정 보드」는 쓰지 않는다. 웹의 결정 보드는 결정 기록·공유 할 일·저장한 답변을 묶은 화면인데 앱의 이
 * 화면에는 아직 공유 할 일만 있다 — 그 이름을 붙이면 없는 결정 기록이 있는 것처럼 보인다. 결정 기록이
 * 앱에 들어오는 날 이 테스트와 함께 이름을 바꾼다.
 *
 * 검사는 주석을 걷어 낸 소스로 한다. 주석에는 왜 이름을 바꿨는지가 남아야 한다.
 */

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/**
 * 화면에 나갈 수 있는 글만 모은다 — 문자열·템플릿 조각·JSX 글자. 주석은 파서가 건너뛴다.
 * (스캐너로 주석만 걷어 내면 주석 속 백틱을 템플릿으로 잘못 읽어 코드와 주석이 뒤섞였다.)
 */
function stripComments(source, fileName = "file.tsx") {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out = [];
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) out.push(node.text);
    else if (ts.isJsxText(node)) out.push(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.join("\n");
}

const OLD_NAMES = /준비 기록|준비 보드|결정 보드|아모라가 챙기기로 한 것|챙길 것/u;

/** 이 목록을 그리거나 이 목록으로 보내는 곳. */
const ENTRY_FILES = {
  screen: "../../app/amora-preparation.tsx",
  lounge: "../components/lounge/AmoraActionsCard.tsx",
  recap: "../components/chat/AmoraConversationRecap.tsx",
  toolCard: "../components/chat/toolResultCardModel.ts",
  mediation: "../components/chat/AmoraMediationResponses.tsx",
  header: "../lib/amoraChatHeader.ts",
};

test("목록을 그리거나 그리로 보내는 곳의 화면 문구에 예전 이름이 없다", () => {
  for (const [name, path] of Object.entries(ENTRY_FILES)) {
    const code = stripComments(read(path));
    const hit = OLD_NAMES.exec(code);
    assert.equal(hit, null, `${name}(${path}) 에 예전 이름 「${hit?.[0]}」이 남았다`);
  }
});

test("앱 소스 어디에도 「준비 보드」와 「결정 보드」가 화면 문구로 남지 않는다", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "__tests__" || entry.startsWith(".")) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(tsx?|mjs)$/u.test(entry) && !entry.endsWith(".d.ts") && !entry.endsWith(".d.mts")) files.push(full);
    }
  };
  walk(join(root, "app"));
  walk(join(root, "src"));
  assert.ok(files.length > 50, "훑은 파일이 너무 적다 — 경로가 틀렸다");
  const hits = files.filter((file) => /준비 보드|결정 보드/u.test(stripComments(readFileSync(file, "utf8"))));
  assert.deepEqual(hits.map((file) => file.slice(root.length)), []);
});

test("아모라 탭 머리 입구는 「공유 할 일」이고 그 목록 화면으로 간다", () => {
  const header = read(ENTRY_FILES.header);
  assert.match(header, /label: "공유 할 일",/u);
  assert.match(header, /accessibilityLabel: "공유 할 일 보기",/u);
  assert.match(header, /pathname: "\/amora-preparation",/u);
});

test("화면 제목과 도착 버튼들이 같은 이름을 쓴다", () => {
  assert.match(read(ENTRY_FILES.screen), /<AppHeader title="공유 할 일"/u);
  assert.match(read(ENTRY_FILES.recap), /\{ label: "공유 할 일", pathname: "\/amora-preparation" \}/u);
  assert.match(read(ENTRY_FILES.toolCard), /\{ pathname: "\/amora-preparation", label: "공유 할 일 보기" \}/u);
  const mediation = read(ENTRY_FILES.mediation);
  assert.match(mediation, /label="공유 할 일에서 먼저 확인"/u);
  assert.match(mediation, /label="공유 할 일 보기"/u);
  assert.match(mediation, /파트너도 보는 공유 할 일에 저장해요\./u);
});

test("웹·앱이 함께 쓰는 중재 오류 문구도 같은 이름이다", () => {
  const shared = read("../../../../packages/shared/src/contracts/amoraMediationResponses.mjs");
  assert.match(shared, /'할 일 저장 결과를 확인하지 못했어요\. 공유 할 일을 먼저 확인해 주세요\.'/u);
  assert.doesNotMatch(stripComments(shared), /준비 보드/u);
});
