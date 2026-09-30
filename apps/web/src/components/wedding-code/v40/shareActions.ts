/**
 * 웨딩코드 4.0 링크 보내기 도우미(순수 함수, 화면 없음).
 *
 * 순서: 공유 창(navigator.share)이 있으면 그것을 열고, 없거나 실패하면 클립보드(navigator.clipboard.writeText)에 쓰고,
 * 그것도 안 되면 주소 칸을 보여 달라고 알린다. 결과는 갈래가 나뉜 값이라 부르는 쪽이 무슨 일이 실제로 있었는지 안다.
 *
 * - shared: 공유 창이 끝까지 갔다. 클립보드에는 쓰지 않았다.
 * - copied: 클립보드에 실제로 썼다. 이용 통계 wedding_code_share_copied 는 이 갈래에서만 보낸다(공유 창 완료는 보내지 않는다).
 * - revealed: 공유 창도 클립보드도 안 됐다. 화면이 읽기 전용 주소 칸을 열어야 한다.
 * - cancelled: 사람이 공유 창을 닫았다. 실패가 아니므로 주소 칸을 열지 않고 클립보드에도 쓰지 않는다.
 *
 * 공유 창은 사용자 동작 직후에만 열린다. 그래서 sendLink 는 첫 await 이전에 share 를 부른다(다른 비동기 작업을 앞에 두지 않는다).
 * 이 파일은 네트워크 요청을 하지 않고 저장소를 만지지 않는다. 브라우저 객체는 부를 때 읽어서 시험이 가짜로 바꿀 수 있다.
 */

/** 공유 창과 클립보드를 부르는 세 함수. 없으면 그 길이 없는 것이다. */
export interface ShareEnv {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  readonly writeText?: (text: string) => Promise<void>;
}

export interface LinkPayload {
  /** 보낼 주소. 비어 있으면 RangeError. */
  readonly url: string;
  /** 사람이 고쳐 쓴 보낼 말. 주소는 넣지 않는다. 비어 있으면 주소만 보낸다. */
  readonly text?: string;
  /** 공유 창 제목. */
  readonly title?: string;
}

export type ShareOutcome =
  | { readonly kind: "shared" }
  | { readonly kind: "copied" }
  | { readonly kind: "revealed"; readonly reason: "unsupported" | "failed" }
  | { readonly kind: "cancelled" };

/** 부모에게 알리는 보냈다는 사건. 취소는 사건이 아니라서 없다. */
export interface ShareSentEvent {
  readonly kind: "shared" | "copied" | "revealed";
}

/** 지금 브라우저의 공유 창과 클립보드. 부를 때마다 읽고, 서버 렌더에서는 빈 환경이다. */
export function browserShareEnv(): ShareEnv {
  if (typeof navigator === "undefined") return {};
  const nav = navigator;
  const clipboard = nav.clipboard as Clipboard | undefined;
  return {
    share: typeof nav.share === "function" ? (data) => nav.share(data) : undefined,
    canShare: typeof nav.canShare === "function" ? (data) => nav.canShare(data) : undefined,
    writeText: clipboard && typeof clipboard.writeText === "function" ? (text) => clipboard.writeText(text) : undefined,
  };
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function canShareSafely(env: ShareEnv, data: ShareData): boolean {
  if (env.share === undefined) return false;
  if (env.canShare === undefined) return true;
  try {
    return env.canShare(data);
  } catch {
    return false;
  }
}

/**
 * 링크를 보낸다. 공유 창, 클립보드, 주소 칸 순서로 시도하고 실제로 있었던 일을 돌려준다.
 * 클립보드에는 보낼 말과 주소를 줄을 바꿔 함께 쓴다(대화창에 붙여 넣으면 말과 링크가 함께 간다). 보낼 말이 비면 주소만 쓴다.
 */
export async function sendLink(payload: LinkPayload, env: ShareEnv = browserShareEnv()): Promise<ShareOutcome> {
  const url = payload.url;
  if (typeof url !== "string" || url === "") throw new RangeError("보낼 주소가 비어 있어요");
  const text = (payload.text ?? "").trim();
  const data: ShareData = { url };
  if (text !== "") data.text = text;
  if (payload.title !== undefined && payload.title !== "") data.title = payload.title;

  const sheet = env.share;
  const useSheet = sheet !== undefined && canShareSafely(env, data);
  let attempted = false;
  if (useSheet) {
    attempted = true;
    try {
      await sheet(data);
      return { kind: "shared" };
    } catch (error) {
      if (isAbort(error)) return { kind: "cancelled" };
    }
  }

  const write = env.writeText;
  if (write !== undefined) {
    attempted = true;
    try {
      await write(text === "" ? url : `${text}\n${url}`);
      return { kind: "copied" };
    } catch {
      // 클립보드가 거절됐다. 아래에서 주소 칸을 열도록 알린다.
    }
  }
  return { kind: "revealed", reason: attempted ? "failed" : "unsupported" };
}

/** 결과를 부모에게 알릴 사건으로 바꾼다. 취소는 null. */
export function sentEventOf(outcome: ShareOutcome): ShareSentEvent | null {
  if (outcome.kind === "cancelled") return null;
  return { kind: outcome.kind };
}

/** 클립보드에 실제로 복사했는가. 이용 통계 wedding_code_share_copied 를 보내도 되는 유일한 경우다. */
export function isRealClipboardCopy(event: ShareSentEvent | ShareOutcome): boolean {
  return event.kind === "copied";
}
