/**
 * 저장된 글이 이미 못 읽게 된 자리를 화면이 어떻게 다룰 것인가.
 *
 * ## 무엇을 확인했나 (2026-09-02)
 *
 * 이 저장소에 **깨진 한글이 실제로 커밋돼 있다.** 두 곳이고, 한 곳은 사용자에게
 * 나가는 오류 문구였다. 그 문자열의 코드포인트를 세어 보면 성질이 드러난다.
 *
 *     apps/web/src/app/api/admin/reports/[id]/route.ts:148
 *       ASCII '?'(U+003F) 19자 · 한글 음절 17자 · 한자 4자 · 한글 낱자모 2자
 *
 * 라틴 문자로만 이루어진 깨짐이 아니다. 한자와 낱자모가 섞여 있다는 것은 UTF-8
 * 바이트를 **두 바이트 한국어 코드페이지(CP949)** 로 읽었다는 뜻이다. 그리고 그
 * 안의 물음표는 U+FFFD 가 아니라 **ASCII 0x3F** 다 — 매핑이 없는 자리에 대체
 * 문자를 넣은 것이 아니라 **원문 바이트를 버리고** 물음표를 찍은 것이다.
 *
 * 운영에서도 같은 성질이 기록돼 있다. `lib/ai/amoraToolPolicy.ts` 의 2026-08-24
 * 실측: 체크리스트 항목 173개 중 90개, 19커플 중 15커플의 저장 라벨이
 * `'??? ??? ??'` 였다. 이쪽은 한자도 낱자모도 없이 **물음표뿐**이라 한 글자를
 * 한 바이트로 떨어뜨리는 변환이다. 역시 원문 바이트가 남아 있지 않다.
 *
 * ## 그래서 되돌리기를 하지 않는다
 *
 * 두 경우 모두 **원문이 이미 없다.** 잘못 읽은 것이 아니라 버려진 것이라, 어떤
 * 코드도 되돌리지 못한다. 되돌릴 수 있는 종류(UTF-8 을 Latin-1 로 읽어 글자가
 * 하나도 안 사라진 경우)는 이 저장소 어디에서도 관찰되지 않았다 — 2026-08-05
 * 전수 스캔도 0건이었다(`docs/AMORA_2_0_GAP_SURVEY.json`). 관찰되지 않은 종류를
 * 위해 복원기를 싣지 않는다. 어느 종류인지는 저장된 바이트를 봐야 정해지고,
 * 그 절차는 `docs/operations/LOUNGE_STORED_KOREAN_REPAIR_2026-09-02.md` 에 있다.
 *
 * ## 그러면 화면은 무엇을 하나
 *
 * **잔해를 사용자가 쓴 글인 척 그리지 않는다.** `?? ???` 를 제목 자리에 그대로
 * 두면 화면이 사실이 아닌 말을 하는 것이고, 사용자는 그것이 자기가 쓴 제목인 줄
 * 안다. 짧은 라벨이면 물러나서 그렇다고 말하고, 사용자가 그 자리에서 다시 적게
 * 한다.
 */

/** 한글 음절·자모가 하나라도 있는가. */
function containsHangul(value: string): boolean {
  return /[\uac00-\ud7a3\u1100-\u11ff\u3130-\u318f]/u.test(value);
}

/**
 * 못 읽게 된 흔적이 있는가. 진단·집계용이다.
 *
 * - U+FFFD 가 있으면 확정이다. 그 자리는 원래 바이트를 버린 자리다.
 * - `?` 는 사람이 쓴 물음표일 수도 있다. 그래서 **한글이 하나도 없으면서**
 *   물음표가 둘 이상 붙어 있을 때만 흔적으로 본다.
 *
 * 화면에서 무엇을 그릴지는 이 값으로 정하지 않는다 — `isUnreadableText` 를 쓴다.
 * 흔적이 있어도 읽을 수 있는 글이 남아 있으면 그 글을 보여주는 편이 낫다.
 */
export function hasTextCorruptionMarker(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\ufffd")) return true;
  return /\?{2,}/u.test(value) && !containsHangul(value);
}

/**
 * 읽을 글자가 하나도 남지 않았는가.
 *
 * 깨짐 자리(`?`, U+FFFD)와 공백·문장부호를 걷어냈을 때 아무것도 안 남으면 그
 * 문자열은 제목이 아니라 잔해다(`?? ???`). 반대로 `D-DAY??` 는 걷어내도 `DDAY`
 * 가 남으므로 사용자가 쓴 제목으로 본다 — 물음표를 이유로 사람이 쓴 제목을
 * 감추지 않는다.
 *
 * 절반만 깨진 글(`드레스 ?? 방문`)도 감추지 않는다. 남아 있는 절반이 사용자에게
 * 그 줄이 무엇인지 알려 주고, 그것이 없는 안내문보다 쓸모 있다.
 */
export function isUnreadableText(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  if (!value.includes("?") && !value.includes("\ufffd")) return false;
  return !/[\p{L}\p{N}]/u.test(value.replace(/[?\ufffd]/gu, ""));
}

/**
 * 짧은 라벨 자리에 쓴다. 읽을 글자가 하나도 안 남았으면 부르는 쪽이 준 문구를
 * 돌려준다.
 *
 * **긴 기록에는 쓰지 않는다.** 대화 말풍선처럼 두 사람이 나눈 기록은 일부가
 * 깨졌다고 통째로 안내문으로 바꾸면 남아 있는 정보까지 사라진다.
 */
export function readableTextOr(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value : "";
  return isUnreadableText(text) ? fallback : text;
}
