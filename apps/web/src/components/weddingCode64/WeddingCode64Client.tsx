"use client";

// 웨딩코드 wc64(64문항) 화면 흐름: 시작 → 식 질문 → 묶음 안내·문장 → 결과.
// 답은 이 브라우저 안에서만 계산하고, 저장은 wc64/io 함수로만 한다.
// 주소(해시 포함)와 방문 기록은 바꾸지 않는다. 판 라우터가 해시를 보고 다른 판으로 바꾸기 때문이다.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { useInsideMobileApp } from "@/hooks/useInsideMobileApp";
import {
  WC64_BANK, isWc64ItemAsked, wc64ItemById, wc64SectionAskedCount, wc64SectionById,
} from "@/lib/weddingCode/wc64/bank";
import {
  clearWc64Draft, createWc64Draft, readWc64Autosave, readWc64Draft, setWc64Autosave, writeWc64Draft,
} from "@/lib/weddingCode/wc64/io";
import { buildWc64Report, wc64ConsideredAnswers } from "@/lib/weddingCode/wc64/model";
import {
  WC64_AUTOSAVE_KEY, WC64_STORAGE_KEY, type Wc64Draft, type Wc64Plan, type Wc64Rating, type Wc64Section,
} from "@/lib/weddingCode/wc64/types";
import Compare64 from "./Compare64";
import Intro64, {
  Plan64, WC64_CLEAR_ANSWERS_LABEL, WC64_CLEAR_CONFIRM_TITLE, hasOtherWeddingCodeRecords,
} from "./Intro64";
import Question64, { Section64 } from "./Question64";
import Report64 from "./Report64";
import {
  wc64Column, wc64EmbeddedColumn, wc64EmbeddedPage, wc64Meta, wc64Page, wc64Quiet, wc64Secondary,
} from "./styles";

type Step = { type: "section"; sid: string } | { type: "item"; sid: string; id: string };

/**
 * 묶음 순서대로 [묶음 안내, 문장…]을 늘어놓은 흐름. draft.cursor 는 이 배열의 자리다.
 * 안내 카드를 내지 않는 묶음(hasSectionCard 가 false)도 자리는 남겨 두고 isVisible 에서 건너뛴다.
 * 그래야 저장해 둔 기록의 cursor 가 가리키는 문장이 바뀌지 않는다.
 */
const STEPS: readonly Step[] = WC64_BANK.order.flatMap((sid): Step[] => {
  const sec = wc64SectionById(sid);
  if (!sec) return [];
  return [{ type: "section", sid }, ...sec.items.map((it): Step => ({ type: "item", sid, id: it.id }))];
});

/** 고른 칸이 눌린 것을 보여 주는 시간 */
const PICK_DELAY_MS = 160;

type Flow = Pick<Wc64Draft, "plan" | "skipped">;

function sectionOf(sid: string): Wc64Section {
  return wc64SectionById(sid) as Wc64Section;
}

/**
 * 이 묶음에 안내 카드 화면을 두는가. 안내 문장(intro)이 있거나 묶음 넘기기(skip_all)를 고를 자리가 있을 때만 둔다.
 * 제목뿐인 카드는 한 번 더 누르게만 하므로 빼고, 묶음 제목은 문장 화면 머리말(Question64 의 꼬리표)로만 보인다
 * (2026-10-17 상품 심사 UX-4).
 */
function hasSectionCard(sec: Wc64Section): boolean {
  return Boolean(sec.intro) || Boolean(sec.skip_all);
}

/**
 * 지금 흐름에서 보이는 단계인지. 묻는 문장 규칙은 은행의 isWc64ItemAsked 하나다(CQ-4).
 * 안내 카드는 카드를 두는 묶음이고 식 계획 때문에 빠지지 않는 문장이 남을 때만 보인다(wc64SectionAskedCount).
 */
function isVisible(step: Step, flow: Flow): boolean {
  if (step.type === "item") return isWc64ItemAsked(step.id, flow.plan, flow.skipped ?? {});
  return hasSectionCard(sectionOf(step.sid)) && wc64SectionAskedCount(step.sid, flow.plan) > 0;
}

/** 지금 보이는 문장 수와 그중 답한(해당 없음 포함) 수 */
function countVisible(draft: Wc64Draft): { done: number; total: number } {
  let done = 0, total = 0;
  for (const step of STEPS) {
    if (step.type !== "item" || !isVisible(step, draft)) continue;
    total++;
    if (draft.answers[step.id] !== undefined) done++;
  }
  return { done, total };
}

/** 보이지 않는 단계를 건너뛰며 앞뒤로 옮긴다. 맨 앞을 넘으면 식 질문, 맨 뒤를 넘으면 결과. */
function moveDraft(draft: Wc64Draft, from: number, delta: 1 | -1): Wc64Draft {
  let j = from + delta;
  while (j >= 0 && j < STEPS.length && !isVisible(STEPS[j], draft)) j += delta;
  if (j < 0) return { ...draft, screen: "plan", cursor: 0 };
  if (j >= STEPS.length) return { ...draft, screen: "result", cursor: STEPS.length - 1 };
  return { ...draft, screen: "questions", cursor: j };
}

/**
 * 앞 문장으로 돌아갔을 때 건너뛸 자리(답하던 곳). 지금 자리 뒤에서 아직 답하지 않은 첫 문장이고, 그 문장이 묶음의 첫 문장이면
 * 그 묶음의 안내 카드다(묶음 넘기기를 고를 자리를 건너뛰지 않게). 뒤에 빈 문장이 없고 앞에도 없으면 결과(STEPS.length)다.
 * 다음 한 걸음이 곧 그 자리면 건너뛸 것이 없으므로 null. 그래서 처음 답해 나가는 동안(답한 문장이 앞에만 있을 때)에는
 * 묶음의 마지막 문장에서도 버튼이 생기지 않는다.
 */
function jumpTarget(draft: Wc64Draft): number | null {
  if (draft.screen !== "questions") return null;
  const unanswered = (j: number) => {
    const s = STEPS[j];
    return s.type === "item" && isVisible(s, draft) && draft.answers[s.id] === undefined;
  };
  let target = STEPS.length;
  for (let j = draft.cursor + 1; j < STEPS.length; j++) {
    if (unanswered(j)) { target = j; break; }
  }
  if (target === STEPS.length) {
    for (let j = 0; j <= draft.cursor; j++) if (unanswered(j)) return null;
  } else {
    let before = target - 1;
    while (before > draft.cursor && !isVisible(STEPS[before], draft)) before--;
    if (before > draft.cursor && STEPS[before].type === "section") target = before;
  }
  const next = moveDraft(draft, draft.cursor, 1);
  const nextAt = next.screen === "result" ? STEPS.length : next.cursor;
  return target > nextAt ? target : null;
}

/** 이어 할 기록을 지금 흐름에 맞게 고친다(식 답이 없으면 식 질문부터, 안 보이는 자리면 다음 자리로). */
function normalize(draft: Wc64Draft): Wc64Draft {
  const d: Wc64Draft = { ...draft, skipped: draft.skipped ?? {} };
  if (d.plan === null) return { ...d, screen: "plan", cursor: 0 };
  if (d.screen === "intro") {
    // 풀다가 시작 화면까지 돌아온 기록: 자리가 맨 앞으로 돌아가 있으므로 아직 답하지 않은 첫 문장에서 잇는다.
    const at = STEPS.findIndex((s) => s.type === "item" && isVisible(s, d) && d.answers[s.id] === undefined);
    if (at >= 0) return { ...d, screen: "questions", cursor: at };
    return moveDraft(d, -1, 1);
  }
  if (d.screen === "questions") {
    const at = Math.min(Math.max(d.cursor, 0), STEPS.length - 1);
    return isVisible(STEPS[at], d) ? { ...d, cursor: at } : moveDraft(d, at, 1);
  }
  return d;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** 답이나 식 계획이 하나라도 있는 기록인지. 빈 기록은 저장소에 쓰지 않는다(저장된 답을 빈 기록으로 덮지 않게). */
function hasProgressIn(draft: Wc64Draft): boolean {
  return draft.plan !== null || Object.keys(draft.answers).length > 0;
}

/** 답이나 결과를 지우기 전에 한 번 묻는 일 */
type ConfirmKind = "start" | "restart" | "clear";

type ConfirmDialogComponent = typeof import("@/components/wedding-code/v40/RestartBlock").ConfirmDialog;

/**
 * 64문항 지우기가 남겨 두는 것. 이 브라우저에 다른 판 웨딩코드 기록이 있을 때만 확인 창과 상태 줄에 붙인다(M3).
 * 옛 문장 '이 버튼으로 지우지 않아서'는 주어가 흐렸다(2026-10-17 점검). 판 이름은 처리방침과 같은 '36문항·v3.1'이다.
 */
const OTHER_RECORDS_KEPT = "이전 판 웨딩코드(36문항·v3.1) 답은 이 버튼으로 지워지지 않고 그대로 남아요.";

/**
 * 확인 창 문구. 몇 문장을 답했는지와 결과까지 갔는지에 따라 지워지는 것을 적는다.
 * otherKept 는 이 브라우저에 다른 판 웨딩코드 기록이 있는지(지우기 창에만 쓴다).
 */
function confirmCopy(kind: ConfirmKind, done: number, total: number, finished: boolean, otherKept = false) {
  const lost = finished ? `지금 결과와 고른 답(${done}/${total})이` : `지금까지 고른 답(${done}/${total})이`;
  const sentCode = finished ? " 이미 보낸 답 코드는 받은 사람에게 남아 있어요." : "";
  if (kind === "start") {
    // '이전' 버튼은 이 창이 아니라 다음 화면(식 질문)에 있다. 언제 지워지고 어디서 '이전'을 누르는지 차례대로 적는다(2026-10-17 점검).
    return {
      title: "새로 시작할까요?",
      body: `새로 시작을 누르면 식 질문으로 가요. 거기서 식 계획을 고르면 ${lost} 이 브라우저에서 지워져요. 고르기 전에 ‘이전’을 누르면 답은 그대로 남아요.${sentCode}`,
      confirmLabel: "새로 시작",
      cancelLabel: "그대로 두기",
    };
  }
  if (kind === "restart") {
    return {
      title: "처음부터 다시 할까요?",
      body: `${lost} 이 브라우저에서 지워지고, 지운 뒤에는 되돌릴 수 없어요.${sentCode}`,
      confirmLabel: "지우고 다시 하기",
      cancelLabel: "그대로 두기",
    };
  }
  return {
    title: WC64_CLEAR_CONFIRM_TITLE,
    body: `${lost} 이 브라우저에서 지워지고 첫 화면으로 돌아가요. 지운 답은 되돌릴 수 없어요.${sentCode}${otherKept ? ` ${OTHER_RECORDS_KEPT}` : ""}`,
    confirmLabel: "지우기",
    cancelLabel: "그대로 두기",
  };
}

type StorageLike = Storage;

/** localStorage 를 꺼낼 때 예외가 나는 브라우저(사이트 데이터 차단 등)도 있다. */
function storageOrNull(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function focusScreen() {
  try {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    window.scrollTo({ top: 0, left: 0, behavior: reduce ? "instant" : "smooth" });
  } catch { /* 스크롤을 못 해도 화면은 그대로 쓸 수 있다. */ }
  document.querySelector<HTMLElement>("[data-wc64-focus]")?.focus({ preventScroll: true });
}

/** 라운지 안: 창 맨 위가 아니라 이 화면의 틀로 스크롤하고, 초점은 틀 안의 제목에만 준다. */
function focusEmbeddedScreen(root: HTMLElement | null) {
  if (!root) return;
  try {
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    root.scrollIntoView?.({ block: "start", behavior: reduce ? "instant" : "smooth" });
  } catch { /* 스크롤을 못 해도 화면은 그대로 쓸 수 있다. */ }
  root.querySelector<HTMLElement>("[data-wc64-focus]")?.focus({ preventScroll: true });
}

export default function WeddingCode64Client({ embedded = false, introExtra }: {
  /** 로그인한 라운지 안에 넣을 때. 문서의 main 은 앱 껍데기가 맡고, 첫 화면에서는 스크롤과 초점을 옮기지 않는다. */
  embedded?: boolean;
  /** 시작 화면의 버튼 열 끝에 덧붙일 것 */
  introExtra?: ReactNode;
} = {}) {
  const [draft, setDraft] = useState<Wc64Draft>(() => createWc64Draft());
  const [saved, setSaved] = useState<Wc64Draft | null>(null);
  const [loaded, setLoaded] = useState(false);
  /** 시작하거나 이어 한 뒤부터만 저장한다(시작 화면의 빈 기록으로 저장된 답을 덮지 않는다). */
  const [active, setActive] = useState(false);
  const [autosave, setAutosave] = useState(false);
  const [canStore, setCanStore] = useState(true);
  const [status, setStatus] = useState("");
  const [locked, setLocked] = useState(false);
  /** 앱 웹뷰 안이면 처리방침 링크를 새 창으로 열지 않는다(M2). 서버 렌더와 첫 그림에서는 늘 false 다. */
  const insideApp = useInsideMobileApp();
  /** 지우기 확인 창을 열 때 본, 이 브라우저에 다른 판 웨딩코드 기록이 있는지 */
  const [otherKept, setOtherKept] = useState(false);
  const timer = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  /** 라운지 안에서 아직 화면이 한 번도 바뀌지 않았는지(첫 화면에서는 읽던 자리와 초점을 그대로 둔다) */
  const embeddedFirstScreen = useRef(true);
  /** 지금 열린 확인 창과, 그 창을 연 버튼(취소하면 초점을 돌려준다) */
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const confirmFrom = useRef<HTMLElement | null>(null);
  /** 확인 창은 누를 때 처음 불러온다(v4 화면 문구가 이 화면 묶음에 실리지 않게). */
  const [Dialog, setDialog] = useState<ConfirmDialogComponent | null>(null);
  /**
   * 시작 화면에서 이어 할 기록: 이번에 풀던 답이 있으면 그것, 없으면 불러온 기록.
   * 새로 시작한 뒤 식 계획을 고르기 전까지는 앞 기록이 그대로 남아 있다(저장소에도 쓰지 않는다).
   */
  const hasProgress = hasProgressIn(draft);
  const resumable: Wc64Draft | null = active && hasProgress ? draft : saved;

  useEffect(() => {
    // 브라우저 저장은 첫 화면을 그린 뒤에 읽는다(서버 화면과 어긋나지 않게).
    const frame = window.requestAnimationFrame(() => {
      const storage = storageOrNull();
      if (!storage) {
        setCanStore(false);
        setStatus("이 브라우저에서는 답을 저장하기 어려워요. 지금 탭에서는 계속 풀 수 있어요.");
      } else {
        const on = readWc64Autosave(storage);
        setAutosave(on);
        setSaved(on ? readWc64Draft(storage) : null);
      }
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);

  /*
   * 다른 탭이나 창이 64문항 기록을 바꾸면(storage 이벤트는 바꾼 탭이 아닌 다른 탭에만 온다) 저장소를 다시 읽는다(재판정 blocker).
   * - 이 탭이 시작 화면이면 이어 하기 기록만 새로 읽는다.
   * - 이 탭이 풀던 중이고 자동 저장이 켜져 있으면 멈추고 첫 화면으로 돌아간다. 그대로 두면 이 탭의 옛 기록이 다음 저장 때 다른 탭이
   *   더 답한 기록을 덮거나(탭 B 의 이어 하기가 탭 A 의 30/64 를 10/64 로), 다른 탭에서 지운 답을 되살렸다('이전'만 눌러도).
   * - 다른 탭이 자동 저장을 끄면 이 탭도 쓰지 않으니(writeWc64Draft 가 꺼짐을 다시 읽는다) 지금 화면의 답은 그대로 둔다.
   */
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== null && e.key !== WC64_STORAGE_KEY && e.key !== WC64_AUTOSAVE_KEY) return;
      const storage = storageOrNull();
      if (!storage || (e.storageArea !== null && e.storageArea !== storage)) return;
      const on = readWc64Autosave(storage);
      const latest = on ? readWc64Draft(storage) : null;
      setAutosave(on);
      setSaved(latest);
      if (!active) return;
      if (!on) {
        if (e.key === WC64_AUTOSAVE_KEY) {
          setStatus(`다른 탭이나 창에서 자동 저장을 꺼서 저장한 답을 지웠어요.${hasProgressIn(draft) ? " 지금 화면의 답은 남아 있어요." : ""}`);
        }
        return;
      }
      if (e.key === WC64_AUTOSAVE_KEY) return;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = null;
      setLocked(false);
      setConfirm(null);
      setActive(false);
      setDraft(createWc64Draft());
      setStatus(!latest
        ? "다른 탭이나 창에서 64문항 답을 지워서 첫 화면으로 돌아왔어요."
        : latest.screen === "result"
          ? "다른 탭이나 창에서 64문항 답이 바뀌어 첫 화면으로 돌아왔어요. ‘내 결과 다시 보기’를 누르면 가장 최근 결과를 볼 수 있어요."
          : "다른 탭이나 창에서 64문항 답이 바뀌어 첫 화면으로 돌아왔어요. ‘이어 하기’를 누르면 가장 최근 답을 불러와요.");
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [active, draft]);

  // 진행 저장: 자동 저장이 켜져 있을 때만 io 가 쓴다.
  // 저장 시각은 draft.updatedAt 그대로 쓴다. 이 값은 답·식 계획을 고르거나 묶음을 넘길 때(update 의 stamp)와 start·restart 에서만
  // 새로 찍힌다. 이어 하기, 이전·다음·답하던 곳으로 이어 가기·마지막 문장으로처럼 자리만 옮기는 일, 자동 저장을 다시 켜는 일로는
  // 30일 보관 기간이 늘지 않는다(2026-10-17 점검: 자리만 옮겨도 기간이 다시 시작돼 처리방침의 '읽기만으로는 늘지 않는다'와 어긋났다).
  // 자리를 옮기면 옮긴 자리는 저장하되 시각은 마지막으로 답한 때 그대로 둔다.
  // 식 계획도 답도 없는 기록은 쓰지 않는다. 그래서 '새로 시작'을 누르고 식 계획을 고르기 전에 '이전'으로 돌아가면 저장된 답이 그대로다.
  useEffect(() => {
    if (!loaded || !active || !autosave || !canStore || !hasProgressIn(draft)) return;
    const storage = storageOrNull();
    if (!storage) return;
    writeWc64Draft(storage, draft);
  }, [draft, loaded, active, autosave, canStore]);

  useEffect(() => {
    if (!loaded) return;
    if (!embedded) {
      focusScreen();
      return;
    }
    if (embeddedFirstScreen.current) {
      embeddedFirstScreen.current = false;
      return;
    }
    focusEmbeddedScreen(rootRef.current);
  }, [embedded, loaded, draft.screen, draft.cursor]);

  /** 기록을 바꾼다. stamp 는 답·식 계획을 고르거나 묶음을 넘긴 일일 때만 true(저장 시각을 새로 찍는다). 자리만 옮기면 false. */
  const update = useCallback((fn: (d: Wc64Draft) => Wc64Draft, stamp = false) => {
    setDraft((d) => {
      const next = fn(d);
      return stamp ? { ...next, updatedAt: nowIso() } : next;
    });
  }, []);

  function start() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setLocked(false);
    setStatus("");
    // 앞 기록은 식 계획을 고를 때까지 이어 할 기록으로 남겨 둔다.
    setSaved(resumable);
    setDraft({ ...createWc64Draft(), screen: "plan" });
    setActive(true);
  }

  /** 지우는 일 앞에 확인 창을 연다. 지울 것이 없으면 묻지 않고 바로 한다. */
  function ask(kind: ConfirmKind) {
    const target = kind === "restart" ? draft : resumable;
    if (!target || !hasProgressIn(target)) {
      if (kind === "start") start();
      else if (kind === "restart") restart();
      else clearAnswers(false);
      return;
    }
    confirmFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOtherKept(kind === "clear" && hasOtherWeddingCodeRecords());
    setConfirm(kind);
    if (Dialog) return;
    import("@/components/wedding-code/v40/RestartBlock")
      .then((m) => setDialog(() => m.ConfirmDialog))
      .catch(() => {
        // 창을 못 열면 아무것도 지우지 않는다.
        setConfirm(null);
        setStatus("확인 창을 열지 못해서 지우지 않았어요. 잠시 뒤 다시 눌러 주세요.");
      });
  }

  function cancelConfirm() {
    setConfirm(null);
    confirmFrom.current?.focus();
  }

  function acceptConfirm() {
    const kind = confirm;
    setConfirm(null);
    if (kind === "start") start();
    else if (kind === "restart") restart();
    else if (kind === "clear") {
      // 이미 시작 화면이면 화면이 바뀌지 않아 초점이 옮겨지지 않는다. 누른 버튼으로 돌려주고, 결과는 상태 줄이 읽어 준다.
      const stays = draft.screen === "intro";
      clearAnswers(true);
      if (stays) confirmFrom.current?.focus();
    }
  }

  function jump() {
    update((d) => {
      const target = jumpTarget(d);
      if (target === null) return d;
      return target >= STEPS.length ? { ...d, screen: "result", cursor: STEPS.length - 1 } : { ...d, screen: "questions", cursor: target };
    });
  }

  function resume() {
    // 이 탭이 들고 있는 기록이 아니라 저장소의 기록에서 잇는다. 다른 탭이 그사이 더 답했거나 지웠을 수 있다(재판정 blocker).
    // 풀던 중 시작 화면으로 돌아온 경우(active 이고 답이 있다)는 지금 기록이 곧 저장한 기록이라 그대로 쓴다.
    let target = resumable;
    const storage = storageOrNull();
    if (!(active && hasProgress) && storage && autosave) {
      target = readWc64Draft(storage);
      setSaved(target);
    }
    if (!target) {
      setStatus("이 브라우저에 이어 할 64문항 답이 없어요.");
      return;
    }
    setStatus("");
    // 저장본의 마지막 저장 시각을 그대로 둔다(읽거나 다시 열기만 해서는 기간을 늘리지 않는다).
    setDraft(normalize(target));
    setActive(true);
  }

  function pickPlan(plan: Wc64Plan) {
    update((d) => moveDraft({ ...d, plan }, -1, 1), true);
  }

  function back() {
    update((d) => {
      if (d.screen === "plan") return { ...d, screen: "intro" };
      if (d.screen === "result") return moveDraft(d, STEPS.length, -1);
      return moveDraft(d, d.cursor, -1);
    });
  }

  function forward() {
    update((d) => moveDraft(d, d.cursor, 1));
  }

  function beginSection(sid: string) {
    update((d) => {
      const skipped = { ...(d.skipped ?? {}) };
      delete skipped[sid];
      return moveDraft({ ...d, skipped }, d.cursor, 1);
    });
  }

  function skipSection(sid: string) {
    update((d) => {
      const answers = { ...d.answers };
      for (const it of sectionOf(sid).items) answers[it.id] = 0;
      return moveDraft({ ...d, answers, skipped: { ...(d.skipped ?? {}), [sid]: true } }, d.cursor, 1);
    }, true);
  }

  function pick(itemId: string, value: Wc64Rating) {
    if (locked) return;
    setLocked(true);
    update((d) => ({ ...d, answers: { ...d.answers, [itemId]: value } }), true);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      setLocked(false);
      forward();
    }, PICK_DELAY_MS);
  }

  function notApplicable(itemId: string) {
    if (locked) return;
    update((d) => moveDraft({ ...d, answers: { ...d.answers, [itemId]: 0 } }, d.cursor, 1), true);
  }

  function restart() {
    const storage = storageOrNull();
    if (storage) clearWc64Draft(storage);
    setSaved(null);
    setDraft({ ...createWc64Draft(), screen: "plan" });
    setActive(true);
  }

  /**
   * 64문항 기록만 지운다(io.ts 의 clearWc64Draft 는 wc64 키 하나만 지운다). 다른 판 기록은 건드리지 않고,
   * 그 기록이 있으면 상태 줄이 남아 있다고 함께 말한다(M3).
   * had 가 false 면 지울 64문항 답이 없던 경우다(확인 창 없이 바로 온다). 그때는 '지웠어요'라고 하지 않는다.
   * 저장소를 쓸 수 없거나 자동 저장이 꺼져 있으면 이 브라우저에 남긴 답이 없고 지금 화면의 답만 있었다. 그때 '저장한 답을 지웠어요'나
   * '지우지 못했어요'라고 하지 않는다(2026-10-17 점검). 실패 문장은 저장소에서 지우기가 실제로 실패했을 때만 쓴다.
   */
  function clearAnswers(had: boolean) {
    const storage = storageOrNull();
    const ok = storage ? clearWc64Draft(storage) : false;
    setSaved(null);
    setActive(false);
    setDraft(createWc64Draft());
    const kept = hasOtherWeddingCodeRecords() ? ` ${OTHER_RECORDS_KEPT}` : "";
    if (!had && (ok || !storage)) setStatus(`저장한 64문항 답은 없어요.${kept}`);
    else if (!storage) setStatus(`지금 화면의 답을 지웠어요. 이 브라우저에는 저장된 답이 없었어요.${kept}`);
    else if (ok && !autosave) setStatus(`지금 화면의 답을 지웠어요.${kept}`);
    else if (ok) setStatus(`이 브라우저에 저장한 64문항 답을 지웠어요.${kept}`);
    else setStatus("저장한 64문항 답을 지우지 못했어요. 브라우저의 사이트 데이터 설정에서 확인해 주세요.");
  }

  function toggleAutosave(on: boolean) {
    const storage = storageOrNull();
    const ok = storage ? setWc64Autosave(storage, on) : false;
    setAutosave(on && ok);
    // 끄기는 꺼짐을 먼저 남기고 답을 지운다(io.ts setWc64Autosave). 지우기가 실패하면 답이 남았을 수 있어, 확인하기 전에는
    // 이어 하기 기록을 비우지 않고 저장소에 남은 기록을 다시 읽어 둔다(2026-10-17 점검).
    if (!on) setSaved(ok || !storage ? null : readWc64Draft(storage));
    const offButNotCleared = !on && !ok && storage !== null && !readWc64Autosave(storage);
    setStatus(ok
      ? (on ? "이 브라우저에 자동 저장을 켰어요." : "저장한 답을 지우고 자동 저장을 껐어요. 지금 화면의 답은 남아 있어요.")
      : offButNotCleared
        ? "자동 저장은 껐지만 저장한 답을 지우지 못했을 수 있어요. 브라우저의 사이트 데이터 설정에서 지워 주세요."
        : "브라우저 저장 설정을 바꾸지 못했어요. 자동 저장은 멈췄어요.");
  }

  const considered = useMemo(
    () => wc64ConsideredAnswers(draft.answers, draft.plan),
    [draft.answers, draft.plan],
  );
  const report = useMemo(
    () => (draft.screen === "result" ? buildWc64Report(draft.answers, draft.plan, draft.skipped ?? {}) : null),
    [draft.screen, draft.answers, draft.plan, draft.skipped],
  );
  const progress = countVisible(draft);
  const savedProgress = resumable ? { ...countVisible(resumable), finished: resumable.screen === "result" } : null;
  const jumpAt = jumpTarget(draft);
  const jumpProp = jumpAt === null ? undefined : {
    label: jumpAt >= STEPS.length ? "결과로 돌아가기" : "답하던 곳으로 이어 가기",
    onJump: jump,
  };
  const confirmTarget = confirm === "restart" ? draft : resumable;
  const confirmText = confirm && confirmTarget
    ? (() => {
      const { done, total } = countVisible(confirmTarget);
      return confirmCopy(confirm, done, total, confirmTarget.screen === "result", otherKept);
    })()
    : null;

  let screen: ReactNode = null;
  if (!loaded) {
    screen = <p className="mt-8" role="status">저장된 답을 확인하고 있어요.</p>;
  } else if (draft.screen === "intro") {
    screen = <Intro64 saved={savedProgress} onStart={() => ask("start")} onResume={resume} embedded={embedded} extra={introExtra} />;
  } else if (draft.screen === "plan" || draft.plan === null) {
    screen = <Plan64 plan={draft.plan} onPick={pickPlan} onBack={back} />;
  } else if (draft.screen === "questions") {
    const step = STEPS[draft.cursor];
    if (step?.type === "section") {
      const sec = sectionOf(step.sid);
      screen = (
        <Section64 key={`s-${sec.id}`} section={sec} count={wc64SectionAskedCount(sec.id, draft.plan)} progress={progress}
          onBack={back} onStart={() => beginSection(sec.id)}
          onSkipAll={sec.skip_all ? () => skipSection(sec.id) : undefined} jump={jumpProp} />
      );
    } else if (step?.type === "item") {
      const item = wc64ItemById(step.id);
      if (item) {
        screen = (
          <Question64 key={`i-${item.id}`} item={item} section={sectionOf(step.sid)} answer={draft.answers[item.id]}
            locked={locked} progress={progress} onPick={(v) => pick(item.id, v)}
            onNotApplicable={() => notApplicable(item.id)} onBack={back} jump={jumpProp} />
        );
      }
    }
  } else if (draft.screen === "result" && report && draft.plan) {
    screen = (
      <div className="mt-3 flex min-w-0 flex-col gap-4" data-wc64-screen="result">
        <Report64 report={report} answers={considered} plan={draft.plan} skipped={draft.skipped ?? {}} embedded={embedded}
          compareSlot={<Compare64 myAnswers={considered} myPlan={draft.plan} mySkipped={draft.skipped ?? {}} />}
          onRestart={() => ask("restart")} onClearAnswers={() => ask("clear")} />
        <div>
          <Button type="button" variant="secondary" size="md" onClick={back} className={wc64Secondary}>마지막 문장으로</Button>
        </div>
      </div>
    );
  }

  // 라운지 안에서는 앱 껍데기가 main 을 이미 그리므로 div 로 둔다(문서의 main 은 하나).
  const Root = embedded ? "div" : "main";
  return (
    <Root ref={rootRef} className={embedded ? wc64EmbeddedPage : wc64Page} data-wedding-code-version={WC64_BANK.meta.version}
      data-wc64-embedded={embedded ? "" : undefined}>
      <div className={embedded ? wc64EmbeddedColumn : wc64Column}>
        {screen}
        {/* 상태 줄은 늘 그려 두고 글만 바꾼다(처음부터 있던 알림 칸이어야 스크린리더가 바뀐 글을 읽는다). */}
        <p className={status ? `mt-6 ${wc64Meta}` : wc64Meta} role="status" aria-live="polite" data-wc64-status>{status}</p>
        {loaded && draft.screen !== "result" ? (
          <section className="mt-10 border-t border-[#E2DED2] pt-5" aria-label="이 브라우저의 답 저장">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-[#5A4742]">
              <input type="checkbox" checked={autosave} disabled={!canStore}
                onChange={(e) => toggleAutosave(e.target.checked)} className="size-5 accent-[#8F6662]" />
              이 브라우저에 내 답 자동 저장
            </label>
            {/*
              자동 저장이 꺼져 있거나 저장소를 쓸 수 없으면(체크 칸이 비었거나 막혀 있으면) 아무것도 남기지 않으므로 30일 이어 하기를 말하지 않는다.
              30일은 마지막으로 답한 때부터다(자리만 옮겨서는 늘지 않는다, update 의 stamp). 라운지 계정 안내는 '이 브라우저에 저장'을
              두 번 말하지 않게 한 문장으로 잇는다(2026-10-17 점검).
            */}
            <p className={`mt-1 ${wc64Meta}`} data-wc64-autosave-note={autosave ? "on" : "off"}>
              {autosave
                ? "답은 이 브라우저에만 두고, 마지막으로 답한 때부터 30일 동안 이어 할 수 있어요. 서버로 보내지 않아요. 끄면 저장한 답을 바로 지워요."
                : "자동 저장이 꺼져 있어 답을 이 브라우저에 남기지 않아요. 이 탭을 닫으면 지금 답은 사라져요."}
              {embedded ? (
                <>
                  {" "}로그인해 있어도 계정에는 저장하지 않고 아모라에도 넘기지 않아요.
                  {autosave ? " 로그아웃해도 이 브라우저에 남아서, 같은 브라우저에서 다른 계정으로 로그인한 사람도 볼 수 있어요." : ""}
                  {" "}자세한 내용은{" "}
                  {/*
                    앱 웹뷰에는 새 창이 없다(webview.tsx 에 onOpenWindow 가 없다). iOS 는 같은 웹뷰에서 처리방침이 이 화면을 덮고
                    안드로이드는 시스템 브라우저로 나간다. 그래서 앱 안에서는 링크를 두지 않고 이름만 적는다(앱의 내 정보·설정에
                    처리방침이 있다). 2026-10-17 상품 심사 M2.
                  */}
                  {insideApp ? "개인정보 처리방침" : (
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" data-wc64-privacy
                      className="py-2 font-semibold text-[#3A2A27] underline underline-offset-4">개인정보 처리방침</a>
                  )}에 있어요.
                </>
              ) : null}
            </p>
            <Button type="button" variant="secondary" size="md" onClick={() => ask("clear")} aria-haspopup="dialog"
              className={`mt-1 ${wc64Quiet} px-0!`} data-wc64-clear>
              {WC64_CLEAR_ANSWERS_LABEL}
            </Button>
          </section>
        ) : null}
        {confirm && Dialog && confirmText ? (
          <Dialog title={confirmText.title} body={confirmText.body} confirmLabel={confirmText.confirmLabel}
            cancelLabel={confirmText.cancelLabel} onConfirm={acceptConfirm} onCancel={cancelConfirm} />
        ) : null}
      </div>
    </Root>
  );
}
