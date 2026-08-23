/**
 * 공개 글에 **본인 연락처**가 섞여 나가는 것을 알린다.
 *
 * ## 왜 필요한가
 *
 * 커뮤니티 글은 로그인하지 않아도 읽힌다. 즉 여기 적은 전화번호는 공개 인터넷에
 * 올라간다. 그런데 작성 경로에는 HTML·미디어 검증만 있고 연락처 검사가 없었다
 * (2026-08-23 확인). 결혼 커뮤니티에서 "카톡 아이디로 연락 주세요"는 아주 흔한
 * 문장이라, 이대로면 사용자가 스스로 연락처를 공개하고 그 사실을 모른다.
 *
 * ## 막지 않고 알린다
 *
 * 이 함수는 **판정하지 않는다.** 무엇이 들어 있는지만 돌려주고, 올릴지 말지는
 * 사용자가 정한다. 글을 고쳐 쓰거나 가리지도 않는다 — 사용자의 글을 제품이 조용히
 * 바꾸면 그 자체가 신뢰 문제다.
 *
 * ## 무엇을 일부러 안 잡는가
 *
 * - **업체 유선번호(02-…, 031-…)**: 업체의 공개 대표번호를 공유하는 것은 이 커뮤니티가
 *   하라고 있는 일에 가깝다. 본인 연락처와 성격이 다르다.
 *   ⚠️ 010 은 업체 번호일 수도 있지만, 개인 번호일 가능성이 훨씬 크므로 잡는다.
 *   경고는 막지 않으므로 오탐 비용은 한 번 더 누르는 것뿐이다.
 * - **인스타 아이디·DM 언급**: 모양이 너무 넓어 평범한 문장을 자주 문다.
 * - **날짜·금액**: 아래 검사가 자리수와 구분자를 모두 요구하므로 `2026.10.10`,
 *   `3,010,000원` 같은 값은 걸리지 않는다. 회귀 검사로 고정돼 있다.
 */

export type PublicPostContactKind = "phone" | "kakao" | "email";

/**
 * 010 으로 시작하는 휴대전화. 구분자는 없거나 `-`, `.`, 공백.
 *
 * 앞뒤로 숫자가 더 붙으면 전화번호가 아니다(계좌·일련번호). 그래서 낱말 경계 대신
 * 숫자를 직접 막는다 — 막으려는 것이 "숫자에 파묻힌 010" 이므로 조건을 그대로 적는다.
 *
 * 정직하게 적어 둔다: 시험한 문장들에서는 낱말 경계로 바꿔도 결과가 같다(변형으로
 * 확인, 바꿔도 16개 전부 통과). 처음 주석에는 낱말 경계가 3,010,000 을 문다고 썼는데
 * 틀렸다 — 구분자 클래스에 쉼표가 없어 어느 쪽이든 물지 않는다. 지금 선택은 의도를
 * 문자로 남기는 쪽이지 검사가 증명한 차이가 아니다.
 */
const PHONE_RE = /(?<![0-9])010[-.\s]?[0-9]{3,4}[-.\s]?[0-9]{4}(?![0-9])/u;

/**
 * 카카오톡 **아이디 자체**, 그리고 오픈채팅 링크.
 *
 * ⚠️ 언급만으로는 잡지 않는다. 처음에는 "카톡|카카오톡" + `아이디|문의|링크` 를 잡게
 * 만들었는데, 그 낱말을 겨냥해 평범한 문장을 만들어 재보니 11개 중 3개가 걸렸다.
 *
 *     "카톡 아이디 물어봤는데 안 알려주더라고요"
 *     "업체가 카톡으로 문의하라고 해서 했어요"
 *     "카카오톡 상담 링크가 홈페이지에 있어요"
 *
 * 셋 다 공개된 연락처가 **없다.** 한국 결혼 커뮤니티는 카톡을 매 글에서 말하므로,
 * 이대로 두면 경고가 늘 떠서 사용자가 무시하게 된다. 경고는 무시당하는 순간 없는
 * 것과 같다.
 *
 * 그래서 **로마자로 시작하는 식별자 토큰**이 붙어 있을 때만 잡는다. "알려드릴게요"
 * 처럼 주겠다는 말도 잡지 않는다 — 그 글에는 아직 아무것도 노출돼 있지 않다.
 */
const KAKAO_RE =
  /(?:카카오톡|카톡|오픈\s*채팅|오픈톡)\s*(?:아이디|id)?\s*[:：]?\s*[A-Za-z][A-Za-z0-9._-]{2,}|open\.kakao\.com|(?:아이디|id)\s*[:：]\s*[A-Za-z][A-Za-z0-9._-]{2,}/iu;

/** 이메일. 흔한 오탐이 없어 모양만 본다. */
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u;

const CHECKS: ReadonlyArray<readonly [PublicPostContactKind, RegExp]> = [
  ["phone", PHONE_RE],
  ["kakao", KAKAO_RE],
  ["email", EMAIL_RE],
];

const LABELS: Readonly<Record<PublicPostContactKind, string>> = {
  phone: "전화번호",
  kakao: "카카오톡 아이디",
  email: "이메일 주소",
};

/**
 * 공개 글에 섞인 연락처의 종류를 돌려준다. 없으면 빈 배열.
 *
 * 여러 조각을 한 번에 넘겨도 된다(제목 + 본문). 위치는 돌려주지 않는다 — 사용자가
 * 자기 글에서 찾는 편이 낫고, 위치를 짚어주려면 원문을 다시 다뤄야 한다.
 */
export function findPublicPostContactDetails(
  ...parts: ReadonlyArray<string | null | undefined>
): PublicPostContactKind[] {
  const text = parts.filter((part): part is string => typeof part === "string").join("\n");
  if (text.trim() === "") return [];
  return CHECKS.filter(([, pattern]) => pattern.test(text)).map(([kind]) => kind);
}

/**
 * 무엇이 들어 있는지만 말하는 한 문장. 뒤에 붙일 말은 화면마다 다르다 —
 * 앱은 "그대로 올릴까요?"로 묻고, 웹은 이미 있는 확인 체크박스를 가리킨다.
 */
export function describePublicPostContactFinding(
  kinds: readonly PublicPostContactKind[],
): string | null {
  if (kinds.length === 0) return null;
  return `글에 ${kinds.map((kind) => LABELS[kind]).join(", ")}가 들어 있어요.`;
}

/**
 * 앱에서 올리기 직전에 한 번 묻는 문장. 무엇이 들어 있는지 말하고, 공개 범위를
 * 알리고, **결정은 넘긴다.** 막지도, 글을 고치지도 않는다.
 */
export function describePublicPostContactWarning(
  kinds: readonly PublicPostContactKind[],
): string | null {
  const finding = describePublicPostContactFinding(kinds);
  if (!finding) return null;
  return `${finding} 커뮤니티 글은 로그인하지 않아도 볼 수 있어요. 그대로 올릴까요?`;
}
