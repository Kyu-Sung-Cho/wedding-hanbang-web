import { responseAt } from "@/lib/weddingCode/v40/states";
import type {
  Bank,
  DecodedCode,
  HistoryEntry,
  PagePack,
  ProgressSnapshot,
  Responses,
  StorageLike,
  V40Result,
} from "@/lib/weddingCode/v40/types";

/**
 * 웨딩코드 4.0 클라이언트가 쓰는 순수 도우미(React 없음). 저장소 이름을 부르지 않고 값을 밖으로 보내지도 않는다.
 * 시험이 이 함수들을 따로 부를 수 있게 클라이언트 본체와 나눴다.
 */

/** 코드와 분리한 취향 2부의 주소(글자 그대로의 주소). */
export const V40_TASTE_HREF = "/wedding-code/taste";

/**
 * 결과 화면에 어떻게 들어왔나. fresh = 질문에 답하다가 마지막 질문을 넘겨 처음 들어옴(지난번 기록에 이번 결과를 남긴다),
 * return = 저장된 답을 이어 하다가, 또는 답을 고치고 결과로 돌아옴(새 기록을 남기지 않는다).
 */
export type ResultArrival = "fresh" | "return";

/**
 * 결과에서 지난번과 비교할 기록 한 건을 만든다(글자와 세기, 시각, 폼 비트만, 답은 넣지 않는다).
 * 세기는 화면에 보인 shownBand 이고, 글자를 못 정한 주제는 세기도 없다.
 */
export function historyEntryOf(result: V40Result, at: number): HistoryEntry {
  const axes = result.axes.map((axis) => ({
    letter: axis.letter,
    band: axis.letter === null ? null : axis.shownBand,
    provisional: axis.provisional,
  })) as unknown as HistoryEntry["axes"];
  return { at, formBit: result.formBit, axes };
}

/** 두 기록이 시각만 빼고 같은가(폼 비트, 글자, 세기, 임시 여부). */
export function sameHistoryResult(a: HistoryEntry | undefined, b: HistoryEntry): boolean {
  if (a === undefined || a.formBit !== b.formBit) return false;
  return a.axes.every((axis, index) => {
    const other = b.axes[index];
    return other !== undefined && axis.letter === other.letter && axis.band === other.band && axis.provisional === other.provisional;
  });
}

export interface HistoryPlan {
  /** 결과 화면 「지난번과 비교」에 줄 기록 한 건. 이번 시도의 기록이 아니라 그 앞 시도의 것이다. */
  readonly previous: HistoryEntry | null;
  /** 이번 결과를 기록에 새로 남길까. */
  readonly append: boolean;
  /** 이번 시도가 남긴 기록(가장 최근)을 답을 고친 뒤의 결과로 바꿔 쓸까. */
  readonly replace: boolean;
}

/**
 * 기록(최신이 앞)과 이번 결과로 비교할 기록과 새로 남길지를 정한다.
 * - fresh: 방금 끝낸 시도이므로 가장 최근 기록이 지난번이고, 이번 결과를 새로 남긴다.
 * - return: 이미 남긴 시도를 다시 보는 것이라 새로 남기지 않는다. 가장 최근 기록이 이번 시도의 것이면(이 화면이 남겼거나 이번 결과와 같으면)
 *   그 앞의 것이 지난번이다. 이 화면이 남긴 기록(attemptAt)인데 답을 고쳐 결과가 달라졌으면 그 기록을 고친 결과로 바꿔 쓴다.
 *   그래야 같은 시도 안에서 고친 결과와 고치기 전 결과를 「지난번」이라며 견주지 않는다.
 */
export function planHistory(entries: readonly HistoryEntry[], entry: HistoryEntry, arrival: ResultArrival, attemptAt: number | null = null): HistoryPlan {
  if (arrival === "fresh") return { previous: entries[0] ?? null, append: true, replace: false };
  const latest = entries[0];
  if (attemptAt !== null && latest !== undefined && latest.at === attemptAt) {
    return { previous: entries[1] ?? null, append: false, replace: !sameHistoryResult(latest, entry) };
  }
  if (sameHistoryResult(latest, entry)) return { previous: entries[1] ?? null, append: false, replace: false };
  return { previous: latest ?? null, append: false, replace: false };
}

/**
 * 이용 통계에 보낼 개수: 답한 질문과 넘어간 질문(잘 모르겠어요, 제 상황과 안 맞아요). 개수만이고 어떤 질문인지는 담지 않는다.
 */
export function answerCounts(bank: Bank, responses: Responses): { readonly answered: number; readonly skipped: number } {
  let answered = 0;
  let skipped = 0;
  for (const item of bank.items) {
    const value = responseAt(responses, item.id);
    if (value === undefined) continue;
    if (value === "skip" || value === "na") skipped += 1;
    else answered += 1;
  }
  return { answered, skipped };
}

/** 진행 저장에서 읽은 본인 답을 두 사람 비교에 쓰는 모양으로 바꾼다. */
export function decodedFromSnapshot(snapshot: ProgressSnapshot): DecodedCode {
  return { formBit: snapshot.formBit, responses: snapshot.responses };
}

/**
 * 읽기만 되는 저장소. 두 사람 결과 링크를 연 화면은 이 기기의 저장에 아무것도 쓰지 않는다(계약 문서 9.3절).
 * 읽기 함수가 기한이 지난 값을 지우는 일까지 여기서 막는다: 쓰기와 지우기는 아무 일도 하지 않는다.
 */
export function readOnlyStorage(storage: StorageLike): StorageLike {
  return { getItem: storage.getItem.bind(storage), setItem: () => undefined, removeItem: () => undefined };
}

/** 세로가 짧은 화면(320x568 같은 작은 휴대폰, 가로로 눕힌 휴대폰)이다. 이때는 두 문항 화면을 문항 하나씩으로 나눈다. */
const SHORT_VIEWPORT = "(max-height: 600px)";

function shortViewport(): MediaQueryList | null {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return null;
  try {
    return window.matchMedia(SHORT_VIEWPORT);
  } catch {
    return null;
  }
}

/** 지금 화면 크기에 맞는 화면 묶음. */
export function viewportPack(): PagePack {
  return shortViewport()?.matches ? "single" : "screen";
}

/** 화면 크기가 바뀌어 묶음이 달라질 때 알린다. 알림을 끊는 함수를 돌려준다. 화면 크기를 알 수 없으면 아무것도 하지 않는다. */
export function watchViewportPack(onChange: (pack: PagePack) => void): () => void {
  const query = shortViewport();
  if (query === null) return () => undefined;
  const listener = (event: MediaQueryListEvent) => onChange(event.matches ? "single" : "screen");
  if (typeof query.addEventListener === "function") {
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }
  query.addListener(listener);
  return () => query.removeListener(listener);
}

// ---------------------------------------------------------------------------
// 받은 링크를 열었던 표시
// ---------------------------------------------------------------------------

/**
 * 받은 링크(상대의 답이 든 링크, 두 사람 결과 링크)를 연 화면은 상대의 답을 메모리로 옮기고 주소의 # 뒤를 지운다.
 * 그 뒤 새로고침하면 답이 화면에서 사라지는데, 새로고침한 화면은 링크를 열었던 적이 없는 화면과 똑같아 보여서 아무 말이 없었다.
 * 그래서 주소를 지울 때 이 탭의 브라우저 기록 한 칸(history.state)에 「링크를 열었었다」는 표시만 남긴다. 새로고침해도 그 칸의 표시는 남는다.
 * 저장소(localStorage 등)가 아니라서 새 저장 키도 처리방침의 저장 문단도 늘지 않는다. 표시에는 답도 글자도 없고 partner, both 두 값뿐이며
 * 탭을 닫으면 함께 사라진다. 다시 시작하거나 내 웨딩코드를 새로 시작하면 지운다.
 */
export const LINK_OPENED_STATE_KEY = "wcV40LinkOpened";

/** partner = 상대의 답이 든 링크, both = 두 사람 결과 링크. */
export type LinkOpenedKind = "partner" | "both";

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 주소를 지우면서 브라우저 기록 칸에 넣을 값. kind 가 있으면 지금 칸의 내용(라우터가 붙여 둔 것)을 살리고 표시를 더하고, null 이면 표시를 뺀 null 이다.
 */
export function linkOpenedState(current: unknown, kind: LinkOpenedKind | null): Record<string, unknown> | null {
  if (kind === null) return null;
  return { ...(isPlainRecord(current) ? current : {}), [LINK_OPENED_STATE_KEY]: kind };
}

/** 브라우저 기록 칸에서 표시를 읽는다. 모르는 값이거나 없으면 null. */
export function readLinkOpened(state: unknown): LinkOpenedKind | null {
  if (!isPlainRecord(state)) return null;
  const mark = state[LINK_OPENED_STATE_KEY];
  return mark === "partner" || mark === "both" ? mark : null;
}
