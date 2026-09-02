/**
 * 저장된 한글이 깨져서 돌아올 때 무엇을 할 것인가.
 *
 * ## 두 가지 깨짐은 성질이 다르다
 *
 * **되살릴 수 있는 것** — UTF-8 로 저장된 바이트를 Latin-1(또는 CP1252)로 읽으면
 * 한글 한 글자가 라틴 글자 세 개로 보인다(`드` → 세 글자). 글자는 하나도
 * 사라지지 않았고 **읽는 방법만 틀렸다.** 같은 글자들을 바이트로 되돌려 UTF-8 로
 * 다시 읽으면 원문이 정확히 돌아온다.
 *
 * **되살릴 수 없는 것** — 한글을 표현하지 못하는 문자집합으로 한 번 변환되면
 * 음절 하나가 `?` 하나로 뭉개진다(`?? ???`). U+FFFD(``)도 마찬가지다. 이건
 * 원문 바이트가 이미 없어진 것이라 어떤 코드도 되돌리지 못한다.
 *
 * 그래서 이 파일은 두 가지만 한다: 되살릴 수 있는 것은 **정확히** 되살리고,
 * 되살릴 수 없는 것은 **되살린 척하지 않고** 그렇다고 알린다.
 *
 * ## 왜 이렇게 좁게 고치는가
 *
 * 되돌리기는 사용자가 쓴 글을 우리가 바꾸는 일이다. 조금이라도 어긋나면 멀쩡한
 * 제목을 망가뜨린다. 그래서 세 조건이 **모두** 맞을 때만 바꾼다.
 *
 *   1. 문자열의 모든 글자가 한 바이트로 되돌아간다(Latin-1 또는 CP1252 범위).
 *   2. 그 바이트열이 **엄격한** UTF-8 로 읽힌다 — 과잉 인코딩·잘린 시퀀스·
 *      서로게이트 값은 전부 거절한다.
 *   3. 읽어낸 결과에 한글이 있다. 이 제품의 사용자 입력은 한글이고, 한글이
 *      나오지 않는 변환은 되살리기가 아니라 우연이다.
 *
 * 한글이 한 글자라도 섞여 있는 문자열은 1번에서 자동으로 걸린다(한글은 한
 * 바이트로 안 돌아간다). 그래서 절반만 깨진 문자열은 건드리지 않는다 — 반만
 * 아는 상태에서 손대는 것보다 그대로 두는 편이 안전하다.
 */

/** CP1252 에서만 쓰는 0x80~0x9F 자리. 값 → 바이트. */
const CP1252_HIGH_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

/** 한글 음절·자모가 하나라도 있는가. */
function containsHangul(value: string): boolean {
  return /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/u.test(value);
}

/**
 * 문자열을 한 글자 = 한 바이트로 되돌린다. 하나라도 안 되면 null.
 *
 * 0x80~0x9F 는 두 번 본다. Latin-1 로 잘못 읽힌 경우에는 그 자리에 C1 제어문자가
 * 그대로 남고, CP1252 로 잘못 읽힌 경우에는 `€`·`'` 같은 글자가 된다. 둘 다
 * 실제로 나오므로 양쪽을 모두 바이트로 되돌린다.
 */
function toSingleByteSequence(value: string): Uint8Array | null {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0xff) {
      bytes[index] = code;
      continue;
    }
    const mapped = CP1252_HIGH_TO_BYTE.get(code);
    if (mapped === undefined) return null;
    bytes[index] = mapped;
  }
  return bytes;
}

/**
 * 엄격한 UTF-8 디코더. 한 군데라도 규격을 벗어나면 null.
 *
 * `TextDecoder` 를 쓰지 않는 이유: 이 파일은 웹·Node·React Native 세 곳에서 같이
 * 돌아야 하는데 런타임마다 있고 없고가 다르다. 되돌리기의 안전은 "엄격하게
 * 실패하는 것"에 달려 있으므로 판정을 환경에 맡기지 않는다.
 */
function decodeStrictUtf8(bytes: Uint8Array): string | null {
  let out = "";
  let index = 0;

  while (index < bytes.length) {
    const lead = bytes[index];

    if (lead < 0x80) {
      out += String.fromCharCode(lead);
      index += 1;
      continue;
    }

    let needed: number;
    let codePoint: number;
    let lowerBound: number;

    if (lead >= 0xc2 && lead <= 0xdf) {
      needed = 1;
      codePoint = lead & 0x1f;
      lowerBound = 0x80;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      needed = 2;
      codePoint = lead & 0x0f;
      lowerBound = 0x800;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      needed = 3;
      codePoint = lead & 0x07;
      lowerBound = 0x10000;
    } else {
      // 0x80~0xC1 과 0xF5~0xFF 는 UTF-8 선두 바이트가 될 수 없다.
      return null;
    }

    if (index + needed >= bytes.length) return null;

    for (let offset = 1; offset <= needed; offset += 1) {
      const continuation = bytes[index + offset];
      if (continuation < 0x80 || continuation > 0xbf) return null;
      codePoint = (codePoint << 6) | (continuation & 0x3f);
    }

    // 과잉 인코딩, 서로게이트 값, 범위 초과는 전부 거절한다.
    if (codePoint < lowerBound) return null;
    if (codePoint >= 0xd800 && codePoint <= 0xdfff) return null;
    if (codePoint > 0x10ffff) return null;

    out += String.fromCodePoint(codePoint);
    index += needed + 1;
  }

  return out;
}

/** 원문이 정말로 그 바이트열이었는지 되짚는다. 다르면 되돌리기를 포기한다. */
function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/** 한 겹 되돌린다. 되돌릴 수 없으면 null. 여기서는 한글 여부를 아직 묻지 않는다. */
function repairOnce(value: string): string | null {
  const bytes = toSingleByteSequence(value);
  if (!bytes) return null;

  const decoded = decodeStrictUtf8(bytes);
  if (decoded === null || decoded === value) return null;
  if (!sameBytes(encodeUtf8(decoded), bytes)) return null;

  return decoded;
}

/**
 * 두 번 겹쳐 깨진 문자열도 있다. 그때 첫 겹을 벗긴 결과는 아직 한글이 아니라
 * **한 겹 얕은 깨짐**이므로, 겹마다 한글을 요구하면 두 겹짜리를 못 살린다.
 * 그래서 겹은 계속 벗기되 **한글이 나온 마지막 상태만** 답으로 쓴다.
 */
const MAX_REPAIR_PASSES = 3;

/**
 * 되살릴 수 있으면 되살린 문자열을, 아니면 받은 문자열을 그대로 돌려준다.
 * 문자열이 아니면 빈 문자열을 돌려준다 — 부르는 쪽이 타입을 또 확인하지 않게.
 */
/**
 * 되돌릴 여지가 있는 글자가 하나라도 있는가.
 *
 * 잘못 읽힌 문자열에는 **반드시** 0x80~0xFF 자리의 글자나 CP1252 전용 글자가
 * 있다(UTF-8 의 뒷바이트가 그렇게 보인다). 그런 글자가 하나도 없는 문자열은
 * ASCII 뿐이므로 되돌릴 것이 없다.
 *
 * 이 검사가 있어야 채팅 기록처럼 **문자열이 수천 개인 곳**에서 정규식 한 번으로
 * 대부분이 빠져나간다. 없으면 멀쩡한 ASCII 문자열마다 바이트 변환과 UTF-8
 * 디코딩을 전부 돌게 된다.
 */
function couldBeMisread(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0x80 && code <= 0xff) return true;
    if (code > 0xff && CP1252_HIGH_TO_BYTE.has(code)) return true;
  }
  return false;
}

export function repairMojibake(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "";
  if (containsHangul(value)) return value;
  if (!couldBeMisread(value)) return value;

  let current = value;
  let bestWithHangul: string | null = null;

  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const next = repairOnce(current);
    if (next === null) break;
    current = next;
    if (containsHangul(next)) bestWithHangul = next;
  }

  // 어느 겹에서도 한글이 나오지 않았다면 그것은 되살리기가 아니다.
  // 라틴 문자만 나오는 변환으로 사용자가 쓴 글을 바꾸지 않는다.
  return bestWithHangul ?? value;
}

/**
 * 이미 원문이 사라진 깨짐의 **흔적**이 있는가. 진단·집계용이다.
 *
 * - U+FFFD 가 있으면 확정이다. 그 자리는 원래 바이트를 버린 자리다.
 * - `?` 는 사람이 쓴 물음표일 수도 있다. 그래서 **한글이 하나도 없으면서**
 *   물음표가 둘 이상 붙어 있을 때만 흔적으로 본다.
 *
 * 화면에서 무엇을 그릴지는 이 값으로 정하지 않는다 — `isUnreadableText` 를 쓴다.
 * 흔적이 있어도 읽을 수 있는 글이 남아 있으면 그 글을 보여주는 편이 낫다.
 */
export function hasIrrecoverableTextCorruption(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\ufffd")) return true;
  return /\?{2,}/u.test(value) && !containsHangul(value);
}

/**
 * 읽을 글자가 하나도 남지 않았는가.
 *
 * 깨짐 자리(`?`, U+FFFD)와 공백·문장부호를 걷어냈을 때 아무것도 안 남으면
 * 그 문자열은 제목이 아니라 잔해다(`?? ???`). 반대로 `D-DAY??` 는 걷어내도
 * `DDAY` 가 남으므로 사용자가 쓴 제목으로 본다 — 물음표를 이유로 사람이 쓴
 * 제목을 감추지 않는다.
 */
export function isUnreadableText(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (!value.includes("?") && !value.includes("\ufffd")) return false;
  return !/[\p{L}\p{N}]/u.test(value.replace(/[?\ufffd]/gu, ""));
}

/**
 * 중첩된 값 안의 문자열을 전부 되돌린다.
 *
 * ## 왜 필요한가
 *
 * 채팅 한 줄이 화면에 그려질 때 나가는 글은 `content` 하나가 아니다. 도구 카드
 * 문구(`metadata.toolResults[].displayMessage`), 승인 카드 문구
 * (`metadata.pending_amora_action.confirmation`), 중재 카드의 네 문단이 모두
 * `metadata` 안에 저장돼 있고, 각각 다른 컴포넌트가 그린다. 필드 목록을 손으로
 * 들고 다니면 새 카드가 생길 때마다 그 목록이 낡는다.
 *
 * ## 왜 아무 문자열이나 훑어도 안전한가
 *
 * `repairMojibake` 는 **바이트 왕복이 정확히 맞고 결과에 한글이 나올 때만** 값을
 * 바꾼다. ID·경로·URL 처럼 ASCII 뿐인 값은 `couldBeMisread` 에서 바로 빠져나가고,
 * 한글이 이미 있는 값도 첫 줄에서 빠져나간다. 그래서 훑는 범위가 넓어도 바뀌는
 * 것은 실제로 잘못 읽힌 문자열뿐이다.
 *
 * ## 경계
 *
 * 깊이와 노드 수에 상한을 둔다. `metadata` 는 사용자가 만든 JSONB 를 품을 수
 * 있어서, 상한이 없으면 깊게 중첩된 한 줄이 화면 그리기를 멈춰 세울 수 있다.
 * 상한에 닿으면 **그 아래는 손대지 않고 그대로 돌려준다** — 예산을 다 쓴 것이
 * 값을 버릴 이유는 아니다.
 *
 * 바뀐 것이 없으면 **받은 참조를 그대로** 돌려준다. React 가 같은 객체를 다시
 * 그리지 않게 하려면 이 성질이 필요하다.
 */
const MAX_DEEP_REPAIR_DEPTH = 8;
const MAX_DEEP_REPAIR_NODES = 500;

function repairDeep(value: unknown, depth: number, budget: { left: number }): unknown {
  if (depth > MAX_DEEP_REPAIR_DEPTH || budget.left <= 0) return value;
  budget.left -= 1;

  if (typeof value === "string") {
    const repaired = repairMojibake(value);
    return repaired === value ? value : repaired;
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const repaired = repairDeep(item, depth + 1, budget);
      if (repaired !== item) changed = true;
      return repaired;
    });
    return changed ? next : value;
  }

  // 평범한 객체만 연다. Date·Map 같은 것은 그대로 둔다 — 이 함수가 아는 모양이
  // 아니고, 열어 보려다 원본을 망가뜨릴 이유가 없다.
  if (value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const repaired = repairDeep(item, depth + 1, budget);
      if (repaired !== item) changed = true;
      next[key] = repaired;
    }
    return changed ? next : value;
  }

  return value;
}

export function repairMojibakeDeep<T>(value: T): T {
  return repairDeep(value, 0, { left: MAX_DEEP_REPAIR_NODES }) as T;
}

export interface RecoveredText {
  /** 화면에 쓸 문자열. 되살렸으면 되살린 값이다. */
  text: string;
  /** 되살리기가 실제로 일어났는가. */
  repaired: boolean;
  /** 되살린 뒤에도 읽을 글자가 남지 않았는가. 화면은 이 값을 제목으로 쓰면 안 된다. */
  unreadable: boolean;
}

/**
 * 화면에 내보내기 직전에 한 번 통과시키는 자리.
 *
 * 되살릴 수 있으면 되살리고, 되살릴 수 없으면 그 사실을 같이 돌려준다. 잔해를
 * 사용자가 쓴 제목인 척 그리는 것은 화면이 사실이 아닌 말을 하는 것이다.
 */
export function recoverUserText(value: unknown): RecoveredText {
  const original = typeof value === "string" ? value : "";
  const text = repairMojibake(original);
  return {
    text,
    repaired: text !== original,
    unreadable: isUnreadableText(text),
  };
}

/**
 * 짧은 라벨 자리에 쓰는 지름길.
 *
 * 되살릴 수 있으면 되살린 글을, 읽을 글자가 하나도 안 남았으면 부르는 쪽이 준
 * 문구를 돌려준다. **제목·이름처럼 짧은 라벨에만 쓴다.** 대화 본문처럼 긴 기록은
 * 일부가 깨졌다고 통째로 안내문으로 바꾸면 남아 있는 정보까지 사라진다.
 */
export function readableTextOr(value: unknown, fallback: string): string {
  const recovered = recoverUserText(value);
  return recovered.unreadable ? fallback : recovered.text;
}
