/**
 * 딥링크로 받은 초대 코드를 로그인 왕복 동안 들고 있는 자리.
 *
 * ## 왜 필요한가
 *
 * `hanbang://invite#WH-...`로 앱이 열렸을 때 그 사람이 로그인 상태가 아니면 로그인
 * 화면으로 보내야 한다. 로그인이 끝나면 앱은 루트(`/`)로 되돌아가고 거기서 온보딩으로
 * 넘어가는데, 그 왕복 동안 코드를 들고 있을 곳이 없으면 사람은 링크를 눌렀는데도 빈
 * 입력칸을 다시 만난다. 그러면 대개 코드를 손으로 옮겨 적는다 — 링크를 만든 이유가 사라진다.
 *
 * ## 메모리만으로는 왜 부족했나
 *
 * 처음에는 메모리에만 뒀다. "같은 앱 실행 안에서 끝나는 왕복"이라고 봤기 때문이다.
 * 그런데 초대받는 사람의 **주 경로**는 계정이 아예 없는 파트너이고, 가입은 이메일 확인을
 * 강제한다(`app/(auth)/signup.tsx`). 즉 그 사람은 반드시 앱을 나가 메일함을 열고 돌아온다.
 * 그 사이 OS가 앱을 회수하면 코드는 사라지고, 사람은 아무 설명 없는 빈 칸을 만난다.
 * 드문 예외가 아니라 가장 흔한 길이었다.
 *
 * ## 그래서 "지우지 않는 저장"이 아니라 "만료되는 저장"이다
 *
 * 초대 코드는 커플 공간에 들어오는 열쇠다. 디스크에 그냥 남기면 며칠 뒤 다른 사람이 그
 * 폰을 켰을 때도 코드가 살아 있다. 그래서 저장하되 {@link PENDING_INVITE_TTL_MS} 안에서만
 * 유효하게 본다 — 메일 왕복에는 넉넉하고, 하루 뒤에는 없는 것과 같다.
 *
 * 저장은 호출하는 쪽이 넘긴 storage로만 한다. 이 파일이 SecureStore를 직접 import하면
 * `node --test`에서 돌지 않고, 그러면 만료 판정처럼 틀리기 쉬운 로직이 테스트 밖에 남는다.
 *
 * ## 형식 검사를 여기서도 하는 이유
 *
 * 이 값은 앱 밖에서 온 문자열이다(딥링크 URL). 넣는 쪽이 검사했더라도 저장소가 아무
 * 문자열이나 받아주면 나중에 이상한 값이 입력칸에 꽂힌다. 정규화·길이 제한은
 * `packages/shared/src/contracts/coupleInviteCode.ts`의 정본과 **동작이** 같아야 하고,
 * 그 사실은 `coupleInviteShare.test.mjs`가 값으로 맞춰 본다(정규식 문자열 비교가 아니라).
 * 여기서 정본을 import하지 못하는 것은 이 파일이 `node --test`에서 그대로 실행되어야
 * 하는데 정본이 TypeScript이기 때문이다.
 */

/** 정본: packages/shared/src/contracts/coupleInviteCode.ts */
const COUPLE_INVITE_CODE_RE = /^WH-[A-Z0-9]{6,12}$/u;
/** 정본의 COUPLE_INVITE_CODE_MAX_LENGTH와 같아야 한다. */
const COUPLE_INVITE_CODE_MAX_LENGTH = 15;

/** 저장된 코드를 유효하게 보는 시간. 메일 인증 왕복에는 넉넉하고, 하루 뒤엔 없는 것과 같다. */
export const PENDING_INVITE_TTL_MS = 30 * 60 * 1000;

/** 저장소 키. 값 모양이 바뀌면 뒤 숫자를 올린다. */
export const PENDING_INVITE_STORAGE_KEY = "hanbang.pendingCoupleInvite.v1";

let pendingInviteCode = null;

/**
 * 정본 `normalizeCoupleInviteCode`와 같은 동작. `slice`가 빠져 있으면 정본이 잘라서
 * 통과시키는 긴 입력을 여기서는 거절하게 된다 — 그 어긋남이 실제로 있었다.
 */
function toInviteCode(value) {
  if (typeof value !== "string") return null;
  const normalized = value
    .toUpperCase()
    .replace(/[^A-Z0-9-]/gu, "")
    .slice(0, COUPLE_INVITE_CODE_MAX_LENGTH);
  return COUPLE_INVITE_CODE_RE.test(normalized) ? normalized : null;
}

/** 저장할 문자열. 시각을 함께 넣어야 꺼낼 때 만료를 판정할 수 있다. */
export function serializePendingInvite(code, now) {
  return JSON.stringify({ code, savedAt: now });
}

/**
 * 저장된 문자열에서 아직 유효한 코드를 꺼낸다.
 *
 * 모양이 깨졌거나, 시각이 없거나, 만료됐거나, 미래 시각이면 null이다. 미래 시각까지
 * 버리는 이유는 기기 시계가 뒤로 돌아간 뒤 저장된 값이 영영 만료되지 않는 것을 막기 위해서다.
 */
export function parsePendingInvite(raw, now, ttlMs = PENDING_INVITE_TTL_MS) {
  if (typeof raw !== "string" || raw.length === 0) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const code = toInviteCode(parsed.code);
  if (!code) return null;

  const savedAt = parsed.savedAt;
  if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;

  const age = now - savedAt;
  if (age < 0 || age > ttlMs) return null;

  return code;
}

/**
 * 딥링크에서 꺼낸 코드를 기억한다. 형식을 통과하지 못하면 기억하지 않고, 이미 들고
 * 있던 값도 지운다 — 새 링크가 이전 링크를 덮는 것이 맞다.
 *
 * @param value 딥링크에서 꺼낸 문자열
 * @param options.storage `{ setItemAsync, deleteItemAsync }` (expo-secure-store 모양). 없으면 메모리만.
 * @param options.now 지금 시각(ms). 테스트가 시계를 고정할 수 있게 받는다.
 * @returns 기억한 코드. 형식이 아니면 null.
 */
export async function rememberPendingCoupleInviteCode(value, options = {}) {
  const { storage = null, now = Date.now() } = options;
  pendingInviteCode = toInviteCode(value);

  if (!storage) return pendingInviteCode;

  try {
    if (pendingInviteCode) {
      await storage.setItemAsync(
        PENDING_INVITE_STORAGE_KEY,
        serializePendingInvite(pendingInviteCode, now),
      );
    } else {
      await storage.deleteItemAsync(PENDING_INVITE_STORAGE_KEY);
    }
  } catch {
    // 저장에 실패해도 이번 실행 안에서는 메모리 값으로 이어진다. 여기서 던지면
    // 링크를 눌러 들어온 사람이 착지 화면에서 오류를 본다 — 얻는 것 없이 잃기만 한다.
  }
  return pendingInviteCode;
}

/**
 * 코드를 꺼내면서 지운다. 한 번만 쓰이도록 — 온보딩을 마치고 다시 들어왔을 때 예전
 * 링크의 코드가 되살아나면, 이미 연결된 사람이 남의 코드로 합류를 시도한다.
 */
export async function consumePendingCoupleInviteCode(options = {}) {
  const { storage = null, now = Date.now() } = options;

  let code = pendingInviteCode;
  pendingInviteCode = null;

  if (storage) {
    try {
      if (!code) {
        code = parsePendingInvite(
          await storage.getItemAsync(PENDING_INVITE_STORAGE_KEY),
          now,
        );
      }
      await storage.deleteItemAsync(PENDING_INVITE_STORAGE_KEY);
    } catch {
      // 읽지 못하면 없는 것으로 본다. 사람은 코드를 직접 넣으면 되고, 그게
      // 알 수 없는 오류 화면보다 낫다.
    }
  }

  return code;
}

/** 지우지 않고 보기만 한다. 착지 화면이 무엇을 들고 있는지 표시할 때 쓴다. */
export function peekPendingCoupleInviteCode() {
  return pendingInviteCode;
}

export async function clearPendingCoupleInviteCode(options = {}) {
  const { storage = null } = options;
  pendingInviteCode = null;
  if (!storage) return;
  try {
    await storage.deleteItemAsync(PENDING_INVITE_STORAGE_KEY);
  } catch {
    // 지우기 실패는 만료가 대신 처리한다.
  }
}
