// @vitest-environment node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

import { PREPARATION_PROGRESS_STATUS_LABELS } from "@hanbang/shared/constants";

/**
 * 준비 상태 네 가지의 이름은 공용 사전 `PREPARATION_PROGRESS_STATUS_LABELS`
 * (packages/shared/src/constants/preparationProgress.ts) 한 곳에서만 온다.
 *
 * ## 왜
 *
 * 온보딩에서 고른 이름(아직, 준비 중, 안 해요)이 체크리스트에서는 "시작 전", "해당 없음"으로,
 * 라운지 카드에서는 "시작 전", "진행 중"으로 보였다(2026-09-19 기준, 사용자가 닿는 웹 화면은 이 둘이다).
 * 같은 커플의 두 사람이 같은 기록을 다른 말로 본다. 앱은 이미 사전만 쓴다.
 * AmoraMissions 의 단계 상세(PreparationPath, MissionStage)도 옛 말을 썼고 함께 옮겼지만,
 * 지금 라운지는 `<AmoraMissions hub />` 만 그려 그 갈래는 화면에 나오지 않는다.
 *
 * ## 무엇을 막나
 *
 * 옛 이름 세 개("시작 전", "해당 없음", "진행 중". 붙여 쓴 꼴도 같다)가 **상태 이름 자리**에
 * 박혀 있으면 실패한다. 상태 이름 자리는 아홉이다.
 *   1. 문자열 하나가 통째로 그 말이다: `"시작 전"`, `<span>해당 없음</span>`, 템플릿 조각 ` / 해당 없음 `.
 *   2. 바로 뒤에 으로/로가 붙는다: "해당 없음으로 표시", "다시 진행 중으로 바뀌어요".
 *      무엇으로 표시했는지, 무엇으로 바뀌는지 말하는 자리다.
 *   3. 바로 앞이 상태 키다: `not_started=시작전`.
 *   4. 바로 뒤에 개수나 값이 온다: "진행 중 3개", 값 바로 앞에서 끝나는 템플릿 조각.
 *   5. 바로 뒤에 서술격 조사나 그 이음꼴이 온다: "해당 없음이에요", "시작 전입니다",
 *      "해당 없음이라 뺐어요", "시작 전이면", "진행 중인데", "진행 중이던 분야".
 *   6. 준비 분야를 꾸민다: "시작 전 분야 3곳", "진행 중인 분야부터", "· 해당 없음 분야".
 *   7. 준비 상태 키로 고른 글자다. 문장 모양은 가리지 않는다:
 *      `status === "in_progress" ? "진행 중인 곳부터" : …`, `{ not_applicable: "해당 없음 처리한 곳" }`.
 *   8. 구분자(·, :, /, |) 뒤, 글자 조각 맨 끝에 온다: `${done}/${total}개 완료 · 시작 전`, `<p>상태: 진행 중</p>`.
 *      이름표와 값을 나란히 적은 줄이다. 체크리스트 상태 줄이 화면에 그리는 모양("0/5개 완료 · 아직")과 같다.
 *   9. 준비 분야가 주어다: "분야는 시작 전"(맨 끝이거나 뒤에 글자가 없을 때),
 *      "해당 없음은 분야 진행률에서 빠져요"(상태 이름 자체가 주어이고 같은 조각에 준비 분야가 나올 때).
 * 5~7은 2026-09-19 리뷰가, 8~9와 5의 이음꼴은 같은 날 두 번째 리뷰가 심어 본 것 중 앞 자리들이 놓친 꼴이다.
 * 그 틈으로 lib/amora/missions.ts 의 "이미 진행 중인 분야부터 …" 가 빠져나가 있었다(같은 패널의 칩은 "준비 중").
 * "진행 중인 답변", "시작 전에 한 번", "진행 중일 수 있어요", "분야는 시작 전에 골라요",
 * "업로드 · 진행 중인 파일"처럼 상태를 부르는 말이 아닌 쓰임은 보지 않는다.
 *
 * 아직 못 잡는 꼴: 상수로 비교해 고른 글자(`s === IN_PROGRESS_KEY ? "진행 중인 곳" : …`),
 * 옆 속성이 상태 키인 객체(`{ key: "in_progress", label: "진행 중인 곳" }`). 둘 다 오늘 웹 소스에 없다.
 *
 * ## 주석은 보지 않는다
 *
 * 파일을 TypeScript 파서로 읽고 문자열 리터럴, 템플릿 조각, JSX 글자 토큰만 본다. 주석은
 * 토큰이 아니라서 애초에 닿지 않는다. 옛 말을 왜 없앴는지 적은 주석은 남아야 한다.
 * 손으로 만든 주석 제거기는 줄 끝 `//` 를 놓친 적이 있어 쓰지 않는다.
 *
 * ## 허용 목록
 *
 * 상태 이름 자리처럼 보여도 준비 상태가 아닌 것(공유 할 일의 open 등)은 이유와 함께 적는다.
 * 준비 상태 이름이 맞지만 이번 변경 밖에 남은 것(아모라 도구와 프롬프트)은 따로 적는다.
 * 두 목록 모두 항목마다 몇 번 걸려야 하는지 적고, 걸리지 않는 항목이 생기면 실패한다.
 * 그래서 목록은 늘지 않고 줄기만 한다.
 */

const SRC = path.join(process.cwd(), "src");
const OLD_WORDS = /시작\s*전|해당\s*없음|진행\s*중/gu;
const STATUS_KEY_BEFORE = /(?:not_started|in_progress|completed|not_applicable)\s*[=:]\s*$/u;
const PARTICLE_AFTER = /^(?:으로|로)/u;
const COUNT_AFTER = /^\s*\d+\s*개/u;
/**
 * 5. 서술격 조사와 그 이음꼴: "해당 없음이에요", "시작 전입니다", "해당 없음이라 뺐어요", "시작 전이라서",
 * "시작 전이면", "진행 중인데", "진행 중이던 분야". 그 상태라고 말하는 자리다.
 */
const COPULA_AFTER = /^(?:이에요|이예요|예요|입니다|이야|이다|이죠|이네요|이라서|이라|이면|인데|이던)/u;
const PREPARATION_NOUN = "(?:분야|항목|단계|카테고리)";
/** 6. 준비 분야를 꾸민다("인"을 끼워도 같다): "시작 전 분야 3곳", "진행 중인 분야부터". */
const PREPARATION_NOUN_AFTER = new RegExp(`^\\s*(?:인\\s*)?${PREPARATION_NOUN}`, "u");
/** 8. 구분자 바로 뒤. 가운뎃점은 한글 아래아(ㆍ)와 전각 꼴도 같은 구분자로 쓴다. */
const SEPARATOR_BEFORE = /[·ㆍ・•:：/／|｜]\s*$/u;
/** 8, 9. 옛 말 뒤에 글자가 없다. 조각 끝이거나 문장부호, 숫자만 남았다. */
const NOTHING_AFTER = /^[^\p{L}]*$/u;
/** 9. 준비 분야가 은/는을 달고 바로 앞에 있다: "분야는 시작 전". */
const PREPARATION_SUBJECT_BEFORE = new RegExp(`${PREPARATION_NOUN}(?:은|는)\\s*$`, "u");
/** 9. 옛 말이 은/는을 달고 주어가 되고, 같은 조각 뒤에 준비 분야가 나온다: "해당 없음은 분야 진행률에서". */
const TOPIC_WITH_PREPARATION_NOUN_AFTER = new RegExp(`^(?:은|는)\\s[\\s\\S]*${PREPARATION_NOUN}`, "u");
/**
 * 7. 준비 상태 키로 고른 글자. `completed` 는 예약, 할 일 같은 다른 상태에도 쓰는 이름이라 뺀다.
 * 옛 말은 이 셋의 이름이었다.
 */
const PREPARATION_STATUS_KEY = /^(?:not_started|in_progress|not_applicable)$/u;

type Hit = { file: string; line: number; source: string; text: string };

function isScannedText(node: ts.Node): node is ts.LiteralLikeNode {
  return ts.isStringLiteral(node)
    || ts.isNoSubstitutionTemplateLiteral(node)
    || ts.isTemplateHead(node)
    || ts.isTemplateMiddle(node)
    || ts.isTemplateTail(node)
    || ts.isJsxText(node);
}

/**
 * 템플릿 값이나 JSX 식 바로 앞에서 끝나는 조각인가. JSX 글자는 바로 다음 형제가 `{...}` 일
 * 때만 친다. 요소 끝에서 끝나는 글자("540만원 진행중</span>")는 값 앞의 이름표가 아니다.
 */
function endsBeforeAValue(node: ts.Node): boolean {
  if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node)) return true;
  if (!ts.isJsxText(node)) return false;
  const parent = node.parent;
  if (!ts.isJsxElement(parent) && !ts.isJsxFragment(parent)) return false;
  const next = parent.children[parent.children.indexOf(node) + 1];
  return next !== undefined && ts.isJsxExpression(next);
}

function mentionsPreparationStatusKey(node: ts.Node): boolean {
  if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && PREPARATION_STATUS_KEY.test(node.text)) {
    return true;
  }
  return ts.forEachChild(node, (child) => mentionsPreparationStatusKey(child) || undefined) ?? false;
}

function isPreparationStatusKeyName(name: ts.PropertyName): boolean {
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && PREPARATION_STATUS_KEY.test(name.text);
}

const SHORT_CIRCUIT = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

/**
 * 7. 준비 상태 키에 따라 고른 글자인가. 같은 함수 안에서 위로 올라가며 본다.
 *   `status === "in_progress" ? "…" : "…"`, `status === "not_started" && <p>…</p>`,
 *   `if (status === "in_progress") return "…"`, `case "not_applicable":`, `{ in_progress: "…" }`.
 * 이 자리의 옛 말은 문장 모양과 상관없이 그 상태를 부르는 말이다. 2026-09-19 lib/amora/missions.ts 의
 * "이미 진행 중인 분야부터 …" 가 `status === "in_progress" ?` 아래에 남아 있었다.
 */
function isChosenByPreparationStatus(node: ts.Node): boolean {
  let child: ts.Node = node;
  for (let parent = node.parent; parent && !ts.isSourceFile(parent); child = parent, parent = parent.parent) {
    if (ts.isFunctionLike(parent)) return false;
    if (ts.isConditionalExpression(parent)) {
      if (child !== parent.condition && mentionsPreparationStatusKey(parent.condition)) return true;
    } else if (ts.isBinaryExpression(parent)) {
      if (child === parent.right && SHORT_CIRCUIT.has(parent.operatorToken.kind) && mentionsPreparationStatusKey(parent.left)) return true;
    } else if (ts.isIfStatement(parent)) {
      if (child !== parent.expression && mentionsPreparationStatusKey(parent.expression)) return true;
    } else if (ts.isCaseClause(parent)) {
      if (child !== parent.expression && mentionsPreparationStatusKey(parent.expression)) return true;
    } else if (ts.isPropertyAssignment(parent)) {
      if (child === parent.initializer && isPreparationStatusKeyName(parent.name)) return true;
    }
  }
  return false;
}

function isStatusLabelPosition(node: ts.Node, text: string, index: number, word: string): boolean {
  const before = text.slice(0, index);
  const after = text.slice(index + word.length);
  const onlyTheWord = (before + after).replace(/[^\p{L}]/gu, "") === "";
  return onlyTheWord
    || PARTICLE_AFTER.test(after)
    || STATUS_KEY_BEFORE.test(before)
    || COUNT_AFTER.test(after)
    || (endsBeforeAValue(node) && after.trim() === "")
    || COPULA_AFTER.test(after)
    || PREPARATION_NOUN_AFTER.test(after)
    || isChosenByPreparationStatus(node)
    || (SEPARATOR_BEFORE.test(before) && NOTHING_AFTER.test(after))
    || (PREPARATION_SUBJECT_BEFORE.test(before) && NOTHING_AFTER.test(after))
    || TOPIC_WITH_PREPARATION_NOUN_AFTER.test(after);
}

function scanSource(file: string, source: string): { hits: Hit[]; texts: number } {
  const kind = /\.[jt]sx$/u.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  const lines = source.split(/\r?\n/u);
  const hits: Hit[] = [];
  let texts = 0;
  const visit = (node: ts.Node) => {
    if (isScannedText(node)) {
      texts += 1;
      const text = node.text;
      for (const match of text.matchAll(OLD_WORDS)) {
        if (!isStatusLabelPosition(node, text, match.index ?? 0, match[0])) continue;
        const line = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
        hits.push({ file, line: line + 1, source: lines[line] ?? "", text: text.trim() });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { hits, texts };
}

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collect(full, out);
    else if (/\.(?:tsx?|mts|jsx?|mjs)$/u.test(name) && !/\.test\.|\.d\.ts$/u.test(name)) out.push(full);
  }
  return out;
}

function scanWebSource(): { hits: Hit[]; texts: number; files: number } {
  const files = collect(SRC);
  const hits: Hit[] = [];
  let texts = 0;
  for (const full of files) {
    const relative = path.relative(SRC, full).split(path.sep).join("/");
    const result = scanSource(relative, readFileSync(full, "utf8"));
    hits.push(...result.hits);
    texts += result.texts;
  }
  return { hits, texts, files: files.length };
}

type Allowed = {
  file: string;
  /** 그 줄에 있는 글자 일부. 같은 파일 안에서 어느 자리인지 가린다. */
  line: string;
  /** 이 항목이 덮어야 하는 걸림 수. 같은 줄에 옛 말이 하나 더 박히면 수가 달라져 실패한다. */
  hits: number;
  reason: string;
};

/** 상태 이름 자리처럼 보이지만 준비 분야의 네 상태가 아니다. */
const NOT_A_PREPARATION_STATUS: readonly Allowed[] = [
  {
    file: "components/app/amora-board/AmoraDecisionBoard.tsx",
    line: "\"진행 중으로 다시 꺼냈어요.\"",
    hits: 1,
    reason: "공유 할 일(아모라 보드 카드)의 상태 open 을 부르는 말이다. 준비 분야 상태가 아니다.",
  },
  {
    file: "components/app/amora-personal/AmoraPersonalActions.tsx",
    line: "action.status === \"done\" ? \"완료\" : \"진행 중\"",
    hits: 1,
    reason: "개인 할 일의 상태(open, done)다. 준비 분야 상태가 아니다.",
  },
  {
    file: "components/app/amora-personal/AmoraPersonalActions.tsx",
    line: "\"진행 중으로 되돌리기\"",
    hits: 1,
    reason: "개인 할 일을 open 으로 되돌리는 버튼이다. 준비 분야 상태가 아니다.",
  },
  {
    file: "constants/weddingCodeForm.ts",
    line: "{ value: \"not_applicable\", label: \"해당 없음\" }",
    hits: 1,
    reason: "웨딩코드 설문의 응답 방식 선택지(혼자, 상대와 함께, 해당 없음)다. 값 이름이 같을 뿐 준비 상태가 아니다.",
  },
  {
    file: "lib/ai/amoraPendingAction.ts",
    line: "open: \"진행 중\"",
    hits: 1,
    reason: "확인 카드가 공유 할 일 상태 open 을 부르는 이름이다. 준비 분야 상태가 아니다.",
  },
  {
    file: "lib/amora/preparationBoard.ts",
    line: "{ status: \"open\", label: \"진행 중\"",
    hits: 1,
    reason: "공유 할 일 보드의 open 칸 이름이다. 준비 분야 상태가 아니다.",
  },
  {
    file: "lib/amora/preparationBoard.ts",
    line: "다시 진행 중으로 옮길 수 있어요",
    hits: 1,
    reason: "숨긴 공유 할 일을 open 으로 되돌리는 안내다. 준비 분야 상태가 아니다.",
  },
  {
    file: "lib/ai/tools.ts",
    line: "'드레스 진행 중으로 바꿔줘'",
    hits: 1,
    reason: "모델에게 보여 주는 사용자 말 예시다. 사용자가 이렇게 말해도 모델이 알아들어야 한다. 화면에 나가는 상태 이름이 아니다.",
  },
  {
    file: "app/(app)/dashboard/page.tsx",
    line: "주요 준비가 안정적으로 진행 중이에요.",
    hits: 1,
    reason: "먼저 볼 분야가 없을 때(nextCategories 가 빔) 준비 전체가 잘 흘러간다고 말하는 문장이다. 분야 하나의 상태 이름이 아니다.",
  },
  {
    file: "app/api/admin/price/bulk-approval/route.ts",
    line: "적재 작업이 진행 중입니다",
    hits: 1,
    reason: "관리자 가격 일괄 승인 API 가 다른 적재 작업과 겹쳤다고 알리는 오류 문장(BULK_APPROVAL_BUSY)이다. 준비 분야 상태가 아니다.",
  },
];

/**
 * 준비 분야 상태 이름이 맞다. 아모라의 도구와 프롬프트가 쓰는 말이라 이번 변경(체크리스트, 라운지,
 * AmoraMissions) 밖에 남았다. 모델이 읽고 따라 말하는 말이고 lib/ai 테스트(statusFollowsChecklist 등)가
 * 이 말을 고정하고 있어서, 옮기려면 아모라 쪽 변경으로 따로 한다. 옮기면 여기서 지운다.
 */
const NOT_YET_MOVED: readonly Allowed[] = [
  {
    file: "lib/ai/amoraPendingAction.ts",
    line: "not_started: \"시작 전\"",
    hits: 1,
    reason: "아모라 확인 카드가 바뀌는 상태 값을 부르는 이름이다.",
  },
  {
    file: "lib/ai/amoraPendingAction.ts",
    line: "in_progress: \"진행 중\"",
    hits: 1,
    reason: "아모라 확인 카드가 바뀌는 상태 값을 부르는 이름이다.",
  },
  {
    file: "lib/ai/tools/planningConstants.ts",
    line: "not_started: \"시작 전\"",
    hits: 1,
    reason: "아모라 도구 결과 문장(update_task_status)이 쓰는 상태 이름이다.",
  },
  {
    file: "lib/ai/tools/planningConstants.ts",
    line: "in_progress: \"진행 중\"",
    hits: 1,
    reason: "아모라 도구 결과 문장(update_task_status)이 쓰는 상태 이름이다.",
  },
  {
    file: "lib/ai/tools/scheduleTools.ts",
    line: "진행 중 ${inProgress.length}개, 시작 전 ${notStarted.length}개",
    hits: 2,
    reason: "아모라 준비 현황 도구의 요약 문장이다.",
  },
  {
    file: "lib/ai/tools.ts",
    line: "not_started=시작전, in_progress=진행중",
    hits: 2,
    reason: "update_task_status 도구 설명에 모델용으로 적은 상태 이름이다.",
  },
  {
    file: "lib/ai/prompts.ts",
    line: "if (status === \"in_progress\") return",
    hits: 1,
    reason: "모델 문맥에 넣는 준비 현황 표기다.",
  },
];

const ALLOWED = [...NOT_A_PREPARATION_STATUS, ...NOT_YET_MOVED];

function allowedEntryFor(hit: Hit): Allowed | undefined {
  return ALLOWED.find((entry) => entry.file === hit.file && hit.source.includes(entry.line));
}

describe("준비 상태 이름은 공용 사전 한 곳에서", () => {
  it("측정기가 살아 있다", () => {
    const sample = [
      "const a = { not_started: \"시작 전\", other: \"진행 중인 답변\" };",
      "// 해당 없음",
      "/* 진행 중으로 */",
      "const b = <span>해당 없음</span>;",
      "const c = `완료 ${1}개, 진행 중 ${2}개`;",
      "const d = \"해당 없음으로 표시\";",
      "const e = \"not_started=시작전\";",
      "const f = \"시작 전에 한 번 맞춰봐요\";",
      "const g = \"진행중 3개\";",
      "const h = <p>{done} / {total}개 분야 완료{n > 0 ? ` / 해당 없음 ${n}개` : \"\"}</p>;",
      "const i = <span>540만원 진행중</span>;",
      "const j = <p>완료 {a}개, 진행 중 {b}개</p>;",
      // 13~19: 2026-09-19 리뷰가 심어 본 것 중 앞의 네 자리로는 못 잡던 꼴.
      "const k = \"이 분야는 해당 없음이에요\";",
      "const l = (n: number) => `시작 전 분야 ${n}곳`;",
      "const m = \"진행 중인 분야부터 이어가요\";",
      "const n = (x: string) => <span>{x} · 해당 없음 분야</span>;",
      "const o = (s: string) => s === \"in_progress\" ? \"진행 중이에요\" : \"시작 전이에요\";",
      "const p = (s: string) => s === \"in_progress\" ? \"지금 진행 중인 곳부터 골랐어요\" : \"\";",
      "const q = { not_applicable: \"해당 없음 처리한 곳\", in_progress: \"이미 진행 중인 곳\" };",
      // 20~24: 상태를 부르는 말이 아니다. 걸리면 안 된다.
      "const r = \"새 메시지를 보내면 진행 중인 답변이 중단될 수 있어요\";",
      "const s = <p>아모라 상담 시작 전 한 단계만</p>;",
      "const t = (b: string) => b === \"done\" ? \"진행 중인 흐름이 있어요\" : \"\";",
      "const u = \"도착하면 식이 이미 진행 중일 수 있어요\";",
      "const v = { open: \"진행 중인 공유 할 일\" };",
      "const w = 1; // s === \"in_progress\" ? \"이미 진행 중인 분야부터\" : \"해당 없음이에요\"",
      // 26~37: 2026-09-19 두 번째 리뷰가 심어 본 것 중 앞의 일곱 자리로는 못 잡던 꼴.
      "const x1 = (done: number, total: number) => `${done}/${total}개 완료 · 시작 전`;",
      "const x2 = (d: number, t: number) => <span>{d}/{t}개 완료 · 해당 없음</span>;",
      "const x3 = <p>상태: 진행 중</p>;",
      "const x4 = (label: string) => `${label} 분야는 시작 전`;",
      "const x5 = \"이 분야는 해당 없음이라 알림에서 뺐어요\";",
      "const x6 = \"진행 중이던 분야를 먼저 보여 드려요\";",
      "const x7 = \"항목이 시작 전이면 알림을 보내요\";",
      "const x8 = \"드레스는 진행 중인데 스튜디오는 아직이에요\";",
      "const x9 = \"시작 전이라서 보여 줄 기록이 없어요\";",
      "const x10 = \"해당 없음은 분야 진행률에서 빠져요\";",
      "const x11 = (a: string) => <p>{a} 분야 / 해당 없음</p>;",
      "const x12 = (n: number) => `드레스ㆍ${n}곳ㆍ진행 중`;",
      // 38~43: 구분자 뒤나 준비 분야 뒤에 있어도 상태 이름 자리가 아니다. 걸리면 안 된다.
      "const y1 = \"업로드 · 진행 중인 파일이 있어요\";",
      "const y2 = <p>안내: 시작 전에 한 번 읽어 주세요</p>;",
      "const y3 = \"분야는 시작 전에 골라 두면 좋아요\";",
      "const y4 = \"예식 시작 전은 늘 바빠요\";",
      "const y5 = <p>업로드가 아직 진행 중</p>;",
      "const y6 = \"상담은 진행 중\";",
    ].join("\n");
    const { hits } = scanSource("sample.tsx", sample);
    expect(hits.map((hit) => hit.line), "상태 이름 자리만 잡고 주석과 다른 쓰임은 건너뛴다")
      .toStrictEqual([
        1, 4, 5, 6, 7, 9, 10, 12, 13, 14, 15, 16, 17, 17, 18, 19, 19,
        26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37,
      ]);

    // 스캔이 비면 "위반 0건"이 공짜로 나온다.
    const { texts, files } = scanWebSource();
    expect(files, "웹 소스 파일을 거의 못 찾았다").toBeGreaterThan(500);
    expect(texts, "문자열 토큰을 거의 못 읽었다").toBeGreaterThan(50_000);
  });

  it("공용 사전의 이름은 옛 이름이 아니다", () => {
    expect(Object.values(PREPARATION_PROGRESS_STATUS_LABELS)).toStrictEqual(["아직", "준비 중", "완료", "안 해요"]);
    for (const label of Object.values(PREPARATION_PROGRESS_STATUS_LABELS)) {
      expect(label).not.toMatch(OLD_WORDS);
    }
  });

  it("웹 소스가 상태 이름 자리에 옛 이름을 박아 두지 않는다", () => {
    const { hits } = scanWebSource();
    const violations = hits
      .filter((hit) => !allowedEntryFor(hit))
      .map((hit) => `${hit.file}:${hit.line} ${JSON.stringify(hit.text.slice(0, 60))}`);
    expect(
      violations,
      "상태 이름은 PREPARATION_PROGRESS_STATUS_LABELS 에서 가져온다(아직, 준비 중, 완료, 안 해요)",
    ).toStrictEqual([]);
  });

  it("허용 목록은 낡지 않는다. 항목마다 적힌 수만큼 걸린다", () => {
    const { hits } = scanWebSource();
    const counts = ALLOWED.map((entry) => ({
      entry: `${entry.file} ${entry.line}`,
      expected: entry.hits,
      actual: hits.filter((hit) => allowedEntryFor(hit) === entry).length,
    }));
    const stale = counts.filter(({ expected, actual }) => expected !== actual);
    expect(stale, "고쳤으면 목록에서 지우고, 새로 박혔으면 사전으로 옮긴다").toStrictEqual([]);
    for (const entry of ALLOWED) expect(entry.reason.length, entry.line).toBeGreaterThan(10);
  });
});
