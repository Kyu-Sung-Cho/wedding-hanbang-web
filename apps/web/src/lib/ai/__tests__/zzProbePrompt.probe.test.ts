import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "../amoraPromptComposer";
import { buildAmoraSystemPrompt as baselineBuild } from "../__baselineComposer.probe";
import { BETA_SAFE_TOOLS } from "../tools";

const OUT =
  "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/prompt-probe.txt";
writeFileSync(OUT, "");
const log = (m: string) => appendFileSync(OUT, m + String.fromCharCode(10));

const TOOLS = BETA_SAFE_TOOLS.map((t) => t.name);

const base = {
  weddingDate: null as string | null,
  budget: 0,
  venue: null,
  progress: {},
  brideName: "지은",
  groomName: "현우",
  senderName: "지은",
  bookings: [] as unknown[],
  scheduleEvents: [] as unknown[],
  chatSummaries: [] as string[],
};

function build(
  which: "main" | "branch",
  ctx: Record<string, unknown>,
  opts: Record<string, unknown>,
) {
  const fn = which === "main" ? baselineBuild : buildAmoraSystemPrompt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any)({ ...base, ...ctx }, {
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: TOOLS,
    ...opts,
  }) as string;
}

const NEW_MARKERS = [
  "## 날짜를 정하기 전에 먼저 맞출 기준 3가지",
  "예식 형태·하객 규모가 절반 이하로 바뀌면",
  "뭐부터 할지 모르겠다고 하면 되묻기로 끝내지 말고",
  "`get_market_price` 로 범위를 확인해",
  "일정 추가에 모르는 것이 여러 개면 한 번에 모아 물으세요",
];

describe("probe: prompt", () => {
  it("marker presence, no cap", () => {
    const p = build("branch", { startingPointAsked: true }, {});
    log("### A. maxChars 없음, 결혼일 없음, startingPointAsked=true, 도구 전체");
    log(`length=${p.length}`);
    for (const m of NEW_MARKERS) log(`  ${p.includes(m) ? "PRESENT" : "MISSING"} | ${m}`);

    const pDated = build("branch", { startingPointAsked: true, weddingDate: "2027-06-20" }, {});
    log("");
    log("### B. 결혼일 있음");
    log(`length=${pDated.length}`);
    for (const m of NEW_MARKERS) log(`  ${pDated.includes(m) ? "PRESENT" : "MISSING"} | ${m}`);

    const pNoAsk = build("branch", {}, {});
    log("");
    log("### C. startingPointAsked=false");
    log(`length=${pNoAsk.length}`);
    for (const m of NEW_MARKERS) log(`  ${pNoAsk.includes(m) ? "PRESENT" : "MISSING"} | ${m}`);

    // no tools at all
    const pNoTools = build("branch", { startingPointAsked: true }, { enabledToolNames: [] });
    log("");
    log("### D. 도구 0개 (W2/W3/W4 턴)");
    log(`length=${pNoTools.length}`);
    for (const m of NEW_MARKERS) log(`  ${pNoTools.includes(m) ? "PRESENT" : "MISSING"} | ${m}`);
  });

  it("length delta main vs branch", () => {
    log("");
    log("### E. 같은 입력, main vs branch 길이 (maxChars 없음)");
    const cases: Array<[string, Record<string, unknown>]> = [
      ["결혼일없음+startingPointAsked", { startingPointAsked: true }],
      ["결혼일없음+안물음", {}],
      ["결혼일있음+startingPointAsked", { startingPointAsked: true, weddingDate: "2027-06-20" }],
    ];
    for (const [label, ctx] of cases) {
      const m = build("main", ctx, {});
      const b = build("branch", ctx, {});
      log(`  ${label.padEnd(34)} main=${m.length}  branch=${b.length}  delta=+${b.length - m.length}`);
    }
  });

  it("truncation onset under cap", () => {
    log("");
    log("### F. 상한 48,000 아래에서 절단 시작점 (결혼일 없음 + startingPointAsked)");
    const MARK = "[저장 문맥 일부는 길이 제한으로 생략됨]";
    for (const n of [0, 5, 10, 12, 14, 16, 18, 20, 24, 30]) {
      const ctx = {
        startingPointAsked: true,
        chatSummaries: Array.from({ length: n }, (_, i) => `SUM_${i}_${"나".repeat(1_200)}`),
      };
      const m = build("main", ctx, { maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS });
      const b = build("branch", ctx, { maxChars: AMORA_SYSTEM_PROMPT_MAX_CHARS });
      const mt = m.includes(MARK);
      const bt = b.includes(MARK);
      const bHasNew = b.includes(NEW_MARKERS[0]);
      log(
        `  summaries=${String(n).padStart(2)}  main len=${String(m.length).padStart(5)} trunc=${String(mt).padEnd(5)}` +
          `  branch len=${String(b.length).padStart(5)} trunc=${String(bt).padEnd(5)} newSection=${bHasNew}`,
      );
    }
  });

  it("what the new section actually looks like in the delivered prompt", () => {
    const p = build("branch", { startingPointAsked: true }, {});
    const i = p.indexOf(NEW_MARKERS[0]);
    log("");
    log("### G. 모델이 받는 새 문단 원문");
    log(i === -1 ? "  (없음)" : p.slice(i, i + 900));
    log("");
    log("### H. 새 도구 지시문 줄 (전달본에서 발췌)");
    for (const m of NEW_MARKERS.slice(1)) {
      const j = p.indexOf(m);
      log(j === -1 ? `  MISSING: ${m}` : `  ${p.slice(p.lastIndexOf(String.fromCharCode(10), j) + 1, p.indexOf(String.fromCharCode(10), j))}`);
    }
  });

  it("neighbouring rules that could contradict", () => {
    const p = build("branch", { startingPointAsked: true }, {});
    log("");
    log("### I. 인접 규칙 (되묻기 / 제안 칩 / 준비 3가지)");
    for (const needle of [
      "## 지금 확인할 준비 3가지",
      "되물",
      "제안 칩",
      "질문은 한 번에 하나",
      "한 번에 하나만",
    ]) {
      let from = 0;
      let count = 0;
      while (count < 6) {
        const j = p.indexOf(needle, from);
        if (j === -1) break;
        const lineStart = p.lastIndexOf(String.fromCharCode(10), j) + 1;
        const lineEnd = p.indexOf(String.fromCharCode(10), j);
        log(`  [${needle}] ${p.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)}`);
        from = j + needle.length;
        count += 1;
      }
      if (count === 0) log(`  [${needle}] (없음)`);
    }
  });
});
