import { describe, it } from "vitest";
import { appendFileSync } from "node:fs";
import { classifyAmoraQuestionScope } from "@/lib/ai/amoraQuestionScope";
import { classifyAmoraQuestionScope as baseline } from "@/lib/ai/__advBaseline";

const OUT = "C:/Users/kcho1/AppData/Local/Temp/claude/C--Users-kcho1-Desktop-workspace-hanbang/b30d0a8c-5b92-4862-bc05-260b9db4fed9/scratchpad/probe2.txt";
const w = (s: string) => appendFileSync(OUT, s + "\r\n", "utf8");
const tag = (t: string) => {
  const n = classifyAmoraQuestionScope({ userText: t });
  return n.scope + (n.allowsLongTermMemory ? "+MEM" : "");
};
const tagMain = (t: string) => {
  const b = baseline({ userText: t });
  return b.scope + (b.allowsLongTermMemory ? "+MEM" : "");
};

describe("probe2", () => {
  it("B scale: leading budget gate, topic stated after", () => {
    const topics = [
      "부모님 환갑잔치", "부모님 칠순", "오토바이", "성형 상담", "콘서트 티켓",
      "반려로봇", "개인 방송 장비", "승진 준비", "명절 차례상", "자전거",
      "카메라 장비", "요가 수업", "어학 시험", "이번 워크숍", "봉사활동",
      "친구 생일 파티", "동아리 MT", "펫보험 말고 사료", "스키 시즌권", "서핑 강습",
    ];
    const shapes = [
      (x: string) => `예산 짜줘. ${x} 하려고.`,
      (x: string) => `우리 전체 예산 다시 짜줘. ${x} 때문에.`,
      (x: string) => `그럼 예산 좀 정리해줘. ${x} 준비 중이야.`,
      (x: string) => `여보 우리 예산 좀 봐줘. ${x} 비용이 걱정돼.`,
      (x: string) => `혹시 예산 좀 잡아줘? ${x}.`,
    ];
    let both = 0, newW0 = 0, total = 0;
    const lines: string[] = [];
    for (const x of topics) {
      for (const s of shapes) {
        const t = s(x);
        total += 1;
        const n = tag(t), b = tagMain(t);
        if (n.startsWith("W0") && !b.startsWith("W0")) { newW0 += 1; lines.push(`NEW-W0 ${n} (main ${b}) << ${t}`); }
        else if (n.startsWith("W0") && b.startsWith("W0")) both += 1;
      }
    }
    w("\r\n===== B scale: " + total + " sentences; new W0 (main was not W0) = " + newW0 + "; already W0 on main = " + both);
    lines.slice(0, 14).forEach((l) => w(l));
  });

  it("A scale: canonical topic guard defeated by any wedding-state phrase", () => {
    const topics = ["자퇴", "도박 빚", "유튜브 채널", "게임 아이템", "논문 심사", "이민", "학원", "재테크", "파산", "복권", "문신", "알바", "골프", "캠핑"];
    const shapes = [
      (x: string) => `${x} 예산 얼마나 잡아야 해`,
      (x: string) => `${x} 예산 보여줘`,
      (x: string) => `${x} 일정 내일로 추가해줘`,
      (x: string) => `${x} 할 일 추가해줘`,
      (x: string) => `${x} 일정 알려줘`,
    ];
    const inject = [
      (t: string) => `결혼 예산 말고 ${t}`,
      (t: string) => `${t} 결혼 일정도 같이 봐줘.`,
      (t: string) => `우리 결혼 예산은 됐고, ${t}`,
    ];
    let blocked = 0, reopened = 0, tot = 0;
    const lines: string[] = [];
    for (const x of topics) {
      for (const s of shapes) {
        const base = s(x);
        tot += 1;
        const nb = tag(base);
        if (!nb.startsWith("W0")) {
          blocked += 1;
          for (const inj of inject) {
            const t2 = inj(base);
            const n2 = tag(t2);
            if (n2.startsWith("W0")) { reopened += 1; if (lines.length < 12) lines.push(`REOPEN ${n2} (main ${tagMain(t2)}) << ${t2}`); break; }
          }
        }
      }
    }
    w("\r\n===== A scale: " + tot + " base sentences; branch blocks " + blocked + "; of those reopened to W0 by a wedding-state phrase = " + reopened);
    lines.forEach((l) => w(l));
  });

  it("D: newlywed-home word removal erases another topic's guard word", () => {
    const pairs = [
      ["이혼 수속 예산 보여줘", "이혼수속 예산 보여줘"],
      ["이혼 수임료 예산 알려줘", "이혼수임료 예산 알려줘"],
      ["고양이 사료 예산 보여줘", "고양이사료 예산 보여줘"],
      ["고양이 사료 일정 알려줘", "고양이사료 일정 알려줘"],
      ["이혼 수속 할 일 추가해줘", "이혼수속 할 일 추가해줘"],
    ];
    w("\r\n===== D: same topic, spaced vs unspaced");
    for (const [a, b] of pairs) {
      w(`  spaced   ${tag(a)} (main ${tagMain(a)}) << ${a}`);
      w(`  unspaced ${tag(b)} (main ${tagMain(b)}) << ${b}`);
    }
  });

  it("G: care lane and safety not stolen by the new leading gate", () => {
    const texts = [
      "예산 때문에 너무 힘들어",
      "예산 짜줘. 요즘 다 그만두고 싶어.",
      "예산 정리해줘. 나 요즘 아무것도 하기 싫고 그냥 다 놓고 싶어.",
      "예산 좀 봐줘. 남편이 어제 나를 밀쳤어.",
      "예산 짜줘. 대출 받아야 할 것 같아.",
    ];
    w("\r\n===== G: care/safety");
    for (const t of texts) w(`  ${tag(t)} (main ${tagMain(t)}) << ${t}`);
  });
});
