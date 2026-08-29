import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "../amoraPromptComposer";
import { buildAmoraSystemPrompt as baselineBuild } from "../__baselineComposer.probe";
import { BETA_SAFE_TOOLS } from "../tools";

const OUT =
  "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/final-probe.txt";
writeFileSync(OUT, "");
const NL = String.fromCharCode(10);
const log = (m: string) => appendFileSync(OUT, m + NL);

const TOOLS = BETA_SAFE_TOOLS.map((t) => t.name);
const base = {
  weddingDate: null as string | null,
  budget: 0, venue: null, progress: {},
  brideName: "지은", groomName: "현우", senderName: "지은",
  bookings: [] as unknown[], scheduleEvents: [] as unknown[], chatSummaries: [] as string[],
};
function build(which: "main" | "branch", ctx: Record<string, unknown>, maxChars?: number) {
  const fn = which === "main" ? baselineBuild : buildAmoraSystemPrompt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any)({ ...base, ...ctx }, {
    requestKind: "chat", persistenceMode: "durable", enabledToolNames: TOOLS,
    ...(maxChars === undefined ? {} : { maxChars }),
  }) as string;
}

const PROBES: Array<[string, string]> = [
  ["제안칩 형식", "[suggestions]"],
  ["제안칩 안전규칙", "안전 신호가 보이는 대화에는 제안을 하나도 붙이지 마세요"],
  ["제안칩 카테고리 일관성", "카테고리 일관성"],
  ["첫 만남 가치증명", "첫 3문답 안에 가치 증명"],
  ["중재요청 섹션", "요청 기반 조율 (MEDIATION_REQUEST)"],
  ["한번에 하나만(확인질문)", "확인 질문**: 한 번에 하나만 묻고"],
  ["한번에 하나만(부족항목)", "부족한 항목은 결과에 꼭 필요한 것부터 한 번에 하나만 묻습니다"],
  ["새: 모아 물으세요", "일정 추가에 모르는 것이 여러 개면 한 번에 모아 물으세요"],
  ["새: 날짜없음 3가지", "## 날짜를 정하기 전에 먼저 맞출 기준 3가지"],
];

const CASES: Array<[string, Record<string, unknown>]> = [
  ["빈커플 undated +asked", { startingPointAsked: true }],
  ["빈커플 undated -asked", {}],
  ["빈커플 dated +asked", { weddingDate: "2027-06-20", startingPointAsked: true }],
  ["빈커플 dated -asked", { weddingDate: "2027-06-20" }],
  ["요약6 undated +asked", { startingPointAsked: true, chatSummaries: Array.from({ length: 6 }, (_, i) => `요약${i}: ${"준비 이야기. ".repeat(40)}`) }],
];

describe("probe final", () => {
  it("survival table under the 48k cap", () => {
    for (const [label, ctx] of CASES) {
      const m = build("main", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
      const b = build("branch", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
      const mf = build("main", ctx);
      const bf = build("branch", ctx);
      log(`## ${label}`);
      log(`   uncapped main=${mf.length} branch=${bf.length} (delta ${bf.length - mf.length})`);
      log(`   capped   main=${m.length} branch=${b.length}`);
      log(`   버려진 양 main=${mf.length - m.length} branch=${bf.length - b.length} (branch 가 더 버림: ${(bf.length - b.length) - (mf.length - m.length)})`);
      for (const [name, needle] of PROBES) {
        const mm = m.includes(needle) ? "O" : "X";
        const bb = b.includes(needle) ? "O" : "X";
        const flag = mm === "O" && bb === "X" ? "  <-- 브랜치에서만 사라짐" : "";
        log(`     main=${mm} branch=${bb}  ${name}${flag}`);
      }
      log("");
    }
  });

  it("does the new schedule line coexist with the one-question rule", () => {
    const b = build("branch", { startingPointAsked: true });
    const a = "일정 추가에 모르는 것이 여러 개면 한 번에 모아 물으세요";
    const c1 = "확인 질문**: 한 번에 하나만 묻고";
    const c2 = "부족한 항목은 결과에 꼭 필요한 것부터 한 번에 하나만 묻습니다";
    log("### 같은 프롬프트 안에 공존하는가 (maxChars 없음)");
    log(`  새 줄:        ${b.includes(a)}`);
    log(`  확인질문 규칙: ${b.includes(c1)}`);
    log(`  부족항목 규칙: ${b.includes(c2)}`);
    for (const n of [a, c1, c2]) {
      const j = b.indexOf(n);
      if (j >= 0) log(`  @${j}  ${b.slice(b.lastIndexOf(NL, j) + 1, b.indexOf(NL, j))}`);
    }
  });
});
