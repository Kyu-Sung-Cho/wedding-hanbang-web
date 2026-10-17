"use client";

// wc64 리포트. 원본 page6-shell.html 의 renderReport 를 순서 그대로 React 로 옮겼다.
// 결과 카드 → 바로 가기 → 한눈에 보기 → 이 리포트 읽는 법 → 웨딩 이해도 → 글자별 장 4개 → 유형 → 장면 → 네 글자 밖
// → (비교 자리) → 다음에 해 볼 것 → 내 답 전체 → 이 결과의 한계 → 다시 하기·답 지우기.
// 이 파일은 저장소(io)·주소 해시·fetch 를 쓰지 않는다. 바로 가기는 주소를 바꾸지 않고 그 제목으로 스크롤과 초점만 옮긴다.
// 답을 지우고 다시 하는 일은 부모가 받은 콜백으로 한다(확인 단계도 부모가 맡는다).
//
// 2026-10-16 파운더 결정:
// - DEC-1 식 없이 하면(plan "none") 결혼식 기준·돈과 마음을 싣는 곳 글자는 비워 두고 두 글자만 보인다.
//   예산 4문장은 식 계획과 상관없이 늘 글자 밖 막대로 둔다(2026-10-17 파운더 결정, DEC-7 뒤집기). 식을 전제한 줄은 report.hiddenTags("예식")로 걸러 내고, 유형 카드가 없으니 '다음에 해 볼 것'은 정한 글자 축의 '둘이 나눌 질문'에서 고른다.
//   이 선택은 화면 어디서나 '식 없이'로 부른다(공용 문구 copy.ts).
// - DEC-2 가운데 가까운 글자가 둘 이상이거나 답 모양 알림이 있으면 이름과 유형 제목은 두고 한 줄 설명과 '다음에 해 볼 것'은 접는다.
// - DEC-3 공개 결과의 할 일 제목은 '웨딩한방에서 이어 해 볼 것', 아모라 소개와 로그인 링크는 결과에 한 번(라운지는 그대로).
// - DEC-9 한계에 다루지 않는 주제 한 줄, DEC-10 유형 제목과 부제를 한 줄로.
// 2026-10-17 상품 심사: 칩 뜻 한 줄(M8), 다시 하면 바뀔 수 있다는 줄을 결과 카드에 늘(M9), 유형 한 줄은 유형 카드에만(COPY-3),
// 바로 가기는 href 없는 버튼(PRIV-4/CQ-3. 새 탭으로 열 주소가 없어 구판이 열리지 않는다).
// 2026-10-17 파운더 결정(결과 이름): report.name(형용사 + 동물, 글로만)이 있으면 결과 카드 제목의 메인이고 네 글자는 그 아래 작게,
// 유형 카드 머리도 그 이름이다. 이름이 없으면(글자가 하나라도 정해지지 않으면) 지금처럼 글자가 메인이다. 이름 둘레에 성격 풀이를 붙이지 않는다.
import type { ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK, WC64_ORDER, isWc64CeremonyOff, wc64SectionById } from "@/lib/weddingCode/wc64/bank";
import { WC64_NO_CEREMONY_LEAD, wc64NoCeremonyNotAskedText } from "@/lib/weddingCode/wc64/copy";
import { isWc64Rating, wc64AnswerSide, wc64ConsideredAnswers, wc64NextSteps, wc64TypeCopy } from "@/lib/weddingCode/wc64/model";
import type {
  Wc64Answers, Wc64DimId, Wc64DimResult, Wc64Fund, Wc64FundCopy, Wc64Plan, Wc64Report, Wc64Skipped,
} from "@/lib/weddingCode/wc64/types";
import AxisBar64 from "./AxisBar64";
import { WC64_CLEAR_ANSWERS_LABEL } from "./Intro64";
import Knowledge64 from "./Knowledge64";
import LetterChapter64 from "./LetterChapter64";
import Scenes64 from "./Scenes64";
import TypeCard64 from "./TypeCard64";
import {
  LEVEL_TEXT, POS_TEXT, WC64_REFERENCE_FOLD_LABEL, WC64_UNDECIDED_TEXT, bodyClass, cardClass, foldClosedText, foldOpenText, h2Class, h3Class, isShaky,
  kickerClass, levelChipClass, linkClass, listClass, metaClass, noteClass, quoted, secondaryButtonClass, summaryClass,
  wc64NameClass, wc64NameLettersClass, wc64OutsideTitle, wc64TypeTitle,
} from "./reportStyles";
import { wc64Notice } from "./styles";

/** 결과 화면에 한 번 두는 고지 */
export const WC64_RESULT_NOTICE = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";
/** 두 사람 비교 카드 제목 id(Compare64 가 단다) */
export const WC64_COMPARE_TITLE_ID = "wc64-compare-title";
/** 바로 가기에서 비교 칸을 부르는 이름. 비교 칸 제목·공유 글과 같은 이름을 쓴다. */
export const WC64_COMPARE_JUMP_LABEL = "둘이 같이 보기";
/**
 * 막대 아래 가운데 말(글자 단단함) 뜻 한 줄(2026-10-17 심사 M8·COPY-5). 단단함 단계는 %를 보지 않고 다시 계산한 결과와 옮겨야 할
 * 칸 수로 정해서 한 화면에 '60% 또렷해요'와 '67% 기울어 있어요'가 함께 나올 수 있다(model.ts level).
 * 재판정(2026-10-17): 옛 줄은 %가 '기울었는지'를 보여 준다고 해 놓고 바로 아래 말이 '기울어 있어요'라 앞뒤가 안 맞았고, '칩'은
 * 개발 말이었고, '%가 낮은 글자'는 양옆 % 가운데 어느 쪽인지 알 수 없었다. 그래서 %는 '어느 쪽 문장에 얼마나 더 동의했는지'로,
 * 가운데 말은 네 말을 그대로 적어 부르고, 바로 앞 줄에 따로 있던 '대충 골라도 또렷해요가 나오기도 해요'(HON-3)를 이 줄 끝에 합쳤다
 * (이웃한 두 줄이 같은 단서로 끝나 면책문처럼 읽혔다). 그래서 이 말은 결과 카드에 한 번만 나오고 한계에는 두지 않는다.
 */
export const WC64_CHIP_MEANING = `막대 아래 가운데 말(${[LEVEL_TEXT.clear, LEVEL_TEXT.lean, LEVEL_TEXT.slight, LEVEL_TEXT.half].join("·")})은 답이 얼마나 한결같은지를, 양옆 %는 어느 쪽 문장에 얼마나 더 동의했는지를 보여 줘요. 그래서 60%처럼 50에 가까운 글자에 ${quoted(LEVEL_TEXT.clear)}가 붙을 때도 있고, 문장을 대충 읽고 골라도 ${quoted(LEVEL_TEXT.clear)}가 나올 때도 있어요.`;
/**
 * 한눈에 보기에서 단단함이 큰 글자 줄의 이름(M8). 줄 순서는 단단함 순이다(model.ts glanceOf, 2026-10-17 점검).
 * 옛 이름 '답이 가장 한쪽으로 모인 글자'는 % 기울기처럼 읽혀, 위 뜻 줄('한결같은지'와 '%')과 같은 화면에서 어긋났다(재판정).
 */
export const WC64_GLANCE_STRONG_LABEL = "답이 가장 한결같은 글자";
/**
 * 네 글자 밖 카드 머리에 한 번 두는 말. 두 막대(비용 마련·예산 지키기)의 까닭 줄이 모두 이 말로 끝나 같은 카드에서 되풀이됐다(재판정).
 */
export const WC64_OUTSIDE_NOTE = "두 가지 모두 글자에는 넣지 않고 막대로만 따로 봐요.";
/**
 * 검사가 묻지 않는 주제(DEC-9). 유형 카드가 예단 이야기를 꺼내는 법을 다루기도 하므로(OLCR meets 등) '주제가 결과에 없다'가 아니라
 * '그 주제를 두고 내 생각을 묻지 않았다'로 쓴다(2026-10-16 2단계 검토).
 */
export const WC64_LIMITS_TOPICS = "예단·예물 규모, 신혼집 비용 분담, 명절, 종교, 아이 계획을 두고 어떻게 생각하는지는 묻지 않았어요. 그래서 이 결과로는 그 주제에서 내가 어느 쪽인지 알 수 없어요.";

export interface Report64Props {
  report: Wc64Report;
  answers: Wc64Answers;
  plan: Wc64Plan | null;
  /** 묶음 넘기기 상태(있으면 '내 답 전체'가 계산과 같은 답을 보여 준다) */
  skipped?: Wc64Skipped;
  /** 두 사람 비교 자리(트랙 G 의 Compare64) */
  compareSlot?: ReactNode;
  /** 라운지 안이면 앱 머리줄이 이미 h1 을 그리므로 결과 제목을 h2 로 두고, 할 일 제목과 로그인 링크는 공개 판과 다르게 둔다 */
  embedded?: boolean;
  onRestart: () => void;
  onClearAnswers: () => void;
}

type Decided = Extract<Wc64DimResult, { decided: true }>;

const SCALE = WC64_BANK.meta.scale;
const DIM_BY_ID = new Map(WC64_BANK.dims.map(d => [d.id, d]));
const dimOf = (id: Wc64DimId) => DIM_BY_ID.get(id)!;
const sideName = (r: Decided) => (r.letterSide === "X" ? dimOf(r.dim).name_a : dimOf(r.dim).name_b);
const COUNT_WORD = ["", "한", "두", "세", "네"];

/**
 * 참고로만 표시(DEC-2·FIX-11). 아슬·반반 글자가 둘 이상이거나 답 모양 알림(같은 칸 반복·동의 쪽 몰림)이 있으면 안내 문장을,
 * 아니면 null 을 돌려준다. 안내가 있으면 이름과 유형 제목은 두고 한 줄 설명과 '다음에 해 볼 것'은 접는다.
 * 같은 칸 반복(same)은 가운데 칸('반반이에요')이 몰려도 걸리므로 '한쪽으로 몰려'라고 쓰지 않는다(2026-10-16 2단계 검토).
 * 답 모양 알림 때문에 붙는 안내는 그 알림 문장을 그대로 담는다. 아래 PatternNotes 가 같은 알림을 한 번 더 말하지 않는다(2026-10-17 점검).
 */
export function wc64ReferenceNotice(report: Wc64Report): string | null {
  const decided = report.dims.filter((r): r is Decided => r.decided);
  const shaky = decided.filter(r => isShaky(r.level)).length;
  if (shaky >= 2) {
    if (shaky < decided.length) return "가운데 가까운 글자가 많아 참고로만 보세요.";
    return decided.length === 4 ? "네 글자 모두 가운데 가까이 나와 참고로만 보세요." : "정한 글자가 모두 가운데 가까이 나와 참고로만 보세요.";
  }
  const covered = noticePattern(report);
  if (covered === "same") return "같은 칸을 많이 고르셔서 참고로만 보세요.";
  if (covered === "agree") return `${PATTERN_AGREE_TEXT} 참고로만 보세요.`;
  return null;
}

/**
 * 같은 칸 반복 알림. 옛 뒷문장 '다시 해 보시면 더 또렷해질 수 있어요'는 한 줄 건너 다시 하기 줄과 '다시 하면…수 있어요'가 겹쳤고,
 * '더 또렷해질'이 가운데 말 '또렷해요'가 나온다는 약속처럼 읽혀(재판정) 뺐다. 같은 칸을 고르면 두 쪽 답이 같아져 %가 50 쪽으로 간다.
 */
const PATTERN_SAME_TEXT = "같은 칸을 많이 고르셔서 %가 50 가까이 모였을 수 있어요.";
/** 동의 쪽 몰림 알림 */
const PATTERN_AGREE_TEXT = `대부분 문장에 ${quoted(SCALE[3])}나 ${quoted(SCALE[4])}를 고르셔서 %가 50 가까이 모일 수 있어요.`;

/**
 * 참고로만 안내가 이미 말한 답 모양 알림. 가운데 가까운 글자가 둘 이상이라 안내가 그 말을 하면 알림은 아무것도 담지 않으므로 null.
 * 같은 칸 반복이 동의 쪽 몰림보다 먼저다(둘 다면 같은 칸 반복을 안내에 담고, 동의 쪽 몰림은 PatternNotes 가 따로 말한다).
 */
function noticePattern(report: Wc64Report): "same" | "agree" | null {
  const decided = report.dims.filter((r): r is Decided => r.decided);
  if (decided.filter(r => isShaky(r.level)).length >= 2) return null;
  if (report.patterns.includes("same")) return "same";
  if (report.patterns.includes("agree")) return "agree";
  return null;
}

/** 주소(#)를 바꾸지 않고 그 제목으로 스크롤하고 초점을 옮긴다. */
function jumpTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  el.scrollIntoView?.({ block: "start" });
  el.focus({ preventScroll: true });
}

/**
 * 접어 두는 칸('펼쳐 보기(참고용)'). 제목은 접는 칸 밖에 둔다. 무엇을 펼치는지는 화면 읽기 프로그램에만 읽히는 글로 머리에 둔다(A11Y-4).
 * 옛 머리 '참고로 펼치기'는 '참고로(덧붙여 말하면)'로 읽혔다(2026-10-17 점검). 유형 카드(TypeCard64)도 같은 머리를 쓴다.
 */
function ReferenceFold({ what, children }: { what: string; children: ReactNode }) {
  return (
    <details data-wc64-reference-fold>
      <summary className={summaryClass}>
        <span className="sr-only">{what} </span>
        <span className={foldClosedText}>{WC64_REFERENCE_FOLD_LABEL}</span>
        <span className={foldOpenText}>접기</span>
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

/**
 * 답 모양 알림. 네 글자 바로 아래에 둔다(FIX-11). 참고로만 안내가 이미 담은 알림은 다시 말하지 않는다(2026-10-17 점검:
 * '같은 칸을 많이 골라 참고로만 보세요'와 '같은 칸을 많이 고르셨어요'가 한 카드에 함께 나왔다).
 */
function PatternNotes({ report }: { report: Wc64Report }) {
  const covered = noticePattern(report);
  return (
    <>
      {report.patterns.includes("same") && covered !== "same" && (
        <p className={noteClass} data-testid="wc64-pattern-same">{PATTERN_SAME_TEXT}</p>
      )}
      {report.patterns.includes("agree") && covered !== "agree" && (
        <p className={noteClass} data-testid="wc64-pattern-agree">{PATTERN_AGREE_TEXT}</p>
      )}
    </>
  );
}

/**
 * 결과 카드의 네 글자(정하지 않은 자리는 가운뎃점). 이름이 있으면 이름 아래 작은 줄에, 없으면 제목의 큰 글자로 그린다.
 * 어느 쪽이든 글자 자리 표시(data-letter-slot)·동점 점선 밑줄·빈칸 읽기는 같다.
 */
function CodeLetters({ report, small }: { report: Wc64Report; small: boolean }) {
  return (
    <>
      {report.dims.map(r =>
        r.decided
          ? (
            <span
              key={r.dim}
              data-letter-slot={r.dim}
              data-tie={r.tie ? "true" : "false"}
              className={r.tie ? `underline decoration-dotted decoration-2 ${small ? "underline-offset-4" : "underline-offset-8"}` : undefined}
            >
              {r.letter}
            </span>
          )
          : (
            // 가운뎃점은 읽어 주지 않고, 그 자리가 비었다는 것을 화면 읽기 프로그램에만 읽히는 글로 둔다(A11Y-3)
            <span key={r.dim} className="contents">
              <span data-letter-slot={r.dim} data-tie="false" aria-hidden="true" className="text-[var(--hb-text-muted)]">·</span>
              <span className="sr-only" data-letter-blank={r.dim}> 빈칸 </span>
            </span>
          ),
      )}
    </>
  );
}

function CodeCard({ report, embedded, referenceNotice }: { report: Wc64Report; embedded: boolean; referenceNotice: string | null }) {
  const t = report.type;
  const name = report.name;
  const Title = embedded ? "h2" : "h1";
  // 식 없이 해서 구조상 정할 수 없는 글자를 뺀 수(식 없이 하면 둘)
  const possible = report.dims.filter(r => r.decided || r.reason !== "no-ceremony").length;
  const decidedCount = report.dims.filter(r => r.decided).length;
  const spendDecided = report.dims.some(r => r.dim === "SPEND" && r.decided);
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[var(--hb-hairline)] border-t-2 border-t-[var(--hb-primary)] bg-[var(--hb-surface-raised)] px-5 pb-5 pt-6 sm:px-6" aria-labelledby="wc64-code">
      <p className={kickerClass}>내 웨딩코드</p>
      {name
        ? (
          // 2026-10-17 파운더 결정: 이름(형용사 + 동물)이 메인이고 네 글자(식 없이 하면 가운뎃점 자리를 둔 두 글자)는 그 아래 작게.
          // 화면 읽기 프로그램은 이 제목 하나로 이름과 웨딩코드 글자를 함께 읽는다.
          <Title id="wc64-code" data-wc64-focus data-wc64-named="true" tabIndex={-1} className="flex flex-col gap-2 outline-none">
            <span className={wc64NameClass} data-wc64-name>{name.label}</span>
            <span className={wc64NameLettersClass} data-wc64-letters>
              <span className="sr-only">, 웨딩코드 </span>
              <CodeLetters report={report} small />
            </span>
          </Title>
        )
        : (
          // 글자가 하나라도 정해지지 않으면 이름이 없고 글자가 메인이다.
          <Title
            id="wc64-code"
            data-wc64-focus
            data-wc64-named="false"
            tabIndex={-1}
            className="flex gap-1.5 font-mono text-[46px] font-semibold leading-none tracking-[0.08em] text-[var(--hb-text-strong)] outline-none sm:text-[56px]"
          >
            <span className="sr-only">웨딩코드 </span>
            <CodeLetters report={report} small={false} />
          </Title>
        )}
      {t && (
        <p className="text-base font-semibold leading-snug text-[var(--hb-text-body)]" data-testid="wc64-type-title">{wc64TypeTitle(t)}</p>
      )}
      {/* 참고로만 결과에도 이름은 두고 안내를 이름 묶음 바로 뒤에 붙인다(DEC-2, 2026-10-17 결과 이름 결정). */}
      {referenceNotice && <p className={noteClass} data-testid="wc64-reference-only">{referenceNotice}</p>}
      <p className={wc64Notice} data-testid="wc64-result-notice">{WC64_RESULT_NOTICE}</p>
      {/*
        다시 하면 바뀔 수 있다는 말은 아슬한 글자에만 붙이지 않고 늘 둔다(2026-10-17 심사 M9·HON-2). 이름이 있으면 그 이름도 바뀐다고 적는다.
        이 줄은 가운데 말(또렷해요·기울어 있어요…) 뜻 줄과 막대보다 위라, 아직 읽지 않은 '아슬한 글자'·'기울어 있는 글자'로 가르지 않고
        '어느 글자든'으로 쓴다(재판정: 또렷한 글자는 안 바뀐다는 말로도 읽혔다).
      */}
      <p className={bodyClass} data-testid="wc64-retake">
        {name
          ? "다시 하면 어느 글자든 바뀔 수 있고, 글자 하나만 바뀌어도 이름이 달라져요."
          : "다시 하면 어느 글자든 바뀔 수 있어요."}
      </p>
      {/* 가운데 말은 %가 아니라 답이 얼마나 한결같은지라, %와 엇갈려 보일 수 있다는 것을 막대 앞에 적는다(M8·COPY-5). */}
      {decidedCount > 0 && <p className={metaClass} data-testid="wc64-chip-meaning">{WC64_CHIP_MEANING}</p>}
      <div className="flex flex-col gap-3">
        {report.dims.map(r => {
          const d = dimOf(r.dim);
          const left = <><b className="font-semibold text-[var(--hb-text-strong)]">{d.letter_a}</b> {d.name_a}</>;
          const right = <>{d.name_b} <b className="font-semibold text-[var(--hb-text-strong)]">{d.letter_b}</b></>;
          if (!r.decided) {
            return (
              <div key={r.dim} className="flex flex-col gap-1.5" data-axis={r.dim} data-decided="false" data-reason={r.reason}>
                <div className="flex justify-between gap-3 text-[13px] leading-5 text-[var(--hb-text-body)]"><span>{left}</span><span className="text-right">{right}</span></div>
                <p className={metaClass}>{WC64_UNDECIDED_TEXT[r.reason]}</p>
              </div>
            );
          }
          return (
            <div key={r.dim} className="flex flex-col gap-1.5" data-axis={r.dim} data-decided="true">
              <AxisBar64 pctX={r.pctX} label={`${d.letter_a} ${d.name_a} ${r.pctX}%, ${d.letter_b} ${d.name_b} ${r.pctY}%`} left={left} right={right} />
              <div className="flex items-center justify-between gap-2 text-sm tabular-nums">
                <span data-pct-side="x"><b className="text-base">{r.pctX}</b>%</span>
                <span className={levelChipClass(r.level)}>{LEVEL_TEXT[r.level]}</span>
                <span data-pct-side="y"><b className="text-base">{r.pctY}</b>%</span>
              </div>
            </div>
          );
        })}
      </div>
      <PatternNotes report={report} />
      {/*
        예산을 어디서 보는지는 SPEND 글자를 정했을 때만 여기 적는다. 정하지 못한 SPEND 장(식 없이 하면 늘 그렇다)이 같은 말을 하므로
        한 화면에 두 번 나오지 않게 한다(2026-10-17 점검).
      */}
      <p className={metaClass} data-testid="wc64-code-meta">
        {possible < 4 ? `${WC64_NO_CEREMONY_LEAD} ` : ""}고른 답을 {COUNT_WORD[possible]} 글자로 줄였어요. 다른 사람과 비교한 점수가 아니에요.
        {spendDecided ? ` 예산을 지키는 정도는 아래 ${quoted(wc64OutsideTitle(report.plan))}에 따로 적었어요.` : ""}
      </p>
    </section>
  );
}

/**
 * 결과가 길어 결과 카드 바로 아래에 두는 바로 가기(목차)와 '둘이 같이 보기'.
 * href 없는 버튼이다: 링크로 두면 새 탭으로 열 때 답이 없는 주소가 열려 구판(v3.1)이 뜬다(2026-10-17 심사 PRIV-4/CQ-3).
 * 유형 카드가 있으면 그 카드로 가는 칸을 둔다(유형 한 줄은 유형 카드에만 둔다, COPY-3).
 */
function JumpNav({ report, hasCompare }: { report: Wc64Report; hasCompare: boolean }) {
  const links: [string, string][] = [
    ["wc64-glance", "한눈에 보기"],
    ["wc64-knowledge", "웨딩 이해도"],
    [`wc64-ch-${WC64_BANK.dims[0].id}`, "글자별 설명"],
    ...(report.type ? [["wc64-type", "네 글자가 함께 보이는 모습"] as [string, string]] : []),
    ...(report.scenes.length > 0 ? [["wc64-scenes", "결혼 준비 장면"] as [string, string]] : []),
    ["wc64-limits", "이 결과의 한계"],
  ];
  return (
    <nav aria-label="결과 안에서 바로 가기" className="flex flex-col gap-2" data-testid="wc64-jump">
      {hasCompare && (
        <button
          type="button"
          onClick={() => jumpTo(WC64_COMPARE_TITLE_ID)}
          className={`inline-flex cursor-pointer items-center justify-center self-start ${secondaryButtonClass} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-focus-ring)]`}
          data-testid="wc64-jump-compare"
          data-jump={WC64_COMPARE_TITLE_ID}
        >
          {WC64_COMPARE_JUMP_LABEL}
        </button>
      )}
      <ul className="flex flex-wrap gap-x-4 text-sm">
        {links.map(([id, label]) => (
          <li key={id}>
            <button type="button" onClick={() => jumpTo(id)} className={`inline-flex min-h-11 cursor-pointer items-center ${linkClass}`} data-jump={id}>{label}</button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * 한눈에 보기. 유형 한 줄(one_liner)은 바로 아래 유형 카드에 있어 여기서 되풀이하지 않는다(2026-10-17 심사 COPY-3).
 * 목록은 % 크기 순이 아니라 단단함 순(model glance.strong)이라 '크게 기운'이 아니라 '답이 가장 한결같은'으로 부른다(M8, 재판정).
 */
function Glance({ report }: { report: Wc64Report }) {
  const decided = report.dims.filter((r): r is Decided => r.decided);
  const byId = new Map(decided.map(r => [r.dim, r]));
  const strong = report.glance.strong.map(id => byId.get(id)).filter((r): r is Decided => !!r);
  const shaky = report.glance.shaky.map(id => byId.get(id)).filter((r): r is Decided => !!r);
  const { opposite, both } = report.glance;
  return (
    <section className={cardClass} aria-labelledby="wc64-glance">
      <h2 id="wc64-glance" className={h2Class}>한눈에 보기</h2>
      <ul className={listClass}>
        {strong.length > 0 && (
          <li data-testid="wc64-glance-strong">
            {WC64_GLANCE_STRONG_LABEL}:{" "}
            {strong.map((r, i) => (
              <span key={r.dim} data-strong={r.dim}>
                {i > 0 ? ", " : ""}<b className="font-semibold text-[var(--hb-text-strong)]">{r.letter} {sideName(r)}</b>({r.letterPct}%, {LEVEL_TEXT[r.level]})
              </span>
            ))}
          </li>
        )}
        {/* 가운데 가까운 글자는 한 줄로 모은다(글자마다 같은 꼬리를 되풀이하지 않는다). */}
        {shaky.length > 0 && (
          <li data-testid="wc64-glance-shaky">
            가운데 가까운 글자:{" "}
            {shaky.map((r, i) => (
              <span key={r.dim} data-shaky={r.dim}>
                {i > 0 ? ", " : ""}<b className="font-semibold text-[var(--hb-text-strong)]">{dimOf(r.dim).name}</b>({LEVEL_TEXT[r.level]})
              </span>
            ))}
            . 두 쪽 설명을 같이 읽어 보세요.
          </li>
        )}
        {decided.length === 0 && <li>정한 글자가 없어요.</li>}
        {opposite.length > 0 && <li>글자와 반대쪽으로 기운 묶음: {opposite.map(f => f.title).join(", ")}</li>}
        {both.length > 0 && <li>두 쪽 문장에 비슷하게 답한 묶음: {both.map(f => `${f.title}(${POS_TEXT[f.pos]})`).join(", ")}</li>}
      </ul>
    </section>
  );
}

/**
 * 제목은 접는 칸 밖(h2)에 두고, 접는 칸 머리에는 '펼치기'와 꺾쇠만 보인다. 무엇을 펼치는지는 화면 읽기 프로그램에만 읽히는
 * 글로 머리에 둔다(2026-10-17 심사 A11Y-4).
 */
function FoldCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section className={cardClass} aria-labelledby={id}>
      <h2 id={id} className={h2Class}>{title}</h2>
      <details>
        <summary className={summaryClass}>
          <span className="sr-only">{title} </span>
          <span className={foldClosedText}>펼치기</span>
          <span className={foldOpenText}>접기</span>
        </summary>
        <div className="mt-2">{children}</div>
      </details>
    </section>
  );
}

function ReadHow() {
  return (
    <FoldCard id="wc64-readhow" title="이 리포트 읽는 법">
      <div className={`flex flex-col gap-2 ${bodyClass}`}>
        <p>%는 한쪽 문장에 동의한 정도와 반대쪽 문장에 동의한 정도의 차이를 0~100으로 옮긴 값이에요. 50이 가운데이고, 100은 한쪽 문장 전부에 {quoted(SCALE[4])}, 반대쪽 전부에 {quoted(SCALE[0])}를 고른 경우예요. 같은 답이면 언제나 같은 %가 나와요.</p>
        <p>양쪽 문장을 같은 수만큼 넣고 따로 평균을 내서, 무엇이든 {quoted(SCALE[3])}나 {quoted(SCALE[4])}를 고르는 버릇은 %에서 지워져요. 다만 두 쪽이 딱 반반이면 정해 둔 순서로 한쪽 글자를 붙이고, 그 글자에 점선 밑줄을 그어요.</p>
        {/* 결과 카드의 가운데 말 뜻 줄(WC64_CHIP_MEANING)과 같은 말(막대 아래 가운데 말, 한결같은지)을 쓴다. '칩'은 개발 말이라 뺐다(재판정). */}
        <p>글자 단단함(막대 아래 가운데 말)은 답이 얼마나 한결같은지예요. 문장을 반씩 나눠 가능한 경우마다 다시 계산해 같은 글자가 몇 번 나오는지, 답을 몇 칸 바꾸면 반반이 되거나 반대 글자로 넘어가는지를 봐요. {quoted(LEVEL_TEXT.clear)}는 계산에 들어간 문장이 8개 이상일 때만 붙여요.</p>
      </div>
    </FoldCard>
  );
}

/**
 * 글자 밖 막대 하나(결혼 비용 마련, 예산 지키기). 왼쪽 끝은 늘 A 쪽(fund·budget_bar 의 a_name = 그 묶음 pole_a)이다.
 * 둘이 같이 보기(Compare64)도 글자에 붙지 않은 묶음은 pole_a 를 왼쪽에 두므로 두 화면의 좌우가 같다(2026-10-17 심사 UX-7).
 */
function OutsideBar({ title, copy, result, testId }: { title: string; copy: Wc64FundCopy; result: Wc64Fund; testId: string }) {
  return (
    <div className="flex flex-col gap-1.5" data-testid={testId}>
      <h3 className={h3Class}>{title}</h3>
      {result.decided
        ? (
          <div className="flex flex-col gap-1.5" data-testid={`${testId}-bar`}>
            <AxisBar64 pctX={result.pctA} label={`${copy.a_name} ${result.pctA}%, ${copy.b_name} ${result.pctB}%`} left={copy.a_name} right={copy.b_name} />
            <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
              <span><b className="text-base">{result.pctA}</b>%</span>
              <span className={metaClass}>문장 {result.n}개로 낸 값</span>
              <span><b className="text-base">{result.pctB}</b>%</span>
            </div>
          </div>
        )
        : <p className={metaClass}>{result.n === 0 ? "답한 문장이 없어 %를 내지 않았어요." : "한쪽 문장만 남아 %를 내지 않았어요."}</p>}
      <p className={metaClass}>{copy.why_outside}</p>
    </div>
  );
}

function OutsideCard({ report }: { report: Wc64Report }) {
  return (
    <section className={cardClass} aria-labelledby="wc64-fund">
      <h2 id="wc64-fund" className={h2Class}>{wc64OutsideTitle(report.plan)}</h2>
      {/* 두 막대 까닭 줄 끝에 따로 있던 같은 말을 카드 머리에 한 번만 둔다(재판정) */}
      <p className={metaClass} data-testid="wc64-outside-note">{WC64_OUTSIDE_NOTE}</p>
      <OutsideBar title="결혼 비용 마련" copy={WC64_BANK.fund} result={report.fund} testId="wc64-fund" />
      {/* 예산 막대는 식 계획과 상관없이 늘 둔다(2026-10-17 파운더 결정, DEC-7 뒤집기) */}
      <OutsideBar title={wc64SectionById("BUDGET")?.title ?? "예산"} copy={WC64_BANK.budget_bar} result={report.budget} testId="wc64-budget" />
    </section>
  );
}

/**
 * 다음에 해 볼 것. 유형 카드가 있으면 그 tips(넘긴 묶음 줄은 뺀다), 없으면(식 없이 하기·덜 정한 글자) 정한 글자 축의
 * '둘이 나눌 질문'에서 3개까지(wc64NextSteps). 질문은 둘이 서로 묻는 말투라 그 사실을 한 줄로 먼저 알린다.
 * 참고로만 표시일 때는 접어 둔다.
 */
function NextCard({ report, referenceOnly }: { report: Wc64Report; referenceOnly: boolean }) {
  const steps = report.type ? wc64TypeCopy(report.type, report.hiddenTags).tips : wc64NextSteps(report, 3).map(s => s.text);
  if (steps.length === 0) return null;
  const list = (
    <>
      {!report.type && <p className={bodyClass} data-testid="wc64-next-questions-lead">둘이 서로 물어볼 질문이에요.</p>}
      <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm leading-7 text-[var(--hb-text-body)]" data-testid="wc64-next-steps">
        {steps.map(x => <li key={x}>{x}</li>)}
      </ol>
    </>
  );
  return (
    <section className={cardClass} aria-labelledby="wc64-next">
      <h2 id="wc64-next" className={h2Class}>다음에 해 볼 것</h2>
      {referenceOnly ? <ReferenceFold what="다음에 해 볼 것">{list}</ReferenceFold> : list}
      {/* '2~3주 뒤 다시 해 보세요'는 글자 장의 '달라요' 안내에만 둔다(COPY-17) */}
      <p className={metaClass}>준비가 진행되면 답이 달라져도 자연스러워요.</p>
    </section>
  );
}

/**
 * 내 답 전체. 식 없이 해서 묻지 않은 문장은 한 줄로 모으고, 넘긴 묶음도 묶음마다 한 줄로 쓴다.
 * 앱이 뺀 문장을 사용자가 건너뛴 것처럼 적지 않는다. 문장 옆 자리는 결과와 같은 기준(wc64AnswerSide)으로 적는다:
 * BUDGET 은 식 계획과 상관없이 글자 쪽이 아니라 예산 막대의 쪽 이름이다.
 */
function AllAnswers({ answers, plan, skipped }: { answers: Wc64Answers; plan: Wc64Plan | null; skipped: Wc64Skipped }) {
  const rowClass = "grid grid-cols-[88px_minmax(0,1fr)] gap-2.5 border-t border-[var(--hb-hairline)] py-2";
  let notAsked = 0;
  const rows = WC64_ORDER.flatMap(sid => {
    const sec = wc64SectionById(sid);
    if (!sec) return [];
    if (skipped[sid] === true) {
      return [
        <li key={sid} className="border-t border-[var(--hb-hairline)] py-2 text-sm leading-6 text-[var(--hb-text-body)]" data-answer-skipped={sid}>
          {sec.title}: 이 묶음은 넘겼어요.
        </li>,
      ];
    }
    return sec.items.flatMap(it => {
      if (isWc64CeremonyOff(it.id, plan)) { notAsked++; return [] }
      const v = answers[it.id];
      const side = wc64AnswerSide(it.id, plan);
      const where = !side ? "" : side.kind === "knowledge" ? "이해도" : side.kind === "bar" ? side.name : `${side.letter} 쪽`;
      const label = isWc64Rating(v) ? SCALE[v - 1] : v === 0 ? "해당 없음" : "답 없음";
      return [
        <li key={it.id} className={rowClass} data-answer-item={it.id}>
          <span className="text-xs leading-6 tabular-nums text-[var(--hb-text-muted)]">{where}</span>
          <div className="text-sm leading-6 text-[var(--hb-text-body)]">
            {it.text} <span className="text-xs font-semibold text-[var(--hb-selected-text)]">{label}</span>
          </div>
        </li>,
      ];
    });
  });
  return (
    <FoldCard id="wc64-answers" title="내 답 전체">
      <ul className="flex flex-col">
        {notAsked > 0 && (
          <li className="py-2 text-sm leading-6 text-[var(--hb-text-body)]" data-answer-not-asked={notAsked}>
            {wc64NoCeremonyNotAskedText(notAsked)}
          </li>
        )}
        {rows}
      </ul>
    </FoldCard>
  );
}

/** 이 결과의 한계. 대충 골라도 또렷해요가 나올 수 있다는 말은 결과 카드의 가운데 말 뜻 줄에 한 번 있어 여기에 되풀이하지 않는다(HON-3). */
function Limits() {
  return (
    <section className="flex flex-col gap-2 rounded-xl bg-[var(--hb-surface-hover)] px-5 py-4 text-sm leading-7 text-[var(--hb-text-body)]" aria-labelledby="wc64-limits">
      <h2 id="wc64-limits" className="text-base font-semibold text-[var(--hb-text-strong)]">이 결과의 한계</h2>
      {/*
        옛 둘째 줄 '검증을 마친 검사가 아니라서 다시 하면 결과가 달라질 수 있어요'는 금지어 '검증된'과 뿌리가 같은 말로 이 도구를
        '검사'라 불렀고, 결과 카드의 고지·다시 하기 줄을 세 번째로 되풀이했다(2026-10-17 점검). 한 줄로 합쳤다.
      */}
      <p data-testid="wc64-limits-draft">아직 사람들에게 답을 받아 보지 않아서, 여러 묶음을 한 글자로 묶은 방식이 맞는지 확인하지 못했어요. %는 그날 고른 답으로 계산한 값이에요.</p>
      <p data-testid="wc64-limits-topics">{WC64_LIMITS_TOPICS}</p>
      <p>결혼 준비에서 고른 선호이지 성격 판정이나 두 사람 관계를 내다보는 결과가 아니에요. 채용, 매칭, 남에게 꼬리표 붙이기에 쓰지 말아 주세요.</p>
    </section>
  );
}

export default function Report64({ report, answers, plan, skipped, compareSlot, embedded = false, onRestart, onClearAnswers }: Report64Props) {
  const sk = skipped ?? {};
  const shown = wc64ConsideredAnswers(answers, plan);
  const referenceNotice = wc64ReferenceNotice(report);
  const referenceOnly = referenceNotice !== null;
  // 아모라 소개와 로그인 링크는 할 일이 처음 나오는 장(정한 첫 글자) 한 곳에만 둔다(DEC-3).
  const introDim = report.dims.find(r => r.decided)?.dim ?? null;
  return (
    <div
      className="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-5 break-keep text-[var(--hb-text-strong)] [overflow-wrap:anywhere] [&_h2[id]]:scroll-mt-24 md:[&_h2[id]]:scroll-mt-32"
      data-testid="wc64-report"
      data-reference-only={referenceOnly ? "true" : "false"}
    >
      <CodeCard report={report} embedded={embedded} referenceNotice={referenceNotice} />
      <JumpNav report={report} hasCompare={compareSlot != null} />
      <Glance report={report} />
      <ReadHow />
      <Knowledge64 knowledge={report.knowledge} />
      {WC64_BANK.dims.map((d, i) => {
        const r = report.dims.find(x => x.dim === d.id);
        return r
          ? (
            <LetterChapter64
              key={d.id} dim={d} result={r} index={i + 1} plan={plan} hiddenSections={report.hiddenTags}
              embedded={embedded} appIntro={d.id === introDim}
            />
          )
          : null;
      })}
      {report.type && <TypeCard64 type={report.type} code={report.code} hiddenTags={report.hiddenTags} referenceOnly={referenceOnly} />}
      {report.scenes.length > 0 && <Scenes64 scenes={report.scenes} />}
      <OutsideCard report={report} />
      {compareSlot}
      <NextCard report={report} referenceOnly={referenceOnly} />
      <AllAnswers answers={shown} plan={plan} skipped={sk} />
      <Limits />
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" size="md" onClick={onRestart} className={secondaryButtonClass}>처음부터 다시 하기</Button>
        <Button variant="secondary" size="md" onClick={onClearAnswers} className={secondaryButtonClass}>{WC64_CLEAR_ANSWERS_LABEL}</Button>
      </div>
    </div>
  );
}
