import { normalizeAmoraSafetyText } from "./amoraCrisisClassifier";

// This is the ordinary-chat threshold shared by web and mobile. Keep the
// broader mediation-only coercion threshold in mediationOffer.ts: applying it
// here would silently divert ordinary couple conversation into a safety lane.
const HIGH_RISK_SAFETY_PATTERN =
  /가정\s*폭력|데이트\s*폭력|폭력|폭행|협박|신체적\s*위협|강압적(?:인|으로)?\s*통제|감금|스토킹|손찌검|(?:저|제|나|내)(?:를|을|한테|에게)\s*[^.!?\n]{0,10}?(?:때린|때렸|때려|때리려|밀쳐|밀치|밀었)|(?:때린|때렸|때려)\s*(?:적|뒤|이후|후)|때리려고\s*(?:손|팔)|주먹질|목(?:을|를)?\s*(?:조른|졸랐)|물건(?:을|를)?\s*(?:던지|집어\s*던)/iu;
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
