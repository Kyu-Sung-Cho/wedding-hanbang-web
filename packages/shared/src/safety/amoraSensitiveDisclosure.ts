import { normalizeAmoraSafetyText } from "./amoraCrisisClassifier";

/**
 * 공유를 선택한 뒤 입력한 민감한 고백의 공개 범위만 보호한다.
 * 즉시 위험·자해 의도·학대를 확정하지 않는다. 호출자는 기존 비즉시 나만 상담으로
 * 보내고, 원문을 상대에게 보내거나 준비 도구·장기 기억에 사용하지 않는다.
 * 주체/행위가 같은 절에 있어야 하며 부정·인용·명시적 일상 용도는 그 절에서 제외한다.
 */
const PARTNER = "(?:예비\\s*신랑|예비\\s*신부|남자\\s*친구|여자\\s*친구|남편|아내|와이프|신랑|신부|예랑이?|예신이?|남친|여친|배우자|약혼자|약혼녀|애인|그\\s*사람)";
const END = "(?=$|[\\s.!?,~…ㅠㅜㅋㅎᅲᅮᄏᄒ]|[\\p{So}])";
const MODIFIER = "(?:자꾸|계속|매일|맨날|또|어제|오늘|방금|아까|요즘|항상|술(?:을)?\\s*(?:먹으면|마시면|먹고|취하면)|화(?:가)?\\s*나면|싸우다가|손으로|주먹으로|발로)";
const TARGET = "(?:저를|나를|절|날|저한테|나한테|아이(?:를)?|애(?:를)?|아기(?:를)?|자식(?:을)?|강아지(?:를)?|고양이(?:를)?|반려동물(?:을)?|벽(?:을)?|문(?:을)?|얼굴(?:을)?|뺨(?:을)?|몸(?:을)?)";
const PHYSICAL = "(?:때려(?:요|서)?|때렸(?:어(?:요)?|다|습니다)|때리(?:고|는데|면서)|때린다고\\s*(?:했어(?:요)?|해(?:요)?)|밀쳐(?:요|서)?|밀쳤(?:어(?:요)?|다)|목(?:을)?\\s*(?:졸라(?:요|서)?|졸랐어(?:요)?)|걷어찼어(?:요)?|찼어(?:요)?)";
const PARTNER_VIOLENCE = new RegExp(`${PARTNER}(?:이|가|은|는|도)\\s*(?:${MODIFIER}\\s*)*(?:${TARGET}\\s*)?(?:${MODIFIER}\\s*)*${PHYSICAL}${END}`, "u");
const PASSIVE = new RegExp(`${PARTNER}(?:한테|에게)(?:서)?\\s*(?:${MODIFIER}\\s*)*(?:맞아(?:요)?|맞았어(?:요)?|맞고\\s*(?:있어(?:요)?|살아(?:요)?))${END}`, "u");
const CONDITIONAL_PASSIVE = new RegExp(`${PARTNER}(?:이|가)\\s*(?:술(?:을)?\\s*(?:먹으면|마시면|취하면)|화(?:가)?\\s*나면|싸우면)\\s*맞아(?:요)?${END}`, "u");
const CONDITIONAL_THREAT = /(?:말(?:을)?\s*안\s*들으면|연락(?:을)?\s*안\s*받으면|파혼하면|헤어지면|이혼하면|신고하면|거절하면|떠나면|도망가면|(?:헤어지자|이혼하자|파혼하자)고\s*하면)\s*(?:(?:남편|아내|신랑|신부)(?:이|가)\s*)?(?:죽인대(?:요)?|죽이겠대(?:요)?|때린대(?:요)?|가만\s*안\s*둔대(?:요)?)(?=$|[\s.!?,~…])/u;
const ISOLATION = /(?:친구(?:들)?|가족|부모님|엄마|아빠|동료)(?:을|를|도|하고|랑)?\s*못\s*만나게\s*(?:해(?:요|서)?|했어(?:요)?|합니다|하고)(?=$|[\s.!?,~…])/u;
const FIGHT_INJURY = /싸우다가\s*(?:다쳤어(?:요)?|멍(?:이)?\s*들었어(?:요)?|피(?:가)?\s*났어(?:요)?)(?=$|[\s.!?,~…])/u;

const META = /(?:영화|드라마|소설|만화|게임|뉴스|기사)(?:에서|속|에\s*나온)|(?:대사|가사|인용|예문)(?!(?:가|는|이|은)?\s*아니)|(?:가상\s*상황|등장인물)|연출(?:한|된)\s*장면|(?:축구|농구|야구|격투기|복싱|태권도|운동)(?:하다|하면서|중|에서)|(?:라고|라는|다는)\s*(?:말|표현|문장|글)(?:을|이|의|에|은|는)?\s*(?:읽|봤|보|연습|분석|번역)/u;
const NEGATED = /(?:안|못)\s*(?:때려|때리|밀쳐|밀치|맞아|맞았|다쳤)|(?:때리|밀치|맞|싸우|잡|붙잡|누르|빼앗|뺏|토하|게워|싶)지\s*않|(?:때린|맞은|싸운|다친|잡은|빼앗은)\s*적(?:이|은|도)?\s*없|(?:자살|자해)\s*(?:생각|충동)(?:이|은|을|도)?\s*(?:(?:자꾸|계속|요즘|가끔|또|매일)\s*)*(?:안\s*(?:해|하|나|들)|(?:나지|하지|들지)\s*않|해\s*본\s*적(?:이|은|도)?\s*없|없)|(?:못\s*만나게\s*하|통제하)지\s*않/gu;
const IDEATION = /(?:자살|자해)\s*(?:생각|충동)(?:이|은|을|도)?\s*(?:(?:자꾸|계속|요즘|가끔|또|매일)\s*)*(?:나(?:요)?|났어(?:요)?|들어(?:요)?|해(?:요)?|했어(?:요)?|해\s*본\s*적(?:이)?\s*있어(?:요)?|있어(?:요)?)(?=$|[\s.!?,~…]|[\p{So}])/u;
const MEDICINE_GATHERING = /(?<![가-힣])(?:수면제|수면\s*유도제|수면약|안정제|진통제|처방약|알약|농약|약)(?:을|를|은|는|도)?\s*(?:(?:이미|벌써|많이|다|하나씩|조금씩|한\s*달\s*치|두\s*달\s*치|\d+\s*(?:알|개|일\s*치))\s*)*(?:모아\s*(?:뒀|두었|놨|놨어|놓았)|모았|모으고\s*있|모으는\s*중)/u;
const ORDINARY_MEDICINE = /(?:상비약|영양제)|(?:여행|복용|처방|치료)[^.!?\n]{0,35}(?:먹|복용|챙|받|준비|쓸|사용)|(?:버리|버렸|버릴|버려|폐기|반납)|모으는\s*(?:거|것)(?:을)?\s*그만/u;

const SELF_INJURY_URGE = /(?:나|저|내\s*자신|제\s*자신)(?:를|을)\s*(?:다치게|해치고|해칠|상처\s*내고)[^.!?\n]{0,18}(?:싶|충동)/u;
const SLEEP_DEATH_WISH = /(?:잠들|잠든|자고|잠자)[^.!?\n]{0,18}(?:안|않고)\s*(?:깼으면|깨어났으면|깨어나고\s*싶|일어났으면|눈(?:을)?\s*떴으면)/u;
const PARTNER_ACTOR = new RegExp(`${PARTNER}(?:이|가|은|는|도)`, "u");
const FORCED_RESTRAINT = /(?:팔|손목|목|어깨|몸)(?:을|를)?\s*(?:세게|강하게|억지로|꽉)\s*(?:잡|붙잡|누르|눌러)/u;
const PHONE_TAKING = /(?:휴대폰|핸드폰|전화기|폰)(?:을|를)?\s*(?:빼앗|뺏)/u;
const ORDINARY_PHONE_PURPOSE = /(?:사진|영상|지도|길|통화|전화|음악|충전|설정)(?:을|를)?\s*(?:(?:좀|같이|함께)\s*)?(?:보|확인하|찾|걸|하|틀|해주|바꾸)으?려(?:고|구)/u;
const PHONE_COERCION = /강제로|억지로|무서|위협|감시|검사|뒤져|뒤지|(?:연락|통화|전화|사용)(?:을|를)?\s*(?:못|막|금지)|돌려\s*주지\s*않|안\s*돌려/u;
const BLOCKED_EXIT = /문(?:을)?\s*(?:막|잠그|잠갔)/u;
const EXIT_DANGER = /(?:나가지|나갈\s*수)\s*(?:못|없)|밖에\s*못|(?:벽|문)(?:을)?\s*주먹으로\s*(?:쳐|쳤|치고)|무서|위험|가둬|가두/u;
const IMAGE_THREAT = /(?:사적인?|은밀한|노출|알몸|성적인?)\s*(?:사진|영상)(?:을|를)?[^.!?\n]{0,20}(?:올리겠|퍼뜨리|공개하겠|유포하겠|보내겠)/u;
const EXIT_CONDITION = /(?:헤어지|이혼|파혼|신고|거절)[^.!?\n]{0,12}(?:하면|면)/u;
const IMPAIRING_ANXIETY = /(?:숨(?:이)?\s*(?:막히|가쁘)|손(?:이)?\s*떨)[^.!?\n]{0,30}(?:못\s*나가|나갈\s*수\s*없|공황|불안)|공황[^.!?\n]{0,24}(?:도움|상담|못\s*(?:나가|자|먹|하))/u;
const INTENTIONAL_PURGING = /(?:먹고(?:\s*나서)?|먹은\s*뒤|식사\s*후)[^.!?\n]{0,16}(?:일부러|억지로)\s*(?:토하|토해|게워)/u;

export function hasAmoraSensitiveDisclosure(value: string): boolean {
  const normalized = normalizeAmoraSafetyText(value);
  // 비교·화제 전환 뒤의 새 고백에 앞 절의 부정·작품 문맥을 전파하지 않는다.
  // 분리 뒤에도 대사·장면·연출을 명시한 절에는 기존 콘텐츠 제외 규칙을 적용한다.
  const clauses = normalized.split(/[.!?\n]+|(?:하지만|그런데|근데|그렇지만|것처럼|일인데|(?:이야기|얘기)하다가|찾아보려는데)\s*/u);
  return clauses.some((raw) => {
    // 부정된 행위만 지운다. 같은 절의 별개 고백까지 안전하다고 무르지 않는다.
    const clause = raw.replace(NEGATED, " ").trim();
    // 웃음 표시나 실제 지인의 고백이라는 이유로 공개해도 되는 것은 아니다.
    if (!clause || META.test(clause)) return false;
    if (IDEATION.test(clause)) return true;
    if (MEDICINE_GATHERING.test(clause) && !ORDINARY_MEDICINE.test(clause)) return true;
    return PARTNER_VIOLENCE.test(clause) || PASSIVE.test(clause) || CONDITIONAL_PASSIVE.test(clause)
      || CONDITIONAL_THREAT.test(clause) || ISOLATION.test(clause) || FIGHT_INJURY.test(clause)
      || SELF_INJURY_URGE.test(clause) || SLEEP_DEATH_WISH.test(clause)
      || (PARTNER_ACTOR.test(clause) && (FORCED_RESTRAINT.test(clause)
        // 사진 확인처럼 명시된 일상 목적은 무른다. 강요·연락 차단·공포는 그 목적보다 우선한다.
        || (PHONE_TAKING.test(clause) && (!ORDINARY_PHONE_PURPOSE.test(clause) || PHONE_COERCION.test(clause)))
        || (BLOCKED_EXIT.test(clause) && EXIT_DANGER.test(clause))))
      || (IMAGE_THREAT.test(clause) && (PARTNER_ACTOR.test(clause) || EXIT_CONDITION.test(clause)))
      || IMPAIRING_ANXIETY.test(clause) || INTENTIONAL_PURGING.test(clause);
  });
}
