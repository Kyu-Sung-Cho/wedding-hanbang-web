import { describe, it } from "vitest";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  AMORA_SYSTEM_PROMPT_MAX_CHARS,
  buildAmoraSystemPrompt,
} from "../amoraPromptComposer";
import { buildAmoraSystemPrompt as baselineBuild } from "../__baselineComposer.probe";
import { BETA_SAFE_TOOLS } from "../tools";

const OUT =
  "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/trunc-probe.txt";
writeFileSync(OUT, "");
const NL = String.fromCharCode(10);
const log = (m: string) => appendFileSync(OUT, m + NL);

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

function build(which: "main" | "branch", ctx: Record<string, unknown>, maxChars?: number) {
  const fn = which === "main" ? baselineBuild : buildAmoraSystemPrompt;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (fn as any)({ ...base, ...ctx }, {
    requestKind: "chat",
    persistenceMode: "durable",
    enabledToolNames: TOOLS,
    ...(maxChars === undefined ? {} : { maxChars }),
  }) as string;
}

describe("probe: what truncation removes", () => {
  it("n=0 empty couple, undated, startingPointAsked", () => {
    const ctx = { startingPointAsked: true };
    const mFull = build("main", ctx);
    const bFull = build("branch", ctx);
    const m = build("main", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
    const b = build("branch", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
    log(`main  full=${mFull.length} capped=${m.length} truncated=${m.includes("길이 제한으로 생략")}`);
    log(`branch full=${bFull.length} capped=${b.length} truncated=${b.includes("길이 제한으로 생략")}`);

    // which lines of the uncapped branch prompt are missing from the capped one
    const capped = new Set(b.split(NL));
    const lost = bFull.split(NL).filter((l) => l.trim() !== "" && !capped.has(l));
    log("");
    log(`### 브랜치에서 절단으로 사라진 줄 ${lost.length}개`);
    for (const l of lost) log(`  - ${l.slice(0, 160)}`);

    const cappedMain = new Set(m.split(NL));
    const lostMain = mFull.split(NL).filter((l) => l.trim() !== "" && !cappedMain.has(l));
    log("");
    log(`### main 에서 절단으로 사라진 줄 ${lostMain.length}개`);
    for (const l of lostMain) log(`  - ${l.slice(0, 160)}`);
  });

  it("realistic populated couple", () => {
    const ctx = {
      startingPointAsked: true,
      weddingDate: null,
      budget: 50_000_000,
      venue: "그랜드홀",
      brideName: "지은",
      groomName: "현우",
      progress: { venue: true, dress: true },
      bookings: [
        { id: "b1", vendor_name: "스튜디오A", service_type: "스튜디오", booking_date: "2026-10-01", status: "confirmed" },
        { id: "b2", vendor_name: "드레스샵B", service_type: "드레스", booking_date: "2026-10-08", status: "confirmed" },
      ],
      scheduleEvents: [
        { id: "s1", title: "상견례", date: "2026-09-20", event_type: "shared_commitment" },
        { id: "s2", title: "본식 리허설", date: "2026-11-01", event_type: "shared_commitment" },
      ],
      chatSummaries: Array.from({ length: 6 }, (_, i) => `요약${i}: ${"준비 이야기를 나눴다. ".repeat(30)}`),
      amoraProfiles: {
        shared: { 우선순위: "사진", 스타일: "모던", 하객: "150명 내외" },
        private: { 걱정: "예산", 취향: "심플" },
      },
    };
    const mFull = build("main", ctx);
    const bFull = build("branch", ctx);
    const m = build("main", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
    const b = build("branch", ctx, AMORA_SYSTEM_PROMPT_MAX_CHARS);
    log("");
    log("### 실제 데이터가 있는 커플 (결혼일 없음 + startingPointAsked)");
    log(`main  full=${mFull.length} capped=${m.length} lost=${mFull.length - m.length}`);
    log(`branch full=${bFull.length} capped=${b.length} lost=${bFull.length - b.length}`);
    const cappedB = new Set(b.split(NL));
    const lost = bFull.split(NL).filter((l) => l.trim() !== "" && !cappedB.has(l));
    const cappedM = new Set(m.split(NL));
    const lostM = mFull.split(NL).filter((l) => l.trim() !== "" && !cappedM.has(l));
    log(`  main 잃은 줄=${lostM.length}  branch 잃은 줄=${lost.length}`);
    log("  branch 만 추가로 잃은 줄:");
    const lostMset = new Set(lostM);
    for (const l of lost) if (!lostMset.has(l)) log(`    - ${l.slice(0, 160)}`);
  });
});
