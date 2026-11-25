/**
 * 편지를 두 분 폰에서 직접 보내기(D-83 1단계, 2026-11-18)의 단추 도우미. 화면 없는 함수다.
 *
 * 아모라는 업체에 아무것도 보내지 않는다. 여기서 하는 일은 복사, 공유 창 열기, 문자 앱 주소 만들기까지다.
 * 그래서 결과에 "보냈다"가 없다. 공유 창이 끝까지 갔어도(shared) 그 앱에서 정말 보냈는지는 모른다.
 *
 * - 공유 창(navigator.share)은 누른 순간에만 열린다(사용자 동작이 살아 있을 때). 그래서 `shareText` 는 기다리는
 *   일 없이 곧바로 share 를 부른다. 보낼 글은 편지 응답에 이미 와 있어 누를 때 서버를 부르지 않는다.
 * - 사람이 공유 창을 닫으면(AbortError) 취소다. 실패가 아니라서 복사로 넘어가지 않는다.
 * - 공유 창이 없거나 다른 까닭으로 실패하면 클립보드에 쓰고, 클립보드도 막히면 옛 복사 명령을 한 번 더 해 본다.
 * - 문자 앱 주소는 받는 번호 없이 글만 담는다(업체 번호는 아모라가 모른다). iOS 는 `sms:&body=`, 그 밖은 `sms:?body=` 다.
 *
 * 네트워크 요청을 하지 않고 저장소를 만지지 않는다. 브라우저 객체는 부를 때 읽어서 시험이 가짜로 바꿀 수 있다.
 * 웨딩코드의 링크 보내기(`wedding-code/v40/shareActions.ts`)와 같은 순서지만, 그쪽은 주소가 꼭 있어야 해서 따로 둔다.
 */

/** 공유 창·클립보드·옛 복사 명령. 없으면 그 길이 없는 것이다. */
export type SelfSendEnv = {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
  readonly writeText?: (text: string) => Promise<void>;
  /** 옛 복사 명령(`document.execCommand("copy")`). 복사했으면 true. */
  readonly execCopy?: (text: string) => boolean;
};

export type CopyOutcome = "copied" | "copyFailed";

/** shared: 공유 창이 끝까지 갔다. cancelled: 사람이 공유 창을 닫았다. 나머지는 복사로 넘어간 결과다. */
export type ShareOutcome = "shared" | "cancelled" | CopyOutcome;

export type ShareStart = {
  /** 누른 순간 공유 창을 열었다. 화면은 앱을 고르라는 줄을 이때 보인다. */
  readonly sheetOpened: boolean;
  readonly outcome: Promise<ShareOutcome>;
};

/** ios 는 `&body=`, android 와 그 밖(컴퓨터)은 표준 꼴 `?body=` 를 쓴다. */
export type SmsPlatform = "ios" | "android" | "other";

const HALL_SEARCH_URL = "https://m.search.naver.com/search.naver";

/**
 * 옛 복사 명령. 보이지 않는 글 칸에 글을 잠깐 넣고 골라서 복사한 뒤 곧바로 지운다. 누르던 단추의 초점은 돌려 놓는다.
 * 클립보드 권한이 없는 브라우저(안전하지 않은 주소, 옛 브라우저)를 위한 마지막 길이다.
 */
function execCommandCopy(text: string): boolean {
  if (typeof document === "undefined" || !document.body || typeof document.execCommand !== "function") return false;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.setAttribute("aria-hidden", "true");
  area.tabIndex = -1;
  Object.assign(area.style, { position: "fixed", top: "0", left: "0", opacity: "0", pointerEvents: "none" });
  document.body.appendChild(area);
  try {
    area.select();
    area.setSelectionRange(0, area.value.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    area.remove();
    active?.focus({ preventScroll: true });
  }
}

/** 지금 브라우저의 공유 창과 클립보드. 부를 때마다 읽고, 서버 렌더에서는 빈 환경이다. */
export function browserSelfSendEnv(): SelfSendEnv {
  if (typeof navigator === "undefined") return {};
  const nav = navigator;
  const clipboard = nav.clipboard as Clipboard | undefined;
  return {
    share: typeof nav.share === "function" ? (data) => nav.share(data) : undefined,
    canShare: typeof nav.canShare === "function" ? (data) => nav.canShare(data) : undefined,
    writeText: clipboard && typeof clipboard.writeText === "function" ? (text) => clipboard.writeText(text) : undefined,
    execCopy: execCommandCopy,
  };
}

function isAbort(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";
}

function canShareSafely(env: SelfSendEnv, data: ShareData): boolean {
  if (env.share === undefined) return false;
  if (env.canShare === undefined) return true;
  try {
    return env.canShare(data);
  } catch {
    return false;
  }
}

/**
 * 글을 복사한다. 클립보드에 쓰고, 막혔으면 옛 복사 명령을 해 본다. 클립보드가 아예 없으면 기다리지 않고 곧바로
 * 옛 명령을 부른다(누른 순간 안에서만 되는 브라우저가 있다).
 */
export async function copyText(text: string, env: SelfSendEnv = browserSelfSendEnv()): Promise<CopyOutcome> {
  if (env.writeText) {
    try {
      await env.writeText(text);
      return "copied";
    } catch {
      // 클립보드 쓰기가 거절됐다(권한 거절, 안전하지 않은 주소). 아래 옛 복사 명령으로 한 번 더 해 본다.
    }
  }
  return env.execCopy?.(text) ? "copied" : "copyFailed";
}

/**
 * 공유 창으로 글을 넘긴다. 공유 창은 이 함수를 부른 그 자리에서 열고(기다리지 않는다), 결과는 `outcome` 으로 준다.
 * 공유 창이 없거나 실패하면 복사로 넘어간다. 사람이 닫은 것(취소)은 복사하지 않는다.
 */
export function shareText(text: string, env: SelfSendEnv = browserSelfSendEnv()): ShareStart {
  const data: ShareData = { text };
  const share = env.share;
  if (!share || !canShareSafely(env, data)) return { sheetOpened: false, outcome: copyText(text, env) };
  let pending: Promise<void>;
  try {
    pending = share(data);
  } catch {
    return { sheetOpened: false, outcome: copyText(text, env) };
  }
  const outcome = pending.then(
    (): ShareOutcome => "shared",
    (error: unknown): ShareOutcome | Promise<ShareOutcome> => (isAbort(error) ? "cancelled" : copyText(text, env)),
  );
  return { sheetOpened: true, outcome };
}

/** 받는 번호 없이 글만 담은 문자 앱 주소. 글은 주소 한 칸 안에 그대로 들어가도록 모두 부호로 바꾼다. */
export function smsHref(text: string, platform: SmsPlatform): string {
  const body = encodeURIComponent(text);
  return platform === "ios" ? `sms:&body=${body}` : `sms:?body=${body}`;
}

/** 브라우저 이름표로 문자 주소 꼴을 고른다. iPadOS 사파리는 맥처럼 자기를 알리므로 터치가 되면 iOS 로 본다. */
export function smsPlatformOf(userAgent: string, maxTouchPoints = 0): SmsPlatform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}

/** 지금 브라우저의 문자 주소 꼴. 서버 렌더에서는 표준 꼴이다. */
export function browserSmsPlatform(): SmsPlatform {
  if (typeof navigator === "undefined") return "other";
  return smsPlatformOf(navigator.userAgent ?? "", navigator.maxTouchPoints ?? 0);
}

/** 웨딩홀 이름으로 찾는 네이버 검색 주소. 업체 전화번호·예약 주소는 아모라가 모르므로 사람이 찾아보게 한다. */
export function hallSearchHref(name: string): string {
  return `${HALL_SEARCH_URL}?query=${encodeURIComponent(name)}`;
}
