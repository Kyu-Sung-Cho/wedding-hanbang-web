import { normalizeAmoraSafetyText } from "./amoraCrisisClassifier";

// This is the ordinary-chat threshold shared by web and mobile. Keep the
// broader mediation-only coercion threshold in mediationOffer.ts: applying it
// here would silently divert ordinary couple conversation into a safety lane.
//
// 폭력 어휘는 **어형 단위로** 관리한다. 어간이 있어도 어형 하나가 빠지면 조용히 샌다.
// 안전 판정이 먼저 도는데 거기서 안 걸리면 그대로 아래로 흘러 웨딩 낱말에 잡히고,
// 신체 폭력 서술이 W0(커플 공유 장기 기억 적격)으로 남는다. 실측(2026-08-21, 이식 전):
//
//     "예식장 계약했는데 남편이 저를 밀쳤어요"   -> W0 · 기억 ON
//     "청첩장 돌리는 중인데 남편이 물건을 던졌어요" -> W0 · 기억 ON
//
// 이 목록은 origin/main 의 apps/web/src/lib/ai/amoraQuestionScope.ts 와 **바이트 단위로
// 같아야 한다.** 어휘가 여기 packages/shared 로 옮겨 오면서 `밀쳤`·`던졌` 두 어형이
// 빠졌었고, 그동안 저장소 전체가 초록불이었다. 가드는 이식한
// apps/web/src/lib/ai/__tests__/amoraViolenceConjugation.test.ts 하나뿐이다.
//
// **`던져`(현재형)는 넣지 않는다. 결정된 사항이다.** main 이 두 번 넣었다가 두 번 되돌렸다 —
// `던져`는 -어 연결형이라 보조용언과 합성동사를 만들고(던져놓다·던져두다·던져주다·던져버리다)
// 그 합성형은 `던지` 철자를 갖지 않아 예전에는 걸릴 수 없었다. main 측정(폭력 7 / 평범 9):
//
//     던져 무조건          탐지 7/7 · 오탐 9/9
//     던져 + 보조용언 제외   탐지 4/7 · 오탐 4/9
//     던졌만 (현재)        탐지 2/7 · 오탐 0/9
//
// 위 테스트 파일이 `던져` 오탐 문장 여덟 개를 고정해 두었으니, 넣으면 거기서 깨진다.
//
// **다만 `던졌`의 "오탐 0"은 `던졌`를 겨냥하지 않은 코퍼스에서 나온 값이다.** 그 아홉
// 문장은 전부 `던져`+보조용언이라 `물건 + 던졌` 틀을 건드릴 수 없다. 겨냥해서 재면
// "이사하면서 안 쓰는 물건을 던졌어요" 같은 평범한 문장이 걸린다. 같은 뜻을 이미 배포된
// `던지`로 쓰면 그 전에도 걸렸으므로 새 노출 계층은 아니지만, 중재 쪽은 다르다 —
// mediationOffer.ts 는 `밀쳤`를 이미 갖고 있어 `밀쳤` 확장은 중재에 새로 닿지 않는 반면,
// `던졌`는 중재 전용 어휘가 일부러 요구하는 `화나면|싸우면` 접두와 행위자·방향 결속을
// 우회해 새로 닿는다. **두 어형의 값은 같지 않다.**
//
// 남은 진짜 결함은 어형이 아니라 **행위자 무제약**이다. 아래 첫 틀은 대상(`저를`)만,
// 던지다 틀은 목적어(`물건`)만 묶어서 제3자·사고 서술도 걸린다(인파에 밀림, 택배 기사).
// 어휘를 늘릴수록 이 함정이 커진다. 행위자를 묶는 틀은 이미 mediationOffer.ts 에 있다.
// 그건 어휘가 아니라 틀 재설계이고 파운더 판단 사안이라 여기서 건드리지 않았다.
const HIGH_RISK_SAFETY_PATTERN =
  /가정\s*폭력|데이트\s*폭력|폭력|폭행|협박|신체적\s*위협|강압적(?:인|으로)?\s*통제|감금|스토킹|손찌검|(?:저|제|나|내)(?:를|을|한테|에게)\s*[^.!?\n]{0,10}?(?:때린|때렸|때려|때리려|밀쳐|밀치|밀쳤|밀었)|(?:때린|때렸|때려)\s*(?:적|뒤|이후|후)|때리려고\s*(?:손|팔)|주먹질|목(?:을|를)?\s*(?:조른|졸랐)|물건(?:을|를)?\s*(?:던지|던졌|집어\s*던)/iu;
const HIGH_RISK_SAFETY_CONCRETE_PATTERN =
  /(?:돈|카드|통장|계좌).{0,16}(?:못\s*쓰|통제|감시|검사)|(?:폰|휴대폰|연락|위치).{0,24}(?:검사|추적|통제|감시)|(?:예비\s*신랑|예비\s*신부|남친|여친|파트너|상대방|그\s*사람|배우자|남편|아내|남자친구|여자친구|신랑|신부|상대)(?:에게|한테|가|이|은|는)?\s*.{0,40}(?:맞았|때렸|때릴|때릴까|죽(?:인|이겠)다고|죽여\s*버린다고|죽여\s*버리겠다고|(?:방|집|차)(?:에|에서)?\s*.{0,12}가둬)|동의\s*없이\s*.{0,24}(?:옷(?:을|를)?\s*벗(?:기|겼)|성관계|성적\s*행위)/iu;
const HIGH_RISK_HYPOTHETICAL_SAFETY_PATTERN =
  /(?:누가|누군가|사람이|친구가)?\s*(?:그만\s*살고\s*싶|죽\s*고\s*싶|자살|자해).{0,32}(?:말하면|하면|도와|어떻게|위험)|(?:수면제|진통제|타이레놀|아세트아미노펜|졸피뎀|약|알약)(?:을|를)?\s*(?:(?:열|열다섯|스무|스물|서른|마흔|쉰)\s*알|[1-9]\d{1,}\s*알).{0,16}(?:먹으면|복용하면|위험)/iu;

export function hasAmoraChatSafetySignal(userText: string): boolean {
  const normalizedText = normalizeAmoraSafetyText(userText);
  return HIGH_RISK_SAFETY_PATTERN.test(normalizedText)
    || HIGH_RISK_SAFETY_CONCRETE_PATTERN.test(normalizedText)
    || HIGH_RISK_HYPOTHETICAL_SAFETY_PATTERN.test(normalizedText);
}
