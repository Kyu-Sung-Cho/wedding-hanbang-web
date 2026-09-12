// 이름 표시 전용이다. 저장된 이름·사진 URL이나 공개 범위를 바꾸지 않는다.
export const PROFILE_AVATAR_EMOJIS = Object.freeze([
  { emoji: "🌷", label: "튤립" },
  { emoji: "🌸", label: "벚꽃" },
  { emoji: "🌼", label: "꽃" },
  { emoji: "🌿", label: "풀잎" },
  { emoji: "🍀", label: "네잎클로버" },
  { emoji: "☀️", label: "해" },
  { emoji: "🌙", label: "달" },
  { emoji: "⭐", label: "별" },
  { emoji: "🦋", label: "나비" },
  { emoji: "🐱", label: "고양이" },
  { emoji: "🐶", label: "강아지" },
  { emoji: "🐰", label: "토끼" },
  { emoji: "🐻", label: "곰" },
  { emoji: "🦊", label: "여우" },
  { emoji: "🐼", label: "판다" },
  { emoji: "🐧", label: "펭귄" },
  { emoji: "💍", label: "반지" },
  { emoji: "🤍", label: "하얀 하트" },
  { emoji: "✨", label: "반짝임" },
  { emoji: "👑", label: "왕관" },
].map((option) => Object.freeze(option)));

const avatarEmojiSet = new Set(PROFILE_AVATAR_EMOJIS.map(({ emoji }) => emoji));
const markPattern = /[\p{Mark}\p{Grapheme_Extend}]/u;
const pictographPattern = /\p{Extended_Pictographic}/u;
let cachedSegmenterConstructor;
let cachedSegmenter;

export function isProfileAvatarEmoji(value) {
  return typeof value === "string" && avatarEmojiSet.has(value);
}

function isTag(codePoint) {
  return codePoint >= 0xe0020 && codePoint <= 0xe007f;
}

function cleanName(name) {
  if (typeof name !== "string") return "";
  return name.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, (character) => {
    const point = character.codePointAt(0);
    // 이모지/문자 결합에 쓰는 형식 문자는 내부에서 보존한다.
    return point === 0x200c || point === 0x200d || isTag(point) ? character : "";
  }).trim().replace(/^[\u200c\u200d\ufe00-\ufe0f\u{e0100}-\u{e01ef}\u{e0020}-\u{e007f}]+/u, "").trim().normalize("NFC");
}

function isExtend(character, point) {
  return markPattern.test(character)
    || point === 0x200c
    || (point >= 0x1f3fb && point <= 0x1f3ff)
    || isTag(point);
}

function hangulKind(point) {
  if ((point >= 0x1100 && point <= 0x115f) || (point >= 0xa960 && point <= 0xa97c)) return "L";
  if ((point >= 0x1160 && point <= 0x11a7) || (point >= 0xd7b0 && point <= 0xd7c6)) return "V";
  if ((point >= 0x11a8 && point <= 0x11ff) || (point >= 0xd7cb && point <= 0xd7fb)) return "T";
  if (point >= 0xac00 && point <= 0xd7a3) return (point - 0xac00) % 28 === 0 ? "LV" : "LVT";
  return "";
}

function joinsHangul(previous, next) {
  const left = hangulKind(previous);
  const right = hangulKind(next);
  return (left === "L" && ["L", "V", "LV", "LVT"].includes(right))
    || (["LV", "V"].includes(left) && ["V", "T"].includes(right))
    || (["LVT", "T"].includes(left) && right === "T");
}

function isRegionalIndicator(point) {
  return point >= 0x1f1e6 && point <= 0x1f1ff;
}

// Segmenter가 없는 런타임도 한글·결합 문자·복합 이모지를 UTF-16 중간에서 자르지 않는다.
function firstFallbackGrapheme(value) {
  let result = "";
  let previous = -1;
  let regionalCount = 0;
  let pictographBeforeJoiner = false;
  let lastBaseIsPictograph = false;
  for (const character of value) {
    const point = character.codePointAt(0);
    const isPictograph = pictographPattern.test(character);
    if (!result) {
      result = character;
      regionalCount = isRegionalIndicator(point) ? 1 : 0;
      lastBaseIsPictograph = isPictograph;
    } else if (isExtend(character, point)) {
      result += character;
    } else if (point === 0x200d) {
      result += character;
      pictographBeforeJoiner = lastBaseIsPictograph;
    } else if (previous === 0x200d && pictographBeforeJoiner && isPictograph) {
      result += character;
      lastBaseIsPictograph = true;
    } else if (joinsHangul(previous, point)) {
      result += character;
      lastBaseIsPictograph = false;
    } else if (regionalCount === 1 && isRegionalIndicator(previous) && isRegionalIndicator(point)) {
      result += character;
      regionalCount += 1;
      lastBaseIsPictograph = false;
    } else {
      break;
    }
    previous = point;
  }
  return result;
}

function firstGrapheme(value) {
  const Segmenter = globalThis.Intl?.Segmenter;
  if (typeof Segmenter === "function") {
    try {
      if (cachedSegmenterConstructor !== Segmenter) {
        cachedSegmenter = new Segmenter("ko", { granularity: "grapheme" });
        cachedSegmenterConstructor = Segmenter;
      }
      return cachedSegmenter.segment(value)[Symbol.iterator]().next().value?.segment ?? "";
    } catch {
      // 부분 지원 런타임에서도 이름 표시 전체를 실패시키지 않는다.
    }
  }
  return firstFallbackGrapheme(value);
}

export function getProfileInitial(name) {
  const cleaned = cleanName(name);
  if (!cleaned) return "?";
  const initial = firstGrapheme(cleaned);
  // ß/ﬃ처럼 대문자화로 글자가 늘어나는 경우에도 한 글자만 표시한다.
  return firstGrapheme(initial.toUpperCase().normalize("NFC")) || "?";
}
