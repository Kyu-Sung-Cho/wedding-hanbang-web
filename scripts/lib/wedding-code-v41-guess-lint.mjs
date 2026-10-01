/**
 * 웨딩코드 4.1 단계 2 「서로 짐작하기」 세트 검사기 라이브러리(schema wedding-code-guess/4). 명령줄은 scripts/wedding-code-v41-guess-lint.mjs 다.
 * 시작점은 stage2/lint_guess_set.mjs(검토를 거친 /4 판)이고, 다른 파일에 기대지 않도록 낱말 목록과 정규식을 이 파일에 옮겨 적었다.
 * 그 판에서 바꾼 것(빌드 계획 5.3):
 *   1. 어휘 목록 파일 위치: 세트 파일 이름에서 .json 을 떼고 .vocab.json 을 붙인 파일이 세트 옆에 있다(vocabPathFor).
 *   2. 정직 규칙 교체: 소개 글은 「다르게 짐작한 장면만」과 「내 답과 함께 보내기」 링크, 「링크를 가진 사람은 누구나 읽을 수 있어요」를 말한다.
 *      옛 「상대에게 보내는 링크」는 「질문만 보내기」를 고른 사람에게는 거짓이라 오히려 위반이다. 빈 상태와 줄 없는 장면 한 줄(unlistedNote)은 「같았거나」와 「건너뛴」을 함께 말한다.
 *   3. 화면 문구 규칙 거울(copy.test.ts 의 낱말 규칙, 계획 A8): 자리, 데이터, 기기, 안 맞(단추 이름 밖), 문항, 측면, 오류 따위와 번호 라벨, 장면 이름꼴, 한 묶음 안 같은 문장.
 *   4. 새 필드 receiverIntro, unlistedNote 를 검사 대상에 넣고, 개발용 review 필드는 화면에 나가지 않는 값으로 둔다.
 *
 * 이 세트가 지켜야 하는 것(과제의 조건을 규칙 이름으로 옮긴 것):
 *   장면 여섯, 돈 준비 가족 지친 날 네 주제를 모두 덮고, 서로 다른 생활 영역 여섯(area)을 하나씩.
 *   장면 글(stem)은 한두 문장이고 끝에 「~면 괜찮아요」 꼴의 대체 길을 스스로 품는다(fallback-missing).
 *   카드 둘(a, b)은 각각 두 문장: 한 일(act)과 그 값(cost). 무게가 같고(equal-weight) 문장 틀이 같다(card-shape).
 *   평가어, 성향어, 좋아 보이는 말, 강한 정도말이 없고, 예식어, 부모·배우자·아이·동거 전제어가 없다.
 *   숫자(한글로 쓴 수와 기간 포함), 줄표, 퍼센트, 영문, 합쇼체, 원인 문장, 「당신은」, 진단어가 없다.
 *   탈출구: 내 답에는 「제 상황과 안 맞아요」와 「지금은 넘어갈게요」, 짐작에는 「잘 모르겠어요」 하나.
 *
 * 어휘 문(new-word)과 얼리기: 승인한 어휘 목록(세트 이름.vocab.json)에 없는 낱말은 new-word 로 막는다. 목록을 얼리는 일은 이 저장소의 어떤 코드도 하지 않고,
 * **글을 고친 사람이 아닌 사람**이 새 낱말을 문장째 읽은 뒤 명령줄의 --freeze 로만 한다. 얼리기 전에는 명령줄이 종료 코드 1 을 낸다(의도한 것이다).
 * vitest 시험(guessLint.test.ts)은 얼리지 않은 목록을 **경고로 보고만 하고** 빨갛게 만들지 않는다(다른 규칙 위반은 그대로 빨갛다).
 *
 * 정직한 한계(측정한 것): 이 검사기가 막는 것은 회귀뿐이다. 낱말 목록 규칙은 목록 밖 낱말을 거의 못 잡는다.
 * (1) 처음 만든 사람이 목록을 짠 뒤 목록에 없는 낱말로 새로 쓴 위반 39개 중 9개, 그 목록을 고친 뒤 또 새로 쓴 33개 중 6개만 잡았다(work_scripts/guess_set_unlisted_probe*.mjs 와 그 첫 실행 기록).
 * (2) 별도 감사자가 목록을 보지 않고 새로 쓴 위반 15개는 배포 상태 검사기에서 낱말·틀 규칙이 0개를 잡았고 15개 모두 어휘 문(new-word)이 새 낱말이라는 이유로 막았다.
 *     감사자가 목록과 유니코드 덮개를 보강한 뒤 또 새로 쓴 15개 중 의도한 규칙이 잡은 것은 3개(모두 유니코드·공백 갈래)였고, 우연히 걸린 것이 2개, 못 잡은 것이 10개였다(audit_lang/plants_*_out.txt, holdout_*_out.txt).
 * (3) 이 판에서 막은 구멍(실측으로 확인): 방향 격리 문자와 변이 선택자 속 「속마음」, U+058A 와 U+1400 같은 붙임표 닮은 글자, 띄어 쓴 두 글자 금지어 「진 짜」 「모 순」,
 *     「통화가」가 「화가」에, 「기울었어요」가 「울었」에 걸리는 오탐, 「삼십 분」 「이틀」 같은 한글 수, 「상대방」 「내게」 같은 지칭어. 이 보강은 본 낱말만 막는다. 목록을 더 늘리지 않는다.
 * (4) 수정자가 목록을 다시 보지 않고 새로 쓴 위반 20개(fix_work/holdout_final.mjs): 어휘 문을 끈 채 목록 밖 낱말 13개(감정어 머쓱, 성질어 의젓하게, 정도말 하염없이,
 *     돌잔치, 막내, 몇 차례, 본바닥, 「의미가 있어요」 따위)에서 의도한 규칙이 잡은 것은 0개였고(그중 4개는 길이 한도나 끝 줄 꼴에 우연히 걸렸다), 어휘 문(new-word)이 20개 모두 막았다.
 *     의도한 규칙이 잡은 것은 이미 목록에 있는 낱말(번번이, 끝내, 허락, 신혼, 왜)이거나 유니코드 갈래(반각 장음 기호)였다. 쓴 사람이 목록을 본 같은 모델이라 이 숫자도 낙관적이다.
 * 따라서 새 낱말은 얼린 어휘 문(new-word)과 그 앞의 사람 읽기가 막는다. 문은 새 낱말이 평가어인지 가르지 못하고 새 낱말이 있다는 사실만 막는다. 얼릴 때 사람이 읽은 만큼만 믿을 수 있다.
 * 동의어 바꿔치기와 뜻(두 카드가 정말 비슷한 무게인지, 실제 커플이 이 자리에서 갈리는지, 한 장면 안에서 두 카드의 값을 맞바꿔도 어느 문도 못 잡는다)은 어느 문도 잡지 못한다.
 * 무게 검사(equal-weight)는 길이, 문장 틀, 정도말 개수, 값의 종류 같은 대리 지표일 뿐 무게 그 자체가 아니다. 사람 평정과 사람 짝 맞추기(act 둘과 cost 둘을 섞어 눈가림으로 짝지어 보기)가 그 일을 한다.
 * 장면 여섯 가운데 넷(review.unreviewedItemIds)은 비평가 검토도 받지 않았고, 사람이 읽은 글은 하나도 없다. 이 검사기의 초록불은 그것을 대신하지 않는다.
 */
import fs from "node:fs";
import { basename, dirname, join } from "node:path";

export const LIMITS = {
  title: 16, intro: 150, note: 60, prompt: 40, escape: 16, caption: 16, stem: 120,
  act: 34, cost: 36, cardTotal: 72, tail: 60, empty: 110, rendered: 140,
  guessNote: 40, sub: 40, label: 20, subhead: 20, notice: 90,
  actRatio: 1.35, costRatio: 1.35, totalRatio: 1.25, tokenDiff: 3, setSpread: 1.5,
  sameActJaccard: 0.55, samePrefix: 9, mirrorJaccard: 0.25, crossItemJaccard: 0.5,
  perTopicMax: 2,
};
export const EXPECT = {
  schema: "wedding-code-guess/4",
  itemCount: 6,
  topics: ["money", "process", "scope", "support"],
  areas: ["ask-vs-guess", "fair-share", "all-vs-one", "last-word", "alone-vs-together", "ask-vs-wait"],
  escapeTexts: { notmine: "제 상황과 안 맞아요", skip: "지금은 넘어갈게요", unsure: "잘 모르겠어요" },
  escapesSelf: ["notmine", "skip"],
  escapesGuess: ["unsure"],
  openers: ["다만", "대신"],
  promptSelf: /골라 주세요\.$/,
  promptGuess: /^상대(는|가)[^.?]*어느 쪽[^.?]*골랐을 것 같아요\?$/,
  guessNote: /바라는 쪽이 아니라/,
  modes: ["meGuessedPartner", "partnerGuessedMe", "firstGuessedSecond", "secondGuessedFirst"],
  // 결과 줄 틀의 사람 지칭이 뒤바뀌지 않았는가: [사실 쪽 이름이 시작하는 말, 짐작 쪽 이름이 시작하는 말, 소제목이 시작하는 말]
  rowWho: {
    meGuessedPartner: ["상대가 고른 쪽", "내가 짐작한 쪽", "내가 짐작한 것"],
    partnerGuessedMe: ["내가 고른 쪽", "상대가 짐작한 쪽", "상대가 짐작한 것"],
    firstGuessedSecond: ["나중에 답한 사람이 고른 쪽", "먼저 답한 사람이 짐작한 쪽", "먼저 답한 사람이 짐작한 것"],
    secondGuessedFirst: ["먼저 답한 사람이 고른 쪽", "나중에 답한 사람이 짐작한 쪽", "나중에 답한 사람이 짐작한 것"],
  },
  noticeKeys: ["sendOwn", "sendCouple", "receive"],
};

// ------------------------------------------------------------------ 낱말 목록(lint_part2.mjs 2판에서 옮겨 적고 이 세트에 맞게 더했다)
/** 과제가 정한 금지어와 CLAUDE.md 의 금지어, 성향 낱말, 유형 낱말, 호칭 진단 낱말. */
export const BANNED = [
  "속마음", "숨은", "무의식", "진짜", "모순", "일관성", "본모습", "당신", "검증", "정확", "과학", "진단", "점수", "등급", "궁합", "MBTI", "엠비티아이", "스타일", "성격", "성향", "유형", "타입", "기질", "퍼센트", "백분율", "동물", "캐릭터", "하는 편", "편이에요",
  "숨겨", "숨긴", "감춘", "회피", "소극", "예민", "소심", "고집", "간섭", "책임감", "내향", "외향", "완벽주의", "의존", "집착", "방어", "무심", "냉정", "너는", "네가", "너의", "너도", "본인은", "본인이", "자기는", "신경질", "우유부단", "잔소리", "꼰대",
  // 3판(목록 밖 시험 반영): 편이 꼴의 다른 어미, 속마음의 동의어
  "편이죠", "편이라", "속내", "본심", "내면",
  // 수정자 판(감사 L04): 파운더 요청의 핵심이 「몰랐던 나」 과장이라 그 낱말과 동의어를 막는다
  "속맘", "민낯", "본성", "참모습", "속생각", "잠재의식", "몰랐던", "알지 못했던", "드러나", "드러낸", "드러내", "발견", "사실은", "알고 보면", "내심", "본바탕", "속으로",
];
/** 원인을 붙이는 말. 이 세트는 이유를 묻지도 붙이지도 않는다(카드의 값은 결과이고 이유가 아니다). */
export const CAUSAL = ["때문", "그래서", "따라서", "그러므로", "왜냐하면", "탓", "덕분", "원인", "이유", "까닭"];
export const CAUSAL_ENDING_RE = /(같아서|싶어서|없어서|있어서|않아서|많아서|라서|니까|므로|바람에|탓에|덕에|몰라서|아니어서|아니라서|다 ?보니|느라|인해|인지라|(?<![기아거저여])기에|는지라|는 통에|하는 통에|그런지|말미암|로 인|결과로|까 ?봐|길래|(?:한|은) 나머지)/;
/** 결혼식이 없는 커플도 답할 수 있어야 하므로 어떤 화면 글에도 예식 낱말을 쓰지 않는다. */
export const CEREMONY = ["결혼", "예식", "웨딩", "식장", "하객", "신부", "신랑", "혼수", "예단", "예물", "피로연", "청첩", "본식", "폐백", "드레스", "신혼", "혼인", "상견례", "예복", "한복", "주례", "부케", "스드메", "축의", "부조", "이바지", "식을 올", "혼례", "혼사", "혼주", "들러리", "답례품", "식대", "식권", "축가", "신접", "연회", "허니문", "턱시도", "폐물", "웨딩", "상견"];
/** 부모가 없는 사람, 혼인 전이나 혼인신고만 하는 사람, 함께 살지 않는 사람, 아이가 없는 사람, 재혼하는 사람에게 전제를 깔거나 상처가 되는 말. */
const ASSUME_PARTICLES = "(?:님|께서|께|가|는|은|를|을|도|와|과|의|에게|한테|랑|이랑|들|이|에|에서|으로|로|만|까지|부터)*";
export const ASSUME_SUBSTRINGS = ["친정", "시댁", "처가", "부모님", "시부모", "어머님", "아버님", "양가", "자식", "애들", "아기", "임신", "출산", "육아", "딸아이", "아들딸", "손주"];
export const ASSUME_RE = new RegExp(
  `(?<![가-힣])(부모|어머니|아버지|엄마|아빠|시댁|처가|친정|시가|장인|장모|시부모|어른|자녀|아들|딸|남편|아내|배우자|약혼|예비|아이|시어머니|시아버지|사위|며느리|와이프|여보)${ASSUME_PARTICLES}(?![가-힣])`
  + "|집안(?!일)|(?:같이|함께) ?(?:사는|살고|살아|살던|살며|살게|살면|살지|살다)|한 ?집|동거|(?:같이|함께) ?지내|같은 집|집들이|사돈|우리 ?애",
);
/** 카드와 장면에 들어가면 안 되는 평가어와 감정어. 사실(한 일과 생기는 일)만 적는다. */
export const EVAL = ["든든", "후련", "불안", "아쉬", "설레", "어색", "서운", "흐뭇", "섭섭", "편해", "편했", "편안", "불편", "답답", "속상", "미안", "죄송", "뿌듯", "홀가분", "찜찜", "허전", "벅차", "뭉클", "짜증", "화가 나", "화가 난", "화났", "포근", "푸근", "긴장", "조바심", "염려", "부럽", "샘나", "으쓱", "우쭐", "무서", "무섭", "두려", "걱정", "부담", "당황", "창피", "쑥스", "고마", "감사", "다행", "기뻤", "기쁘", "슬펐", "슬프", "외로", "억울", "초조", "조마조마", "떳떳", "후회", "만족", "행복", "좋았", "나빴", "싫었", "미웠", "반가", "자랑", "부끄", "서럽", "질투", "괴로", "힘들", "무거웠", "무겁", "가벼웠", "가벼워", "시원", "울컥", "눈물", "떨렸", "떨려", "허탈", "막막", "씁쓸", "짠했", "분했", "분하", "안도", "안심", "즐거", "재밌", "지루", "귀찮", "불쾌", "언짢", "괘씸", "야속", "원망", "얄미", "짜릿", "신났", "신나", "먹먹", "서글", "애틋", "그리웠", "그립", "민망", "난감", "당혹", "황당", "어이없", "뻘쭘", "서먹", "불만", "초라", "자책", "죄책", "조심스", "피곤", "실망", "흡족", "신이 나", "평온", "평안", "감격", "감동", "설렘", "허무", "안타까", "쓸쓸", "아깝", "뿌듯", "기운이 나", "힘이 나", "힘이 빠", "두근", "아련", "미련", "울적", "우울", "서운", "섭섭"];
/** 어느 카드가 더 나아 보이게 하는 말(좋고 나쁨, 미덕과 악덕, 칭찬과 꾸중, 쉬움과 어려움)과 사람 성질 낱말. 카드는 한 일과 생기는 일만 적는다. */
export const VALENCE = ["단호", "쿨하", "유연", "조급", "묵묵", "순순", "당당", "담백", "진솔", "여유", "신속", "꾹 참", "삼키", "억누", "끙끙", "삭이", "좋은", "좋아 보", "좋았", "좋아요", "좋다", "좋겠", "나쁘", "나쁜", "깔끔", "알뜰", "현명", "똑똑", "배려", "솔직", "정직", "성실", "꼼꼼", "부지런", "게으", "무책임", "이기적", "차갑", "따뜻", "다정", "섬세", "무던", "예의", "버릇", "당연", "제대로", "올바", "정상", "이상하", "옳", "틀리", "바람직", "훌륭", "멋", "착하", "못된", "인색", "헤프", "낭비", "사치", "검소", "절약", "충분히", "완벽", "최선", "최고", "최악", "역시", "무난", "편리", "편한", "편하", "수월", "쉬워", "쉬운", "쉽게", "빨라", "빠르", "간편", "힘겹", "고생", "수고", "기특", "대견", "칭찬", "혼나", "야단", "웃음", "웃으", "웃어", "미소", "한숨", "공정", "공평", "불공평", "합리", "효율", "이성적", "바르게", "바른", "착실", "알차", "센스", "이해심", "지혜", "영리", "깨끗", "정갈", "야무지", "사려", "융통", "정성", "성의", "공손", "진심", "진지", "냉철", "침착", "차분", "능숙", "서툴", "어설프", "번듯", "빈틈", "까다", "둔해", "둔한", "격식", "능청", "약삭", "야박", "너그러", "엄살", "뻔뻔"];
export const TRAIT = ["신중", "충동", "계획적", "즉흥", "주도", "적극", "독립적", "의존적", "감성", "논리", "감정적", "사교", "활발", "낯가림", "눈치", "깐깐", "털털", "무뚝뚝", "살갑", "다혈질", "낙천", "비관", "긍정", "부정적", "느긋", "성급", "급한", "습관", "체질", "본능", "천성", "타고난", "승부욕", "욱하", "다정다감", "낯을 가", "부끄럼", "자존심", "욕심", "허영", "오지랖", "겸손", "교만"];
/** 한 카드에만 결과나 서사를 붙이는 말. */
export const CONSEQUENCE = ["결국", "끝내", "마침내", "어쩔 수 없이", "결과적으로", "다퉜", "싸웠", "크게 다", "울었"];
/** 값의 무게를 한쪽으로 기울이는 강한 정도말과 빈도말(쓰지 않는다). 약한 정도말은 두 카드의 개수가 같아야 한다. */
export const STRONG = ["내내", "거의", "대부분", "허구한", "노상", "수시로", "틈만 나면", "걸핏하면", "툭하면", "줄기차", "한결같", "꾸준히", "왕창", "잔뜩", "종일", "온종일", "여전히", "때마다", "밤늦게까지", "아주", "너무", "매우", "몹시", "훨씬", "한참", "오래", "계속", "자주", "항상", "매번", "전혀", "절대", "반드시", "무조건", "끝없이", "영영", "완전", "엄청", "정말", "많이", "크게", "심하", "엄격", "철저", "굉장", "되게", "무척", "대단히", "상당히", "언제나", "날마다", "매일", "확실히", "죽어라", "한없이", "두고두고", "줄곧", "밤낮", "끊임없이", "쉴 새 없이", "하루 종일", "밤새", "유난", "유독", "번번", "어김없", "몇 배", "갑절", "곱절", "부쩍", "한층", "기어코", "기필코", "퍽"];
export const STRONG_STANDALONE = ["늘", "꼭"];
export const WEAK = ["조금", "약간", "잠깐", "잠시", "살짝", "가끔", "종종", "이따금", "때로", "한동안", "금세", "곧", "꽤", "제법", "다소", "얼마간"];
/** 해악, 통제, 감시, 두려움을 끌어내는 쪽으로 글이 흘러가지 않게 하는 회귀 방지 목록(없다는 증명이 아니다). */
export const HARM_CONTROL = ["몰래", "휴대폰", "핸드폰", "위치", "감시", "캐물", "추궁", "허락", "통제", "협박", "폭력", "소리를 질", "화를 낼", "눈치", "겁", "연락을 끊", "때렸", "때리", "욕을", "엿보", "훔쳐", "뒤져", "뒤졌", "가두", "빼앗", "우울", "공황", "트라우마", "학대", "가스라이팅", "윽박", "뒤를 밟", "대화창을 열", "불면", "거짓말", "속이고", "속여", "속였", "무시", "비난", "화를 내", "화내", "고함", "소리 지", "헤어", "이혼", "파혼", "갈라서", "틀어져", "틀어지", "토라", "냉전", "다투", "언쟁", "말다툼", "싸우", "언성", "냉랭", "삐걱", "서먹"];
/** 끝 줄, 빈 상태, 안내가 쓰면 안 되는 차이·비교·결론 주장(앞의 열둘만 쓴다. 소개 글은 「다르게 짐작한 자리만」을 꼭 말해야 해서 제외). */
export const CLAIM = ["달랐", "달라", "다르", "다른", "바뀌", "바뀐", "변했", "변한", "같은 주제", "같은 일인데", "차이", "반대"];
// 수사 앞이 한글 음절이면 수사가 아니다(「짐작한 장면」의 한 은 수가 아니다). 그래서 낱글자 묶음이 아니라 수사를 통째로 적는다.
export const COUNT_RE = /((가운데|중) ?[한두세네다섯여섯일곱여덟아홉열])|((?<![가-힣])(?:한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|몇) ?(?:가지|개|명|곳|장면|번|질문|문항))|절반|반쯤|대부분|나머지|모든 ?장면/;
/** 한글로 쓴 수와 기간(삼십 분, 이틀, 두 번, 반 시간, 절반). 한 자리 한자어 수(일 이 사)는 「이번」 「이 분」 오탐 때문에 뺐다. 「한 시간」을 수로 보는 것은 팀 정책이다. */
export const NUMBER_WORD_RE = /(?<![가-힣])(?:이틀|사흘|나흘|며칠|반나절|절반|반 시간|몇 ?(?:번|분|시간|가지|군데|장|곳|개)|(?:한|두|세|네|서너|두어) ?(?:번|시간|가지|군데|장면|곳)|(?:이십|사십|[삼오육칠팔구십백천][삼오육칠팔구십백천일이사]{0,3}) ?(?:분|시간|가지|군데|명|배|할))(?:[이가은는을를도만에의쯤씩]|(?![가-힣]))/;
export const TYPE_RE = /(사람인지|사람이라|사람이에요|사람이죠|사람일)/;
export const FEELING_Q_RE = /(어떤 (마음|기분|느낌)|(마음|기분|느낌)이 (어땠|어때|어떠|들었))/;
/** 짐작 화면에서 쓰면 안 되는 맞힘·틀림·평가·관계 예측 말. */
export const GUESS_CLAIM_RE = /맞고 틀리|짐작했는데|볼 만|얼마나 아는|아쉽|예상과|모두 같|전부 같|다 같|서로를 (?:잘|얼마나)|맞혔|맞았|맞힌|틀렸|틀린|정답|오답|일치|불일치|적중|빗나|엇나|들어맞|어긋났|예상 ?밖|의외|뜻밖|놀랍|몰랐|드러났|드러나/;
/** 소개, 안내, 끝 줄, 빈 상태, 결과 줄이 하면 안 되는 관계 예측·궁합·이해 주장. */
export const REL_CLAIM_RE = /잘 맞|안 맞는 사이|궁합|이해심|더 이해|서로를 알|서로 알|사이인지|관계가 |사이가 |잘 아는|얼마나 알|호흡|케미|가까워|깊어|서로를 이해|마음이 통|통하는|죽이 맞/;
/** 자음·모음 낱글자. NFKC 가 호환 자모를 조합형 자모로 바꾸므로 원문과 정규화한 글 모두에서 두 범위를 본다. */
const JAMO_RE = new RegExp(`[${String.fromCodePoint(0x3131)}-${String.fromCodePoint(0x318e)}${String.fromCodePoint(0x1100)}-${String.fromCodePoint(0x11ff)}]`);
const EMOJI_RE = /\p{Extended_Pictographic}/u;
/** 카드가 「상대는 …를 골랐어요」 안에 인용되어도 나와 상대가 뒤바뀌어 읽히지 않게, 카드에는 사람 지칭어를 쓰지 않는다. */
const PRON_BASES = new Set(["상대", "나", "내", "저", "제", "너", "네", "당신", "상대방", "그분", "그이", "걔", "파트너", "짝꿍", "본인", "자기", "내게", "제게", "네게"]);
const PARTICLES = ["에게", "한테", "께서", "께", "이랑", "랑", "으로", "로", "에서", "에", "이", "가", "은", "는", "을", "를", "의", "도", "만", "와", "과"];
export function pronounIn(t) {
  for (const tok of t.split(/[\s.,?!「」]+/).filter(Boolean)) {
    if (PRON_BASES.has(tok)) return tok;
    for (const p of PARTICLES) if (tok.endsWith(p) && tok.length > p.length && PRON_BASES.has(tok.slice(0, -p.length))) return tok;
  }
  return null;
}

// ------------------------------------------------------------------ 글자 도구
const len = (s) => [...s].length;
const cc = (...codes) => codes.map((c) => String.fromCodePoint(c)).join("");
const span = (a, b) => `${String.fromCodePoint(a)}-${String.fromCodePoint(b)}`;
const ZW_CLASS = `${span(0x200b, 0x200f)}${span(0x202a, 0x202e)}${span(0x2060, 0x2064)}${cc(0xfeff, 0xad, 0x34f, 0x115f, 0x1160, 0x3164)}`;
const ZW_RE = new RegExp(`[${ZW_CLASS}\\p{Cf}\\p{Variation_Selector}\\u17b4\\u17b5\\uffa0]`, "gu");
const ZW_TEST = new RegExp(`[${ZW_CLASS}\\p{Cf}\\p{Variation_Selector}\\u17b4\\u17b5\\uffa0]`, "u");
/**
 * 정규화는 같은 글에 낱말마다 되풀이해서 부르므로 글자열별로 한 번만 계산한다(음성 대조가 글을 수천 번 다시 검사해서 메모 없이는 수십 초가 걸렸다).
 * 메모가 끝없이 자라지 않게 일정 크기를 넘으면 비운다. 결과는 메모 없이 계산한 것과 같다.
 */
function memoized(compute) {
  const cache = new Map();
  return (s) => {
    const hit = cache.get(s);
    if (hit !== undefined) return hit;
    const value = compute(s);
    if (cache.size >= 60000) cache.clear();
    cache.set(s, value);
    return value;
  };
}
const norm = memoized((s) => s.normalize("NFKC").replace(ZW_RE, "").normalize("NFKC"));
const squash = memoized((s) => norm(s).replace(/\s+/g, ""));
const normUpper = memoized((s) => norm(s).toUpperCase());
const squashUpper = memoized((s) => squash(s).toUpperCase());
const DASH_RE = new RegExp(`[-\\p{Pd}\\u02d7\\u23af\\u2504-\\u250b\\u254c-\\u254f${span(0x2010, 0x2015)}${cc(0x2212, 0xfe58, 0xfe63, 0xff0d, 0x3161, 0x1173, 0x2500, 0x2501, 0x2e3a, 0x2e3b, 0x301c, 0x30fc, 0x2043)}${span(0x2574, 0x257f)}]`, "u");
const DIGIT_RE = new RegExp(`[0-9${span(0xff10, 0xff19)}${span(0x2460, 0x249b)}${span(0x24ea, 0x24ff)}${span(0x2776, 0x2793)}${span(0x2160, 0x217f)}${cc(0x4e00, 0x4e8c, 0x4e09, 0x56db, 0x4e94, 0x516d, 0x4e03, 0x516b, 0x4e5d, 0x5341, 0x767e, 0x5343, 0x842c, 0x4e07)}]`);
const PERCENT_RE = new RegExp(`[%${cc(0xff05)}]`);
const STRAY_RE = new RegExp(`["${cc(0x201c, 0x201d, 0x2018, 0x2019)}\`'~${cc(0x2026, 0x300e, 0x300f, 0x300a, 0x300b, 0x3008, 0x3009)}]|\\.{2,}`);
const isStr = (x) => typeof x === "string";
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const list = (x) => (Array.isArray(x) ? x : []);
const unslot = (s) => s.replace(/\{[A-Za-z]+\}/g, "가");
const sameArr = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function maskQuotes(text) {
  let depth = 0;
  let out = "";
  for (const ch of text) {
    if (ch === "「") {
      if (depth) return null;
      depth = 1;
      out += "\u0001";
    } else if (ch === "」") {
      if (!depth) return null;
      depth = 0;
    } else if (!depth) out += ch;
  }
  return depth ? null : out;
}
const splitSentences = (masked) => masked.split(/(?<=[.?!])\s+/).map((s) => s.trim()).filter(Boolean);
/**
 * 낱말이 글에 있는가. 세 글자 이상이거나 띄어쓰기가 든 낱말은 공백과 영폭 공백을 걷어 낸 글에서 찾는다(「속 마음」 「속<영폭 공백>마음」을 잡는다).
 * 두 글자 이하는 원문(전각만 반각으로)에서 찾는다. 걷어 낸 글에서 찾으면 「말하고 집에서」가 「고집」에, 「일부 조건」이 「부조」에 걸리기 때문이다.
 */
export function has(t, w) {
  const { squashed, upper, spaced } = wordInfo(w);
  if (squashed) return squashUpper(t).includes(upper);
  if (normUpper(t).includes(upper)) return true;
  // 띄어 쓴 두 글자 낱말(「진 짜」 「모 순」): 두 글자가 모두 따로 선 음절일 때만 잡는다(「말하고 집에서」가 「고집」에 걸리던 오탐을 되살리지 않는다)
  return spaced !== null && spaced.test(norm(t));
}
/** 낱말마다 한 번만 계산하는 부분: 공백을 걷은 글에서 찾는가, 대문자로 바꾼 낱말, 띄어 쓴 두 글자 낱말의 정규식. */
const wordInfoCache = new Map();
function wordInfo(w) {
  let info = wordInfoCache.get(w);
  if (info === undefined) {
    const ww = w.replace(/\s+/g, "");
    const chars = [...ww];
    info = {
      squashed: /\s/.test(w) || chars.length >= 3,
      upper: ww.toUpperCase(),
      spaced: chars.length === 2 && /^[가-힣]{2}$/.test(ww) ? new RegExp(`(?<![가-힣])${chars[0]}\\s+${chars[1]}(?![가-힣])`) : null,
    };
    wordInfoCache.set(w, info);
  }
  return info;
}
const standalone = (t, w) => new RegExp(`(?<![가-힣])${w}(?![가-힣])`).test(norm(t));
const countWord = (t, w) => squash(t).split(w).length - 1;
const bigrams = (s) => {
  const t = squash(s).replace(/[^\p{L}]/gu, "");
  const set = new Set();
  for (let i = 0; i < t.length - 1; i += 1) set.add(t.slice(i, i + 2));
  return set;
};
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n += 1;
  return n / (a.size + b.size - n);
};
const tokensOf = (s) => s.split(/\s+/).filter(Boolean);
const stripOpener = (s) => s.replace(/^(다만|대신)\s+/, "");
/** 카드 첫 문장(결과 줄에 끼우는 글). act 는 한 문장이라 act 그대로다. */
export const firstSentence = (text) => (text.match(/^[^.?!]*[.?!]/) ?? [text])[0].trim();

// ------------------------------------------------------------------ 화면 글 모으기
/** role: sentence(문장, 요로 끝남) | phrase(구, 문장 부호 없음) | button(단추 글, 요로 끝나고 문장 부호 없음) | template(자리표시가 든 줄 틀) */
export function collectTexts(d) {
  const out = [];
  const add = (path, text, kind, role) => { if (isStr(text)) out.push({ path, text, kind, role }); };
  add("title", d?.title, "title", "phrase");
  add("intro", d?.intro, "intro", "sentence");
  add("receiverIntro", d?.receiverIntro, "intro", "sentence");
  add("skipNote", d?.skipNote, "note", "sentence");
  add("prompts.self", d?.prompts?.self, "prompt", "sentence");
  add("prompts.guess", d?.prompts?.guess, "prompt", "sentence");
  add("guessNote", d?.guessNote, "guessNote", "sentence");
  for (const [k, v] of Object.entries(isObj(d?.escapeTexts) ? d.escapeTexts : {})) add(`escapeTexts.${k}`, v, "escape", "button");
  for (const it of list(d?.items)) {
    const id = it?.id;
    add(`${id}.caption`, it?.caption, "caption", "phrase");
    add(`${id}.stem`, it?.stem, "stem", "sentence");
    for (const c of list(it?.cards)) {
      add(`${id}.${c?.id}.act`, c?.act, "act", "sentence");
      add(`${id}.${c?.id}.cost`, c?.cost, "cost", "sentence");
    }
  }
  add("resultBlock.sub", d?.resultBlock?.sub, "sub", "sentence");
  for (const [mode, row] of Object.entries(isObj(d?.resultBlock?.rows) ? d.resultBlock.rows : {})) {
    if (!isObj(row)) continue;
    add(`resultBlock.rows.${mode}.subhead`, row.subhead, "subhead", "phrase");
    add(`resultBlock.rows.${mode}.actualLabel`, row.actualLabel, "label", "phrase");
    add(`resultBlock.rows.${mode}.guessLabel`, row.guessLabel, "label", "phrase");
  }
  add("tail", d?.tail, "tail", "sentence");
  add("emptyState", d?.emptyState, "empty", "sentence");
  add("unlistedNote", d?.unlistedNote, "note", "sentence");
  for (const [k, v] of Object.entries(isObj(d?.linkNotices) ? d.linkNotices : {})) add(`linkNotices.${k}`, v, "notice", "sentence");
  return out;
}
const NON_SCREEN_ROOT = new Set(["schema", "setId", "status", "rules", "review"]);
const NON_SCREEN_KEYS = new Set(["id", "topic"]);
/** 파일의 모든 글자열 잎과 그 키 경로. */
export function stringLeaves(d) {
  const out = [];
  const walk = (node, keys) => {
    if (isStr(node)) out.push({ keys, value: node });
    else if (Array.isArray(node)) node.forEach((x, i) => walk(x, [...keys, i]));
    else if (isObj(node)) for (const [k, v] of Object.entries(node)) walk(v, [...keys, k]);
  };
  walk(d, []);
  return out;
}
/** 화면에 나가지 않는 잎(id, 주제 키, 개발 메모)인가. dev 와 rules 와 status 아래는 개발 메모다. */
export function isNonScreen(keys) {
  const named = keys.filter((k) => typeof k === "string");
  if (NON_SCREEN_ROOT.has(named[0])) return true;
  if (named[0] === "items" && (named.includes("dev") || named.includes("escapes"))) return true;
  if (named[0] === "items" && NON_SCREEN_KEYS.has(named.at(-1))) return true;
  return false;
}

// ------------------------------------------------------------------ 글 한 줄에 적용하는 규칙
/** 모든 화면 글에 적용하는 낱말·모양 규칙. 덮개 시험과 깨끗한 대조가 이 함수를 직접 부른다. */
export function textRules(entry, flag) {
  const { path, text, kind, role } = entry;
  const t = unslot(text);
  const n = norm(t);
  const flat = squash(t);
  if (flat === "") {
    flag("empty-text", path, "비어 있다");
    return;
  }
  if (/^\s|\s$|\s{2,}|[\t\r\n]/.test(t)) flag("whitespace", path, "앞뒤 공백, 겹공백, 줄바꿈", text);
  if (ZW_TEST.test(t)) flag("hidden-char", path, "보이지 않는 글자가 있다", text);
  if (DIGIT_RE.test(t) || DIGIT_RE.test(n)) flag("digit", path, "숫자(아라비아, 전각, 로마, 한자, 동그라미)가 있다", text);
  if (DASH_RE.test(t) || DASH_RE.test(n)) flag("dash", path, "줄표나 붙임표, 줄표를 닮은 글자가 있다", text);
  if (PERCENT_RE.test(n) || /퍼센트|백분율/.test(t)) flag("percent", path, "퍼센트 표현이 있다", text);
  if (/[A-Za-z]/.test(n)) flag("latin", path, "영문자가 있다", text);
  if (JAMO_RE.test(t) || JAMO_RE.test(n)) flag("jamo", path, "자음이나 모음만 떼어 쓴 글자(ㅋㅋ, ㅠㅠ 같은 것)가 있다", text);
  if (EMOJI_RE.test(n)) flag("emoji", path, "이모지나 그림 글자가 있다", text);
  if (STRAY_RE.test(n)) flag("stray-symbol", path, "곧은 따옴표, 굽은 따옴표, 물결, 말줄임표가 있다(따옴표는 「 」만)", text);
  if (maskQuotes(t) === null) flag("quote-balance", path, "「 」 짝이 맞지 않는다", text);
  if (/(^|\s)(?:[가나다라])\s*[.):]\s/.test(t) || /^[가나다라]\s*[:.)]/.test(t)) flag("label", path, "가나다 라벨처럼 보인다", text);
  const b = BANNED.find((w) => has(t, w));
  if (b) flag("banned-word", path, `금지어: ${b}`, text);
  const cz = CAUSAL.find((w) => has(t, w));
  if (cz) flag("causal-word", path, `원인을 붙이는 말: ${cz}`, text);
  const ce = n.match(CAUSAL_ENDING_RE);
  if (ce) flag("causal-word", path, `원인 연결어미: ${ce[0]}`, text);
  const cr = CEREMONY.find((w) => has(t, w));
  if (cr) flag("ceremony-word", path, `예식 낱말: ${cr}(식이 없는 커플도 답할 수 있어야 한다)`, text);
  const am = n.match(ASSUME_RE) ?? (ASSUME_SUBSTRINGS.find((w) => has(t, w)) ? [ASSUME_SUBSTRINGS.find((w) => has(t, w))] : null);
  if (am) flag("assume-word", path, `부모, 배우자, 아이, 동거를 전제하는 말: ${am[0]}(부모가 없는 사람, 혼인신고만 하는 사람, 아이가 없는 사람, 함께 살지 않는 사람도 답할 수 있어야 한다)`, text);
  const hm = HARM_CONTROL.find((w) => has(t, w));
  if (hm) flag("harm-lexicon", path, `해악·통제 회귀 방지 낱말: ${hm}`, text);
  if (/(^|\s)(왜|어째서)(\s|$)/.test(t)) flag("why-question", path, "이유를 묻는 「왜」를 쓰지 않는다", text);
  if (/뜻은 아니에요/.test(t)) flag("nested-negation", path, "겹친 「~뜻은 아니에요」", text);
  if (/뿐 ?(만)? ?아니라|뿐이에요|뿐이죠|(건|거|것|게|말|뜻)(은|이|도)? ?아니에요/.test(t)) flag("ai-tone", path, "AI 말투: 「뿐 아니라」 「~건 아니에요」 꼴", text);
  if (NUMBER_WORD_RE.test(t)) flag("digit", path, "한글로 쓴 수나 기간(삼십 분, 이틀, 두 번, 반 시간, 절반 같은 말)", text);
  if (/(하는|인)\s?답(?![가-힣])/.test(t)) flag("noun-answer", path, "「~인 답」 꼴", text);
  if (/(습니다|입니다|합니다|십시오|ㅂ니다)/.test(t)) flag("politeness", path, "합쇼체다. 해요체로 쓴다", text);
  // 길이 한도
  const limKey = { title: "title", intro: "intro", note: "note", prompt: "prompt", escape: "escape", caption: "caption", stem: "stem", act: "act", cost: "cost", tail: "tail", empty: "empty", guessNote: "guessNote", sub: "sub", label: "label", subhead: "subhead", notice: "notice" }[kind];
  if (limKey && len(t) > LIMITS[limKey]) flag("length-limit", path, `${kind} 는 ${LIMITS[limKey]}자 이하(지금 ${len(t)}자)`, text);
  // 문장 끝
  if (role === "sentence" || role === "template") {
    const masked = maskQuotes(t) ?? t;
    for (const s of splitSentences(masked)) {
      const body = s.replace(/[.?!\s\u0001]+$/g, "");
      const last = [...body].at(-1);
      if (last !== "요" && last !== "죠") flag("politeness", path, `문장이 요로 끝나지 않는다(해요체): 「${s}」`, text);
      if (!/[.?]$/.test(s)) flag("sentence-end", path, "문장 끝에 마침표나 물음표가 없다", s);
    }
  }
  if (role === "phrase") {
    if (/[.?!]/.test(t)) flag("phrase-punct", path, "구에는 마침표, 물음표, 느낌표를 쓰지 않는다", text);
    if (/다$/.test(flat)) flag("politeness", path, "구가 평서형 다 로 끝난다", text);
  }
  if (role === "button") {
    if (/[.?!]/.test(t)) flag("phrase-punct", path, "단추 글에는 문장 부호를 쓰지 않는다", text);
    if (!/요$/.test(flat)) flag("politeness", path, "단추 글이 요로 끝나지 않는다(해요체)", text);
  }
  // 카드와 장면: 한 일과 생기는 일만 적는다
  if (kind === "act" || kind === "cost" || kind === "stem") {
    const ev = EVAL.find((w) => has(t, w));
    if (ev) flag("evaluative-word", path, `평가어나 감정어: ${ev}(카드와 장면에는 한 일과 생기는 일만 적는다)`, text);
    const cq = CONSEQUENCE.find((w) => has(t.replace(/기울었/g, ""), w)); // 「기울었어요」가 「울었」에 걸리는 오탐을 뺀다(감사 L06)
    if (cq) flag("consequence-word", path, `한 카드에만 결과나 서사를 붙이는 말: ${cq}`, text);
    if (FEELING_Q_RE.test(t)) flag("feeling-question", path, "행동이 아니라 느낌을 묻는 말이다", text);
  }
  if (kind === "act" || kind === "cost") {
    const vl = VALENCE.find((w) => has(t, w));
    if (vl) flag("valence-word", path, `어느 카드가 더 나아 보이게 하는 말: ${vl}`, text);
    const tr = TRAIT.find((w) => has(t, w));
    if (tr) flag("trait-word", path, `사람 성질을 말하는 낱말: ${tr}`, text);
    const sg = STRONG.find((w) => has(t, w)) ?? STRONG_STANDALONE.find((w) => standalone(t, w));
    if (sg) flag("intensity-strong", path, `강한 정도말이나 빈도말: ${sg}(값의 무게를 한쪽으로 기울인다)`, text);
    const pr = pronounIn(t) ?? (t.match(/그 ?사람|그분|그이/)?.[0] ?? null);
    if (pr) flag("card-pronoun", path, `카드에 사람 지칭어 「${pr}」가 있어 결과 줄에 놓으면 나와 상대가 뒤바뀌어 읽힌다`, text);
    if (/[「」]/.test(t)) flag("card-quote", path, "카드 글에 「 」를 쓰지 않는다(결과 줄이 카드를 「 」 안에 넣는다)", text);
    if (/[?]/.test(t)) flag("card-shape", path, "카드 글은 물음이 아니다", text);
    if (/(^|\s)(마음|기분|속|가슴|느낌)(이|은|도|을|에)(\s|$)/.test(t)) flag("feeling-clause", path, "카드에 「마음이/기분이/속이 ~」 꼴의 느낌 절이 있다(한 일과 생기는 일만 적는다)", text);
  }
  // 소개, 안내, 끝 줄, 빈 상태, 결과 줄: 차이·개수·유형·맞힘 주장 금지
  if (["intro", "note", "tail", "empty", "template", "prompt", "guessNote", "sub", "notice", "label", "subhead"].includes(kind)) {
    if (GUESS_CLAIM_RE.test(t)) flag("guess-claim", path, "맞고 틀림, 대조 접속, 평가, 관계 예측, 모두 같았음을 말하는 낱말", text);
    if (kind !== "template" && COUNT_RE.test(t)) flag("count-claim", path, "한글 수사로 개수를 말한다", text);
    if (TYPE_RE.test(t)) flag("type-claim", path, "사람 유형을 말하는 꼴(~하는 사람인지)", text);
    if (REL_CLAIM_RE.test(t)) flag("guess-claim", path, "관계 예측, 궁합, 이해 정도를 말하는 낱말", text);
    if (/^(tail|empty)$/.test(kind)) {
      const cl = CLAIM.find((w) => t.includes(w));
      if (cl) flag("closing-claim", path, `차이나 비교를 주장하는 말: ${cl}`, text);
    }
  }
  // 정직 범위(감사 L02): 소개, 안내, 끝 줄, 빈 상태, 보내는 화면 문구가 저장 위치, 고지, 사회적 증거를 마음대로 말하지 않는다.
  // 저장 문구와 고지는 이 모듈이 정하지 않는다(시작 화면과 계약이 정한다). 근거 없는 사회적 증거를 쓰지 않는다.
  if (["intro", "note", "tail", "empty", "guessNote", "sub", "notice"].includes(kind) && /저장|브라우저|기기|심리검사|검사가 아니|많은 (커플|사람)|대부분의 (커플|사람)|보통 (커플|사람)|흔히/.test(t)) {
    flag("honest-scope", path, "저장 위치와 고지는 이 모듈이 정하지 않는다. 근거 없는 사회적 증거(많은 커플이, 흔히)를 쓰지 않는다", text);
  }
  if (["tail", "empty", "template", "label", "subhead"].includes(kind) && /하나|둘|셋|몇 개|개 중|번째|전부|모두 맞|절반|대부분|나머지|모든/.test(t.replace("둘이", "").replace("둘 다", ""))) {
    flag("guess-count", path, "줄이 개수를 말한다", text);
  }
}

// ------------------------------------------------------------------ copy.test.ts 낱말 규칙 거울(빌드 계획 A8)
/** 카드와 장면의 글(stem, act, cost, caption)은 V40_COPY 잎이 아니라서 아래 거울 규칙을 받지 않는다(act 안의 「한 자리에 앉아」 같은 말을 막지 않는다). */
const CARD_KINDS = new Set(["stem", "act", "cost", "caption"]);
/** copy.test.ts BANNED 에서 위의 BANNED 목록이 이미 덮는 것을 뺀 나머지와, 계획 A8 이 찾아낸 낱말. */
export const MIRROR_WORDS = ["자리", "데이터", "기기", "순위", "문항", "측면", "서버 연결", "접근 키", "확인 주소", "로딩", "에러", "오류"];
export const MIRROR_ORDER_LABEL_RE = /(번째|첫|둘째|셋째) ?(질문|화면|장면)|(질문|화면|장면) ?번호|\d+ ?\/ ?\d+|이야기 ?(카드|편|화면)/u;
export const MIRROR_SCENE_NAME_RE = /(질문|구간|주제|글자|세기) ?(장면|이야기)|(장면|이야기) ?(질문|구간)/u;
/** 화면 글 한 줄에 copy.test.ts 가 V40_COPY 의 모든 잎에 돌리는 낱말 규칙을 돌린다. escapeTexts 는 「제 상황과 안 맞아요」 단추 이름이라 그 이름 안의 「안 맞」만 빼 준다. */
export function copyMirrorRules(entry, flag, escapeTexts = {}) {
  const { path, text, kind } = entry;
  if (CARD_KINDS.has(kind)) return;
  const t = unslot(text);
  const n = norm(t);
  const stripped = isStr(escapeTexts.notmine) ? n.split(norm(escapeTexts.notmine)).join("") : n;
  const word = MIRROR_WORDS.find((w) => stripped.replace(/공용 기기/g, "").includes(w));
  if (word) flag("pinned-word", path, `copy.test.ts 가 V40_COPY 의 모든 문구에서 막는 낱말: ${word}`, text);
  if (/안 ?맞|잘 ?맞/u.test(stripped)) flag("pinned-word", path, "「안 맞」은 「제 상황과 안 맞아요」 단추 이름에만 남는다(copy.test.ts)", text);
  if (MIRROR_ORDER_LABEL_RE.test(n)) flag("order-label", path, "번호와 순서 라벨(첫 화면, 질문 번호, 3/6 꼴, 이야기 카드)을 쓰지 않는다", text);
  if (MIRROR_SCENE_NAME_RE.test(n)) flag("scene-name", path, "장면과 이야기를 질문이나 구간의 이름으로 쓰지 않는다", text);
}
/** 문장으로 나가는 화면 글 종류(라벨과 단추 이름은 빼고 세트의 문장만). 같은 묶음 안에서 같은 문장이 두 번 나오면 같은 주의를 두 번 읽힌다(copy.test.ts). */
const SENTENCE_KINDS = new Set(["intro", "note", "prompt", "guessNote", "sub", "tail", "empty", "notice"]);
export function bundleDuplicates(texts, flag) {
  const seen = new Map();
  for (const { path, text, kind } of texts) {
    if (!SENTENCE_KINDS.has(kind)) continue;
    for (const s of text.split(/(?<=[.?!])\s+/).map((x) => x.trim()).filter(Boolean)) {
      const earlier = seen.get(s);
      if (earlier !== undefined) flag("bundle-dup", path, `같은 문장이 ${earlier} 에도 있다(한 화면 묶음 안에서 같은 문장은 한 번만)`, s);
      else seen.set(s, path);
    }
  }
}

// ------------------------------------------------------------------ 승인한 어휘 목록(frozen vocabulary)
// 낱말 목록 검사는 목록 밖 낱말을 잡지 못한다(측정: 새로 쓴 위반 33개 중 6개만 잡았다). 이 세트는 카드 열두 장과 장면 여섯뿐이고 사람이 읽은 뒤 얼리는 글이므로,
// 얼린 뒤에 들어오는 모든 새 낱말을 사람이 다시 읽게 만드는 문을 둔다. 문은 새 낱말이 평가어인지 아닌지 가르지 못한다. 새 낱말이 있다는 사실만 막는다.
/** 승인한 어휘 목록의 파일 이름 꼬리: 세트 파일 이름에서 .json 을 떼고 이것을 붙인 파일이 세트 옆에 있다. */
export const VOCAB_SUFFIX = ".vocab.json";
/** 후보 목록(얼리지 않은 것)의 꼬리. */
export const CANDIDATE_SUFFIX = ".vocab.candidate.json";
export function vocabPathFor(setFile, suffix = VOCAB_SUFFIX) {
  return join(dirname(setFile), `${basename(setFile, ".json")}${suffix}`);
}
const VOCAB_PARTICLES = ["에서는", "에서", "에게", "한테", "으로", "까지", "부터", "이랑", "께서", "이나", "에는", "에도", "와", "과", "을", "를", "은", "는", "이", "가", "의", "에", "도", "만", "로", "랑", "나", "께"];
export function stripParticle(tok) {
  for (const p of VOCAB_PARTICLES) if (tok.length - p.length >= 2 && tok.endsWith(p)) return tok.slice(0, -p.length);
  return tok;
}
/** 화면 글 하나에서 낱말(공백·문장 부호로 끊은 덩어리)을 뽑는다. */
export function wordsOf(text) {
  return norm(unslot(text)).split(/[\s.,?!「」]+/).filter(Boolean);
}
/** 화면에 나가는 모든 글에서 얼릴 어휘를 만든다. 덩어리 그대로와 조사를 뗀 꼴을 함께 담는다. */
export function freezeVocab(d) {
  const set = new Set();
  for (const { text } of collectTexts(d)) for (const w of wordsOf(text)) { set.add(w); set.add(stripParticle(w)); }
  return [...set].sort();
}

// ------------------------------------------------------------------ 본 검사
/** opts.vocab: 승인한 어휘 배열. 주면 그 밖의 낱말을 new-word 로 막는다. 주지 않으면 이 문은 꺼져 있다(목록 밖 시험이 낱말 규칙만 재려고 쓴다). */
export function lintGuessSet(d, opts = {}) {
  const V = [];
  const flag = (rule, path, message, text = "") => V.push({ rule, path, message, text });

  // ---- 구조
  if (!isObj(d) || d.schema !== EXPECT.schema) flag("schema", "schema", `schema 는 ${EXPECT.schema}`);
  const items = list(d?.items);
  if (items.length !== EXPECT.itemCount) flag("item-count", "items", `장면은 ${EXPECT.itemCount}개여야 한다(지금 ${items.length}개)`);
  if (d?.reserve !== undefined || d?.fallbackSet !== undefined) flag("item-count", "reserve", "대체 문항과 대체 묶음은 두지 않는다");
  if (d?.tailOne !== undefined || d?.tailMany !== undefined) flag("guess-tail", "tailOne", "끝 줄은 하나(tail)다. 단수와 복수로 나누면 개수를 다시 말하게 된다");

  // 탈출구 사전
  const et = isObj(d?.escapeTexts) ? d.escapeTexts : {};
  for (const [k, want] of Object.entries(EXPECT.escapeTexts)) if (et[k] !== want) flag("escape-text", `escapeTexts.${k}`, `탈출구 문구가 고정 문구와 다르다: ${want}`, String(et[k]));
  for (const k of Object.keys(et)) if (!(k in EXPECT.escapeTexts)) flag("escape-text", `escapeTexts.${k}`, "고정 사전에 없는 탈출구");

  // 질문 글
  if (!isStr(d?.prompts?.self) || !EXPECT.promptSelf.test(d.prompts.self)) flag("prompt-shape", "prompts.self", "내 답 질문은 「~골라 주세요.」로 끝나야 한다", String(d?.prompts?.self));
  if (!isStr(d?.prompts?.guess) || !EXPECT.promptGuess.test(d.prompts.guess)) flag("prompt-shape", "prompts.guess", "짐작 질문은 「상대는 어느 쪽을 골랐을 것 같아요?」 꼴이어야 한다", String(d?.prompts?.guess));
  // 짐작 질문 밑 안내(감사 F05): 짐작을 바라는 쪽이 아니라 상대가 고를 것 같은 쪽으로 닻을 박는다(사랑 시험으로 읽는 사람이 이상형을 찍지 않게)
  if (!isStr(d?.guessNote) || !EXPECT.guessNote.test(d.guessNote)) flag("prompt-shape", "guessNote", "짐작 질문 밑 안내는 「바라는 쪽이 아니라 상대가 고를 것 같은 쪽으로요.」 꼴이어야 한다", String(d?.guessNote));

  // 항목
  const ids = new Set();
  const topicCount = {};
  const areas = [];
  const captions = new Set();
  const lookCount = { A: 0, B: 0, even: 0 };
  for (const it of items) {
    const id = String(it?.id);
    if (!/^g\.(money|process|scope|support)\.[a-z]+$/.test(id)) flag("id", id, "id 는 g.<money|process|scope|support>.<소문자>");
    if (ids.has(id)) flag("id", id, "id 중복");
    ids.add(id);
    const idTopic = id.split(".")[1];
    if (it?.topic !== idTopic) flag("topic", id, `topic 은 id 의 주제와 같아야 한다(${it?.topic} / ${idTopic})`);
    if (!EXPECT.topics.includes(it?.topic)) flag("topic", id, "알 수 없는 주제");
    topicCount[it?.topic] = (topicCount[it?.topic] ?? 0) + 1;
    if (captions.has(it?.caption)) flag("caption-dup", id, "캡션 중복", String(it?.caption));
    captions.add(it?.caption);

    // 탈출구 배열
    const es = isObj(it?.escapes) ? it.escapes : {};
    if (!sameArr(list(es.self), EXPECT.escapesSelf)) flag("escape-self", id, `내 답 탈출구는 ${EXPECT.escapesSelf.join(",")} 순서로 둘이어야 한다(제 상황과 안 맞아요는 사실의 말이라 그냥 답하고 싶지 않은 사람에게는 거짓이므로 지금은 넘어갈게요를 따로 둔다)`, list(es.self).join(","));
    if (!sameArr(list(es.guess), EXPECT.escapesGuess)) flag("escape-guess", id, `짐작 탈출구는 ${EXPECT.escapesGuess.join(",")} 하나여야 한다(짐작은 내가 실제 답을 한 뒤에만 묻기 때문에 제 상황과 안 맞아요가 모순이 된다)`, list(es.guess).join(","));
    for (const k of Object.keys(es)) if (k !== "self" && k !== "guess") flag("escape-self", id, `알 수 없는 탈출구 묶음: ${k}`);

    // 개발 메모
    const dev = isObj(it?.dev) ? it.dev : {};
    if (!EXPECT.areas.includes(dev.area)) flag("area", id, `dev.area 는 ${EXPECT.areas.join(" | ")} 중 하나`, String(dev.area));
    areas.push(dev.area);
    for (const k of ["noCeremony", "parentsAbsent", "remarrying", "notLivingTogether"]) if (!isStr(dev.fit?.[k]) || dev.fit[k].trim() === "") flag("fit-missing", id, `dev.fit.${k} 메모가 없다(식 없는 커플, 부모가 없는 사람, 아이 있는 재혼 사람, 함께 살지 않는 사람이 답할 수 있음을 적는다)`);
    if (!["A", "B", "even"].includes(dev.lookSide)) flag("look-balance", id, "dev.lookSide 는 A | B | even", String(dev.lookSide));
    else lookCount[dev.lookSide] += 1;
    if (!isStr(dev.whyItDiffers) || dev.whyItDiffers.trim() === "") flag("fit-missing", id, "dev.whyItDiffers 메모가 없다(왜 이 자리에서 같은 커플이 갈리고 서로 잘못 짐작할 만한지)");
    const ck = dev.costKinds ?? {};
    if (!isStr(ck.a) || !isStr(ck.b) || ck.a.trim() === "" || ck.a === ck.b) flag("cost-kind", id, "두 카드의 값은 종류가 달라야 한다(dev.costKinds.a 와 b 가 비어 있거나 같다). 값이 반대 카드의 이득을 되풀이하면 두 번째 단서가 된다");

    // 장면 글
    const stem = isStr(it?.stem) ? it.stem : "";
    {
      const masked = maskQuotes(stem) ?? stem;
      const ss = splitSentences(masked);
      if (ss.length < 1 || ss.length > 2) flag("stem-shape", id, `장면은 한두 문장(지금 ${ss.length}문장)`, stem);
      if (/[?]/.test(stem)) flag("stem-shape", id, "장면 글에는 물음표를 쓰지 않는다(질문은 prompts 가 한다)", stem);
      if (len(stem) < 30) flag("stem-shape", id, "장면이 너무 짧아 구체적인 순간을 담지 못한다", stem);
      const fb = (stem.match(/괜찮아요/g) ?? []).length;
      const last = ss.at(-1) ?? "";
      if (fb === 0 || !/(면|든|도)\s*괜찮아요\.$/.test(last)) flag("fallback-missing", id, "장면의 마지막 문장이 「~여도 괜찮아요」 「~면 괜찮아요」 「~든 괜찮아요」 꼴의 대체 길이어야 한다(없었던 일, 다른 일도 답이 된다)", stem);
      // 대체 길을 거꾸로 좁히는 말(「오래 만난 사이에 한해 괜찮아요」)은 끝 꼴만 보는 위 규칙을 통과하므로 따로 막는다(감사 L02)
      if (/한해|만 괜찮|오래 만난|처음 만난|이미/.test(last)) flag("fallback-missing", id, "대체 길이 답할 수 있는 사람을 좁히는 말(한해, 만 괜찮, 오래 만난, 이미)을 쓰지 않는다", stem);
      if (fb > 1) flag("disclaimer-stack", id, "장면 안에 「괜찮아요」가 둘 이상이다");
    }

    // 카드 둘
    const cards = list(it?.cards);
    if (cards.length !== 2) {
      flag("card-count", id, `카드는 둘이어야 한다(지금 ${cards.length}개)`);
      continue;
    }
    if (cards[0]?.id !== "a" || cards[1]?.id !== "b") flag("card-count", id, "카드 id 는 a, b 순서");
    const okCards = cards.every((c) => isStr(c?.act) && isStr(c?.cost));
    if (!okCards) {
      flag("card-shape", id, "카드는 act 와 cost 두 문장을 모두 가져야 한다");
      continue;
    }
    for (const c of cards) {
      if (Object.keys(c).some((k) => !["id", "act", "cost"].includes(k))) flag("card-shape", id, `카드에 알 수 없는 필드가 있다: ${Object.keys(c).join(",")}`);
      for (const [k, s] of [["act", c.act], ["cost", c.cost]]) {
        const ss = splitSentences(maskQuotes(s) ?? s);
        if (ss.length !== 1) flag("card-shape", `${id}.${c.id}.${k}`, `${k} 는 문장 하나여야 한다(지금 ${ss.length}문장)`, s);
        if (!/요\.$/.test(s)) flag("card-shape", `${id}.${c.id}.${k}`, `${k} 는 「요.」로 끝나는 해요체 문장`, s);
      }
      if (len(c.act) + 1 + len(c.cost) > LIMITS.cardTotal) flag("length-limit", `${id}.${c.id}`, `카드 전체는 ${LIMITS.cardTotal}자 이하(지금 ${len(c.act) + 1 + len(c.cost)}자)`);
      if (!EXPECT.openers.some((o) => c.cost.startsWith(`${o} `))) flag("card-shape", `${id}.${c.id}.cost`, `값 문장은 ${EXPECT.openers.join(" | ")} 으로 시작한다`, c.cost);
    }
    const [A, B] = cards;
    const opA = A.cost.split(/\s+/)[0];
    const opB = B.cost.split(/\s+/)[0];
    if (opA !== opB) flag("card-shape", id, `두 카드의 값 문장이 같은 말로 시작해야 한다(문장 틀이 같다): ${opA} / ${opB}`);
    const commas = (s) => (s.match(/,/g) ?? []).length;
    if (commas(A.act) !== commas(B.act) || commas(A.cost) !== commas(B.cost)) flag("card-shape", id, "두 카드의 문장 틀이 다르다(쉼표 개수가 다르다)");
    if (Math.abs(tokensOf(A.act).length - tokensOf(B.act).length) > LIMITS.tokenDiff || Math.abs(tokensOf(A.cost).length - tokensOf(B.cost).length) > LIMITS.tokenDiff) flag("card-shape", id, `두 카드의 어절 수 차이가 ${LIMITS.tokenDiff}를 넘는다(문장 틀이 다르다)`);
    // 같은 행동에 꼬리만 다른 카드
    {
      const jac = jaccard(bigrams(A.act), bigrams(B.act));
      const sa = squash(A.act);
      const sb = squash(B.act);
      let pre = 0;
      while (pre < sa.length && pre < sb.length && sa[pre] === sb[pre]) pre += 1;
      if (jac >= LIMITS.sameActJaccard || pre >= LIMITS.samePrefix) flag("same-act", id, `두 카드의 한 일이 사실상 같은 문장이다(겹침 ${jac.toFixed(2)}, 같은 앞머리 ${pre}자)`, `${A.act} / ${B.act}`);
      const jc = jaccard(bigrams(stripOpener(A.cost)), bigrams(stripOpener(B.cost)));
      if (jc >= LIMITS.sameActJaccard) flag("same-act", id, `두 카드의 값이 사실상 같은 문장이다(겹침 ${jc.toFixed(2)})`, `${A.cost} / ${B.cost}`);
    }
    // 무게가 같은가(대리 지표)
    {
      const r = (x, y) => Math.max(x, y) / Math.max(1, Math.min(x, y));
      const rAct = r(len(A.act), len(B.act));
      const rCost = r(len(A.cost), len(B.cost));
      const rTot = r(len(A.act) + len(A.cost), len(B.act) + len(B.cost));
      if (rAct > LIMITS.actRatio) flag("equal-weight", id, `두 카드의 한 일 길이 비율 ${rAct.toFixed(2)} 가 ${LIMITS.actRatio} 를 넘는다`);
      if (rCost > LIMITS.costRatio) flag("equal-weight", id, `두 카드의 값 길이 비율 ${rCost.toFixed(2)} 가 ${LIMITS.costRatio} 를 넘는다`);
      if (rTot > LIMITS.totalRatio) flag("equal-weight", id, `두 카드 전체 길이 비율 ${rTot.toFixed(2)} 가 ${LIMITS.totalRatio} 를 넘는다`);
      const weakA = WEAK.reduce((s, w) => s + countWord(`${A.act}${A.cost}`, w), 0);
      const weakB = WEAK.reduce((s, w) => s + countWord(`${B.act}${B.cost}`, w), 0);
      if (weakA !== weakB) flag("intensity-weak", id, `약한 정도말(${WEAK.join(", ")}) 개수가 두 카드에서 다르다(${weakA} / ${weakB}). 값의 무게가 한쪽으로 기운다`);
      // 값이 반대 카드의 이득을 되풀이하는가
      const mA = jaccard(bigrams(stripOpener(A.cost)), bigrams(B.act));
      const mB = jaccard(bigrams(stripOpener(B.cost)), bigrams(A.act));
      if (mA >= LIMITS.mirrorJaccard || mB >= LIMITS.mirrorJaccard) flag("mirror-cost", id, `한 카드의 값이 반대 카드의 한 일을 되풀이한다(겹침 ${mA.toFixed(2)} / ${mB.toFixed(2)}). 값은 반대 극의 이득이 아니라 다른 종류여야 한다`);
    }
  }

  // ---- 세트 전체
  for (const tp of EXPECT.topics) {
    if (!topicCount[tp]) flag("topic-coverage", tp, `주제 ${tp} 에 장면이 없다(돈 준비 가족 지친 날 네 주제를 모두 덮는다)`);
    if ((topicCount[tp] ?? 0) > LIMITS.perTopicMax) flag("topic-coverage", tp, `주제 ${tp} 에 장면이 ${topicCount[tp]}개다(주제당 ${LIMITS.perTopicMax}개 이하)`);
  }
  {
    const uniq = new Set(areas);
    if (uniq.size !== areas.length) flag("area", "items", "생활 영역(dev.area)이 겹친다. 여섯 장면은 서로 다른 영역이어야 한다", areas.join(","));
    for (const a of EXPECT.areas) if (items.length === EXPECT.itemCount && !areas.includes(a)) flag("area", a, `생활 영역 ${a} 를 다루는 장면이 없다`);
  }
  if (Math.abs(lookCount.A - lookCount.B) > 1) flag("look-balance", "items", `좋아 보이는 쪽(dev.lookSide)이 위 카드와 아래 카드에 고르게 나뉘어야 한다(A ${lookCount.A} / B ${lookCount.B})`);
  {
    const totals = items.filter((i) => list(i?.cards).length === 2 && list(i.cards).every((c) => isStr(c?.act) && isStr(c?.cost))).flatMap((i) => i.cards.map((c) => len(c.act) + 1 + len(c.cost)));
    if (totals.length) {
      const sp = Math.max(...totals) / Math.min(...totals);
      if (sp > LIMITS.setSpread) flag("length-spread", "items", `카드 전체 길이의 최대/최소가 ${LIMITS.setSpread} 를 넘는다(${sp.toFixed(2)})`);
    }
    const acts = items.flatMap((i) => list(i?.cards).map((c) => ({ id: `${i?.id}.${c?.id}`, act: c?.act }))).filter((x) => isStr(x.act));
    for (let i = 0; i < acts.length; i += 1) {
      for (let j = i + 1; j < acts.length; j += 1) {
        if (acts[i].id.split(".").slice(0, 3).join(".") === acts[j].id.split(".").slice(0, 3).join(".")) continue;
        const jac = jaccard(bigrams(acts[i].act), bigrams(acts[j].act));
        if (jac >= LIMITS.crossItemJaccard) flag("same-act", `${acts[i].id}/${acts[j].id}`, `다른 장면의 카드 한 일이 거의 같다(겹침 ${jac.toFixed(2)})`, `${acts[i].act} / ${acts[j].act}`);
      }
    }
  }

  // ---- 세트 글자와 검토 상태(개발용 값이고 화면에 나가지 않는다)
  if (!isStr(d?.setId) || !/^[0-9A-Za-z]$/.test(d.setId)) flag("set-id", "setId", "세트 글자(setId)는 숫자나 영문자 한 글자다(링크 ga/gb 의 첫 글자: 문장을 고치면 글자를 올린다)", String(d?.setId));
  {
    const rv = d?.review;
    const ids = new Set(items.map((it) => String(it?.id)));
    if (!isObj(rv) || typeof rv.humanReviewed !== "boolean" || !Array.isArray(rv.unreviewedItemIds) || !isStr(rv.note) || rv.note.trim() === "") {
      flag("review", "review", "review 는 { humanReviewed: boolean, unreviewedItemIds: 배열, note: 문장 } 이어야 한다(검토를 받지 않은 장면을 데이터에 남긴다)");
    } else {
      for (const id of rv.unreviewedItemIds) if (!ids.has(String(id))) flag("review", "review.unreviewedItemIds", `없는 장면 id: ${String(id)}`);
      if (new Set(rv.unreviewedItemIds).size !== rv.unreviewedItemIds.length) flag("review", "review.unreviewedItemIds", "장면 id 가 겹친다");
      if (rv.humanReviewed === true && rv.unreviewedItemIds.length > 0) flag("review", "review", "사람이 읽었다(humanReviewed)면서 검토를 받지 않은 장면이 남아 있다");
      for (const k of Object.keys(rv)) if (!["humanReviewed", "unreviewedItemIds", "note"].includes(k)) flag("review", `review.${k}`, "알 수 없는 필드");
    }
  }

  // ---- 문구 규칙
  const texts = collectTexts(d);
  for (const e of texts) textRules(e, flag);
  for (const e of texts) copyMirrorRules(e, flag, isObj(d?.escapeTexts) ? d.escapeTexts : {});
  bundleDuplicates(texts, flag);

  // ---- 정직 규칙: 소개, 끝 줄, 빈 상태
  if (!isStr(d?.intro) || !/다르게 짐작한 장면만/.test(d.intro)) flag("guess-honest", "intro", "소개 글이 결과 화면이 어긋난 장면만 놓는다는 것을 말해야 한다(「다르게 짐작한 장면만」)", String(d?.intro));
  if (!isStr(d?.intro) || !/「내 답과 함께 보내기」 링크에만 들어가고/.test(d.intro)) flag("guess-honest", "intro", "소개 글이 내 답과 짐작이 「내 답과 함께 보내기」 링크에만 들어간다고 말해야 한다(「질문만 보내기」 링크에는 들어가지 않는다)", String(d?.intro));
  if (isStr(d?.intro) && /상대에게 보내는 링크/.test(d.intro)) flag("guess-honest", "intro", "「상대에게 보내는 링크에 담기고」는 「질문만 보내기」를 고른 사람에게 거짓이다(옛 문장). 「내 답과 함께 보내기」 링크라고 말한다", d.intro);
  if (!isStr(d?.intro) || !/내 답과 짐작/.test(d.intro)) flag("guess-honest", "intro", "소개 글이 짐작만이 아니라 내 답도 링크에 담긴다는 것을 말해야 한다(「내 답과 짐작」)", String(d?.intro));
  if (!isStr(d?.intro) || !/링크를 가진 사람은 누구나 읽을 수 있어요/.test(d.intro)) flag("guess-honest", "intro", "소개 글이 링크를 가진 사람은 누구나 읽을 수 있다고 말해야 한다(상대 화면에만 놓인다고 줄여 말하면 링크가 새는 길을 숨긴다)", String(d?.intro));
  if (!isStr(d?.tail) || !/봐도 좋아요\.$/.test(d.tail) || !/어떻게 답했는지/.test(d.tail)) flag("guess-tail", "tail", "끝 줄은 「어떻게 답했는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요.」 꼴의 초대 하나", String(d?.tail));
  if (isStr(d?.tail) && !/혼자/.test(d.tail)) flag("guess-tail", "tail", "끝 줄은 혼자 생각해 보는 길도 함께 말한다(말다툼이 잦은 사이에서 이야기하기만 권하면 싸움을 부른다)", d.tail);
  if (!isStr(d?.emptyState) || !/같았거나/.test(d.emptyState) || !/건너뛴/.test(d.emptyState)) flag("guess-honest", "emptyState", "빈 상태 줄은 「짐작이 같았거나」와 「한쪽이 건너뛴」 두 이유를 함께 말해 개수를 거꾸로 셀 수 없게 해야 한다", String(d?.emptyState));
  if (!isStr(d?.unlistedNote) || !/같았거나/.test(d.unlistedNote) || !/건너뛴/.test(d.unlistedNote)) flag("guess-honest", "unlistedNote", "줄 없는 장면을 말하는 한 줄도 「같았거나」와 「건너뛴」 두 이유를 함께 말해 자르지 않고도 불완전해 보이지 않게 해야 한다", String(d?.unlistedNote));
  if (!isStr(d?.receiverIntro) || !/두 사람 결과 링크/.test(d.receiverIntro) || !/하지 않아도 결과는 그대로예요/.test(d.receiverIntro)) flag("guess-honest", "receiverIntro", "받는 사람 소개 글은 내 답과 짐작이 돌려보내는 두 사람 결과 링크에 들어간다는 것과 하지 않아도 결과는 그대로라는 것을 말해야 한다", String(d?.receiverIntro));
  if (!isStr(d?.receiverIntro) || !/내 답과 짐작/.test(d.receiverIntro)) flag("guess-honest", "receiverIntro", "받는 사람 소개 글이 내 답도 짐작도 링크에 들어간다고 말해야 한다(「내 답과 짐작」)", String(d?.receiverIntro));
  if (!isStr(d?.skipNote) || !/선택이에요/.test(d.skipNote)) flag("guess-honest", "skipNote", "건너뛰기 안내가 이 장면들이 선택이라는 것을 말해야 한다", String(d?.skipNote));

  // ---- 보내는 화면 문구(감사 F01): 내 답과 짐작이 링크에 들어간다는 사실을 링크를 만드는 자리에서도 말한다
  {
    const ln = isObj(d?.linkNotices) ? d.linkNotices : {};
    for (const k of EXPECT.noticeKeys) if (!isStr(ln[k])) flag("link-notice", `linkNotices.${k}`, "보내는 화면 문구가 없다(링크가 새는 길을 만드는 자리에서 짐작과 답이 들어간다고 말해야 한다)");
    for (const k of Object.keys(ln)) if (!EXPECT.noticeKeys.includes(k)) flag("link-notice", `linkNotices.${k}`, "알 수 없는 보내는 화면 문구");
    for (const k of EXPECT.noticeKeys) if (isStr(ln[k]) && !/짐작/.test(ln[k])) flag("link-notice", `linkNotices.${k}`, "짐작이 링크에 들어간다는 말이 없다", ln[k]);
    if (isStr(ln.sendOwn) && (!/링크/.test(ln.sendOwn) || !/내가 한 짐작/.test(ln.sendOwn))) flag("link-notice", "linkNotices.sendOwn", "내가 한 짐작이 링크에 들어간다고 말해야 한다", ln.sendOwn);
    if (isStr(ln.sendCouple) && !/두 사람/.test(ln.sendCouple)) flag("link-notice", "linkNotices.sendCouple", "두 사람 모두의 답과 짐작이 읽힌다고 말해야 한다", ln.sendCouple);
    if (isStr(ln.receive) && (!/링크 안에는 상대의 답과 상대가 한 짐작이 들어 있어요/.test(ln.receive) || !/마치기 전에는 화면에 나오지 않게/.test(ln.receive))) flag("link-notice", "linkNotices.receive", "받는 화면은 링크 안에 상대의 답과 상대가 한 짐작이 들어 있다는 것과 마치기 전에는 화면에 나오지 않는다는 것을 말해야 한다", ln.receive);
  }

  // ---- 결과 줄 틀(두 행): 사실 쪽 이름이 먼저, 짐작 쪽 이름이 나중. 나와 상대가 뒤바뀌면 시험이 빨개진다(row-who)
  {
    const rb = isObj(d?.resultBlock) ? d.resultBlock : {};
    if (!isStr(rb.sub)) flag("result-rows", "resultBlock.sub", "결과 구역 밑줄 문구(sub)가 없다");
    else if (!/나란히/.test(rb.sub) || !/짐작한 쪽과 고른 쪽/.test(rb.sub)) flag("result-rows", "resultBlock.sub", "밑줄 문구는 짐작한 쪽과 고른 쪽을 나란히 놓았다는 말이다(진단이나 점수가 아니다)", rb.sub);
    const rows = isObj(rb.rows) ? rb.rows : {};
    for (const m of EXPECT.modes) if (!isObj(rows[m])) flag("result-rows", `resultBlock.rows.${m}`, "결과 줄 틀이 없다");
    for (const m of Object.keys(rows)) if (!EXPECT.modes.includes(m)) flag("result-rows", `resultBlock.rows.${m}`, "알 수 없는 결과 줄 틀");
    for (const m of EXPECT.modes) {
      const r = rows[m];
      if (!isObj(r)) continue;
      const keys = Object.keys(r);
      if (!sameArr(keys, ["subhead", "actualLabel", "guessLabel"])) flag("result-rows", `resultBlock.rows.${m}`, `키는 subhead, actualLabel, guessLabel 순서여야 한다(사실이 먼저 놓이고 짐작이 뒤에 놓인다): ${keys.join(",")}`);
      const [wa, wg, ws] = EXPECT.rowWho[m];
      if (r.actualLabel !== wa) flag("row-who", `resultBlock.rows.${m}.actualLabel`, `사실 쪽 이름은 「${wa}」여야 한다(나와 상대가 뒤바뀌면 안 된다)`, String(r.actualLabel));
      if (r.guessLabel !== wg) flag("row-who", `resultBlock.rows.${m}.guessLabel`, `짐작 쪽 이름은 「${wg}」여야 한다`, String(r.guessLabel));
      if (r.subhead !== ws) flag("row-who", `resultBlock.rows.${m}.subhead`, `소제목은 「${ws}」여야 한다`, String(r.subhead));
    }
  }

  // ---- 승인한 어휘 문: 얼린 뒤에 들어온 낱말은 사람이 읽고 --freeze 로 목록을 갱신할 때까지 막는다
  if (opts.vocab) {
    const ok = new Set(opts.vocab);
    const seen = new Set();
    for (const { path, text } of texts) {
      for (const w of wordsOf(text)) {
        if (ok.has(w) || ok.has(stripParticle(w)) || seen.has(`${path}|${w}`)) continue;
        seen.add(`${path}|${w}`);
        flag("new-word", path, `승인한 어휘 목록에 없는 말: ${w}. 평가어, 성향어, 강한 정도말, 원인어, 예식어, 전제어가 아닌지 사람이 읽고 괜찮으면 --freeze 로 목록을 갱신한다`, text);
      }
    }
  }

  // ---- 덮개 검사: 파일의 모든 글자열은 (1) 문구 검사를 받았거나 (2) id, 주제 키 같은 비화면 값이거나 (3) 개발 메모여야 한다
  const checked = new Set(texts.map((x) => x.text));
  for (const { keys, value } of stringLeaves(d)) {
    if (!isNonScreen(keys) && !checked.has(value)) flag("uncovered-string", keys.join("."), "문구 검사를 받지 않는 글자열이다(collectTexts 에 넣거나 dev, rules 아래 개발 메모로 옮긴다)", value);
  }
  return V;
}

// ------------------------------------------------------------------ 음성 대조
export const clone = (x) => JSON.parse(JSON.stringify(x));
const find = (d, id) => d.items.find((i) => i.id === id);
const card = (d, id, c) => find(d, id).cards.find((x) => x.id === c);
const cp = (...c) => String.fromCodePoint(...c);
/** [이름, 기대한 규칙, 변형]. 각 변형은 사본 하나에 하나씩 심는다. */
export const MUTATIONS = [
  ["숫자를 카드 한 일에", "digit", (d) => { card(d, "g.money.gift", "a").act = "갖고 싶은 걸 3번 물어보고 그중에서 골라요."; }],
  ["줄표를 장면에", "dash", (d) => { find(d, "g.process.share").stem += " — 참고로요."; }],
  ["금지어 속마음을 카드 값에", "banned-word", (d) => { card(d, "g.support.quiet", "b").cost = "다만 속마음이 나오기까지 시간이 걸리는 때가 있어요."; }],
  ["해요체가 아닌 카드 한 일", "politeness", (d) => { card(d, "g.process.share", "a").act = "각자 더 익숙한 일을 정해서 맡는다."; }],
  ["평가어 든든을 카드 값에", "evaluative-word", (d) => { card(d, "g.support.evening", "a").cost = "다만 같이 있어 든든해도 혼자 있고 싶어도 맞추게 되는 때가 있어요."; }],
  ["원인 낱말 때문에를 카드 값에", "causal-word", (d) => { card(d, "g.process.review", "b").cost = "다만 말하지 않은 곳 때문에 나중에 따로 나오는 때가 있어요."; }],
  ["예식 낱말을 장면에", "ceremony-word", (d) => { find(d, "g.money.gift").stem = "결혼 준비로 서로에게 줄 선물을 정해 둔 예산 안에서 고르는 중이에요. 선물이 아니어도 서로에게 무언가를 골라 주는 일이면 괜찮아요."; }],
  ["장면에서 대체 길을 지움", "fallback-missing", (d) => { find(d, "g.support.evening").stem = "하루 일을 마치고 잠들기 전까지 아무 일정 없이 시간이 남은 밤이에요. 함께 있든 떨어져 있든 같은 밤이에요."; }],
  ["대체 길을 거꾸로 좁힘(한해)", "fallback-missing", (d) => { find(d, "g.scope.plans").stem = "같은 날 약속이 둘 겹쳐서 함께 갈 곳은 하나인데, 상대와 나는 서로 다른 곳에 마음이 가요. 오래 만난 사이에 한해서만 친구든 가족이든 괜찮아요."; }],
  ["내 답 탈출구를 지움", "escape-self", (d) => { find(d, "g.money.gift").escapes.self = []; }],
  ["내 답 탈출구에서 건너뛰기를 지움", "escape-self", (d) => { find(d, "g.scope.plans").escapes.self = ["notmine"]; }],
  ["짐작 탈출구를 지움", "escape-guess", (d) => { find(d, "g.scope.plans").escapes.guess = []; }],
  ["짐작 탈출구에 제 상황과 안 맞아요를 되살림", "escape-guess", (d) => { find(d, "g.scope.plans").escapes.guess = ["unsure", "notmine"]; }],
  ["탈출구 문구를 다른 말로", "escape-text", (d) => { d.escapeTexts.unsure = "모르겠어요"; }],
  ["건너뛰기 문구를 다른 말로", "escape-text", (d) => { d.escapeTexts.skip = "건너뛸래요"; }],
  ["두 카드의 한 일이 같은 문장", "same-act", (d) => { card(d, "g.process.share", "b").act = "각자 더 익숙한 일을 정해서 나눠 맡아요."; }],
  ["한 카드 한 일이 훨씬 짧음", "equal-weight", (d) => { card(d, "g.support.quiet", "a").act = "물어봐요."; }],
  ["한 카드 값이 훨씬 김", "equal-weight", (d) => { card(d, "g.process.review", "a").cost = "다만 한꺼번에 들은 쪽이 다 기억하지 못해서 처음부터 다시 물어볼 때가 있어요."; }],
  ["값 문장의 시작말이 다름", "card-shape", (d) => { card(d, "g.process.share", "a").cost = "대신 맡은 사람이 바쁜 날엔 그 일이 밀리는 때가 있어요."; }],
  ["값 문장이 시작말 없이 시작", "card-shape", (d) => { card(d, "g.scope.plans", "a").cost = "이번에 마음이 갔던 쪽이 다음 차례를 기다리는 때가 있어요."; }],
  ["카드 한 일이 문장 둘", "card-shape", (d) => { card(d, "g.money.gift", "b").act = "평소 눈여겨본 걸 떠올려요. 묻지 않고 골라요."; }],
  ["쉼표 개수가 다른 카드", "card-shape", (d) => { card(d, "g.support.evening", "b").act = "각자 따로 쉬다가, 잠들기 전에 얼굴을 봐요."; }],
  ["카드에 사람 지칭어 상대", "card-pronoun", (d) => { card(d, "g.support.evening", "a").act = "상대와 아무 계획 없이 같이 쉬어요."; }],
  ["카드에 사람 지칭어 내가", "card-pronoun", (d) => { card(d, "g.money.gift", "a").act = "내가 갖고 싶은 걸 미리 물어보고 그중에서 골라요."; }],
  ["카드에 사람 지칭어 그 사람(우회)", "card-pronoun", (d) => { card(d, "g.money.gift", "a").act = "그 사람에게 갖고 싶은 걸 미리 물어보고 그중에서 골라요."; }],
  ["카드에 사람 지칭어 상대방", "card-pronoun", (d) => { card(d, "g.support.quiet", "a").act = "상대방에게 무슨 일 있냐고 먼저 물어봐요."; }],
  ["좋아 보이는 말 깔끔을 카드에", "valence-word", (d) => { card(d, "g.process.share", "a").act = "각자 더 익숙한 일을 깔끔하게 정해서 맡아요."; }],
  ["사람 성질 낱말 신중을 카드에", "trait-word", (d) => { card(d, "g.support.quiet", "b").act = "말이 나올 때까지 신중하게 기다려요."; }],
  ["강한 정도말 항상을 카드 값에", "intensity-strong", (d) => { card(d, "g.scope.plans", "b").cost = "다만 누가 더 가고 싶은지를 두고 항상 말이 길어지는 때가 있어요."; }],
  ["강한 빈도말 늘을 카드에", "intensity-strong", (d) => { card(d, "g.money.gift", "b").cost = "다만 받는 쪽이 늘 바라던 것과 다른 때가 있어요."; }],
  ["약한 정도말이 한 카드에만", "intensity-weak", (d) => { card(d, "g.support.evening", "b").act = "각자 따로 쉬다가 잠들기 전에 잠깐 얼굴을 봐요."; }],
  ["한 카드의 값이 반대 카드의 한 일을 되풀이", "mirror-cost", (d) => { card(d, "g.process.share", "a").cost = "다만 일을 정해 두지 않고 돌아가며 맡는 동안 일이 밀리는 때가 있어요."; }],
  ["두 카드의 값 종류가 같음", "cost-kind", (d) => { find(d, "g.money.gift").dev.costKinds.b = find(d, "g.money.gift").dev.costKinds.a; }],
  ["부모를 장면에", "assume-word", (d) => { find(d, "g.scope.plans").stem = "부모님과 같은 날 약속이 둘 겹쳐서 함께 갈 곳은 하나인데, 상대와 나는 서로 다른 곳에 마음이 가요. 누구의 말이든, 비슷한 일이면 괜찮아요."; }],
  ["배우자를 카드에", "assume-word", (d) => { card(d, "g.process.review", "b").act = "눈에 띈 곳 중 배우자에게 하나만 골라서 말해요."; }],
  ["함께 산다는 전제를 장면에", "assume-word", (d) => { find(d, "g.support.evening").stem = "같이 사는 집에서 하루 일을 마치고 잠들기 전까지 시간이 남은 밤이에요. 비슷한 밤이면 괜찮아요."; }],
  ["띄어 쓴 함께 산다는 전제(한 집에서 지내는)", "assume-word", (d) => { find(d, "g.support.evening").stem = "한 집에서 지내는 하루 일을 마치고 잠들기 전까지 시간이 남은 밤이에요. 비슷한 밤이면 괜찮아요."; }],
  ["해악 통제 낱말 몰래를 카드에", "harm-lexicon", (d) => { card(d, "g.support.quiet", "a").act = "몰래 무슨 일 있냐고 먼저 물어봐요."; }],
  ["장면이 다섯 개", "item-count", (d) => { d.items.pop(); }],
  ["주제 하나(scope)를 지움", "topic-coverage", (d) => { find(d, "g.scope.plans").topic = "process"; find(d, "g.scope.plans").id = "g.process.plans"; }],
  ["한 주제에 장면 셋", "topic-coverage", (d) => { const it = find(d, "g.support.quiet"); it.topic = "process"; it.id = "g.process.quiet"; }],
  ["생활 영역이 겹침", "area", (d) => { find(d, "g.support.quiet").dev.area = "alone-vs-together"; }],
  ["좋아 보이는 쪽이 한 카드로 쏠림", "look-balance", (d) => { for (const it of d.items) it.dev.lookSide = "B"; }],
  ["장면이 세 문장", "stem-shape", (d) => { find(d, "g.process.share").stem = "해야 할 일이 여러 개 남았어요. 둘이 나눠 맡는 중이에요. 집안일이든 다른 일이든 나눠 맡아 본 일이면 괜찮아요."; }],
  ["장면에 물음표", "stem-shape", (d) => { find(d, "g.money.gift").stem = "서로에게 줄 선물을 예산 안에서 어떻게 고를까요? 선물이 아니어도 무언가를 골라 주는 일이면 괜찮아요."; }],
  ["장면에 괜찮아요가 둘", "disclaimer-stack", (d) => { find(d, "g.support.quiet").stem = "둘 중 한 사람이 평소보다 말이 적은 저녁이어도 괜찮아요. 곁에 있는 쪽이라면 만나서든 통화로든 비슷한 저녁이면 괜찮아요."; }],
  ["퍼센트 기호를 카드에", "percent", (d) => { card(d, "g.money.gift", "b").cost = "다만 받는 쪽이 바라던 것과 다른 % 때가 있어요."; }],
  ["영문자를 카드에", "latin", (d) => { card(d, "g.money.gift", "b").cost = "다만 받는 쪽이 OK 바라던 것과 다른 때가 있어요."; }],
  ["보이지 않는 글자를 카드 값에", "hidden-char", (d) => { card(d, "g.support.evening", "a").cost = `다만 한쪽이 혼자 있고 싶어도${cp(0x200b)} 맞추게 되는 때가 있어요.`; }],
  ["방향 격리 글자 속 속마음", "hidden-char", (d) => { card(d, "g.support.quiet", "b").cost = `다만 속${cp(0x2066)}마음이 나오기까지 시간이 걸리는 때가 있어요.`; }],
  ["변이 선택자를 카드에", "hidden-char", (d) => { card(d, "g.support.quiet", "b").cost = `다만 말이 나오기까지${cp(0xfe0f)} 시간이 걸리는 때가 있어요.`; }],
  ["띄어 쓴 금지어 속 마음", "banned-word", (d) => { card(d, "g.support.quiet", "b").cost = "다만 속 마음이 나오기까지 시간이 걸리는 때가 있어요."; }],
  ["띄어 쓴 두 글자 금지어 진 짜", "banned-word", (d) => { card(d, "g.money.gift", "a").act = "진 짜 갖고 싶은 걸 미리 물어보고 그중에서 골라요."; }],
  ["띄어 쓴 두 글자 금지어 모 순", "banned-word", (d) => { card(d, "g.process.share", "b").cost = "다만 모 순 같은 일은 시간이 더 걸리는 때가 있어요."; }],
  ["붙임표 닮은 글자 아르메니아 붙임표", "dash", (d) => { card(d, "g.money.gift", "a").act = `갖고 싶은 걸 미리${cp(0x058a)}물어보고 그중에서 골라요.`; }],
  ["붙임표 닮은 글자 캐나다 원주민 붙임표", "dash", (d) => { card(d, "g.money.gift", "a").act = `갖고 싶은 걸 미리${cp(0x1400)}물어보고 그중에서 골라요.`; }],
  ["굽은 따옴표", "stray-symbol", (d) => { find(d, "g.support.quiet").stem += " “참고”"; }],
  ["겹낫표 『 』", "stray-symbol", (d) => { find(d, "g.support.quiet").stem += " 『참고』"; }],
  ["점 둘 이상", "stray-symbol", (d) => { card(d, "g.money.gift", "a").cost = "다만 받는 쪽이 열어 보기 전에 이미 아는 때가 있어요.."; }],
  ["왜로 묻는 말을 장면에", "why-question", (d) => { find(d, "g.money.gift").stem = "서로에게 줄 선물을 예산 안에서 고르는 중이에요. 왜 그런지 생각해도 비슷한 일이면 괜찮아요."; }],
  ["카드 한 일에 「 」", "card-quote", (d) => { card(d, "g.money.gift", "a").act = "「갖고 싶은 걸」 미리 물어보고 그중에서 골라요."; }],
  ["서사 표지 결국을 카드 값에", "consequence-word", (d) => { card(d, "g.process.review", "a").cost = "다만 결국 한꺼번에 들은 쪽이 다 기억하지 못해요."; }],
  ["한글 수 삼십 분을 카드 값에", "digit", (d) => { card(d, "g.process.share", "b").cost = "다만 익숙하지 않은 일은 삼십 분이 더 걸리는 때가 있어요."; }],
  ["한글 기간 이틀을 카드 값에", "digit", (d) => { card(d, "g.support.evening", "b").cost = "다만 나누려던 이야기가 이틀 뒤로 미뤄지는 때가 있어요."; }],
  ["소개 글에서 링크에 담긴다는 말을 뺌", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글에서 내 답도 담긴다는 말을 뺌", "guess-honest", (d) => { d.intro = "같은 장면마다 상대는 어느 쪽을 골랐을지 짐작해 보세요. 짐작은 「내 답과 함께 보내기」 링크에만 들어가고, 링크를 가진 사람은 누구나 읽을 수 있어요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글에서 어긋난 장면만 놓는다는 말을 뺌", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 「내 답과 함께 보내기」 링크에만 들어가고, 링크를 가진 사람은 누구나 읽을 수 있어요."; }],
  ["소개 글을 상대 화면에만 놓인다고 줄여 말함(1판 문장)", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 상대에게 보내는 링크에 담겨서 상대 화면에도 놓일 수 있어요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글이 질문만 보내기에도 들어간다고 읽히는 옛 문장(상대에게 보내는 링크에 담기고)", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 모두 상대에게 보내는 링크에 담기고, 링크를 가진 사람은 누구나 읽을 수 있어요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글이 어느 링크인지 말하지 않음(내 답과 함께 보내기를 요구하는 규칙만 잡는다)", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 링크에 들어가고, 링크를 가진 사람은 누구나 읽을 수 있어요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글에서 누구나 읽을 수 있다는 말을 뺌", "guess-honest", (d) => { d.intro = "같은 장면마다 내 답을 고르고, 상대는 어느 쪽을 골랐을지도 짐작해 보세요. 내 답과 짐작은 「내 답과 함께 보내기」 링크에만 들어가요. 상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."; }],
  ["소개 글에 자리(copy.test.ts 가 막는 낱말)", "pinned-word", (d) => { d.intro = d.intro.replace("나란히 놓아요.", "나란히 놓는 자리가 있어요."); }],
  ["소개 글에 데이터", "pinned-word", (d) => { d.intro += " 데이터는 보내지 않아요."; }],
  ["받는 사람 소개 글에 기기", "pinned-word", (d) => { d.receiverIntro += " 이 기기에는 남지 않아요."; }],
  ["받는 사람 소개 글에 문항", "pinned-word", (d) => { d.receiverIntro = d.receiverIntro.replace("같은 장면에서", "같은 문항에서"); }],
  ["건너뛰기 안내에 안 맞아요(단추 이름 밖)", "pinned-word", (d) => { d.skipNote += " 안 맞는 장면은 건너뛰어요."; }],
  ["결과 구역 밑줄에 오류", "pinned-word", (d) => { d.resultBlock.sub = "짐작한 쪽과 고른 쪽을 나란히 놓았어요. 오류는 없어요."; }],
  ["안내에 번째 화면 라벨", "order-label", (d) => { d.skipNote += " 첫 화면부터 시작해요."; }],
  ["안내에 질문 번호 라벨", "order-label", (d) => { d.skipNote += " 질문 번호는 없어요."; }],
  ["안내에 장면 이야기 이름꼴", "scene-name", (d) => { d.skipNote += " 주제 장면은 없어요."; }],
  ["끝 줄이 소개 글 문장을 되풀이(같은 묶음 중복)", "bundle-dup", (d) => { d.emptyState = d.emptyState + " " + d.skipNote.split(". ")[0] + "."; }],
  ["받는 사람 소개 글에서 돌려보내는 링크를 뺌", "guess-honest", (d) => { d.receiverIntro = "상대가 보낸 링크에 이어 나도 같은 장면에서 내 답을 고르고 상대의 답을 짐작해 보세요. 내 답과 짐작은 링크에 들어가요. 하지 않아도 결과는 그대로예요."; }],
  ["받는 사람 소개 글에서 하지 않아도 된다는 말을 뺌", "guess-honest", (d) => { d.receiverIntro = "상대가 보낸 링크에 이어 나도 같은 장면에서 내 답을 고르고 상대의 답을 짐작해 보세요. 내 답과 짐작은 상대에게 돌려보내는 두 사람 결과 링크에 들어가요."; }],
  ["받는 사람 소개 글에서 내 답도 담긴다는 말을 뺌", "guess-honest", (d) => { d.receiverIntro = "상대가 보낸 링크에 이어 같은 장면에서 상대는 어느 쪽을 골랐을지 짐작해 보세요. 짐작은 상대에게 돌려보내는 두 사람 결과 링크에 들어가요. 하지 않아도 결과는 그대로예요."; }],
  ["줄 없는 장면 한 줄에서 건너뛴 이유를 뺌", "guess-honest", (d) => { d.unlistedNote = "여기에 없는 장면은 짐작이 서로의 답과 같았거나 그랬을 수 있어요."; }],
  ["줄 없는 장면 한 줄을 지움", "guess-honest", (d) => { delete d.unlistedNote; }],
  ["줄 없는 장면 한 줄에 맞힘 말", "guess-claim", (d) => { d.unlistedNote = "여기에 없는 장면은 짐작이 맞았거나, 한쪽이 건너뛴 장면이에요."; }],
  ["소개 글에 맞고 틀리는 건 없고를 되살림", "guess-claim", (d) => { d.intro += " 맞고 틀리는 건 없어요."; }],
  ["소개 글의 과장(몰랐던 내 모습)", "banned-word", (d) => { d.intro += " 나도 몰랐던 내 모습이 나올 수 있어요."; }],
  ["소개 글에 저장 문구", "honest-scope", (d) => { d.intro += " 내 답은 이 브라우저에만 남아요."; }],
  ["소개 글에 둘째 고지", "honest-scope", (d) => { d.intro += " 심리검사가 아니에요."; }],
  ["소개 글에 근거 없는 사회적 증거", "honest-scope", (d) => { d.intro += " 많은 커플이 이 장면에서 서로 다르게 짐작해요."; }],
  ["끝 줄을 이야기해 볼 만해요로", "guess-tail", (d) => { d.tail = "서로 어떻게 답했는지 이야기해 볼 만해요."; }],
  ["끝 줄에서 혼자 생각해 보는 길을 뺌", "guess-tail", (d) => { d.tail = "서로 어떻게 답했는지 이야기해 봐도 좋아요."; }],
  ["끝 줄에 서로를 얼마나 아는지", "guess-claim", (d) => { d.tail = "서로를 얼마나 아는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요."; }],
  ["끝 줄에 관계 예측(한결 가까워져요)", "guess-claim", (d) => { d.tail = "이야기하면 한결 가까워져요. 어떻게 답했는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요."; }],
  ["끝 줄에 AI 말투(뿐 아니라)", "ai-tone", (d) => { d.tail = "답뿐 아니라 어떻게 답했는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요."; }],
  ["끝 줄을 단수와 복수로 나눔", "guess-tail", (d) => { d.tailOne = "서로 어떻게 답했는지 이야기해 봐도 좋아요."; }],
  ["빈 상태 줄에서 한쪽이 건너뛴 이유를 뺌", "guess-honest", (d) => { d.emptyState = "이번 장면들에서는 나란히 놓을 것이 없었어요. 짐작이 상대의 답과 같았거나 그랬을 수 있어요."; }],
  ["빈 상태 줄이 모두 같았어요 맞힘 함의", "guess-claim", (d) => { d.emptyState = "이번에는 짐작이 모두 같았어요."; }],
  ["끝 줄에 한글 수사 개수", "count-claim", (d) => { d.tail = "세 가지 장면을 어떻게 답했는지 혼자 생각해 봐도, 둘이 이야기해 봐도 좋아요."; }],
  ["소개 글에 세 가지 장면", "count-claim", (d) => { d.intro += " 세 가지 장면이에요."; }],
  ["건너뛰기 안내에 여섯 가지 장면", "count-claim", (d) => { d.skipNote += " 여섯 가지 장면이에요."; }],
  ["건너뛰기 안내에 일곱 개", "count-claim", (d) => { d.skipNote += " 일곱 개예요."; }],
  ["결과 줄 사실 쪽 이름이 뒤바뀜", "row-who", (d) => { d.resultBlock.rows.meGuessedPartner.actualLabel = "내가 고른 쪽"; }],
  ["결과 줄 소제목이 뒤바뀜", "row-who", (d) => { d.resultBlock.rows.partnerGuessedMe.subhead = "내가 짐작한 것"; }],
  ["결과 줄 키 순서가 짐작이 먼저", "result-rows", (d) => { const r = d.resultBlock.rows.meGuessedPartner; d.resultBlock.rows.meGuessedPartner = { subhead: r.subhead, guessLabel: r.guessLabel, actualLabel: r.actualLabel }; }],
  ["결과 줄 틀 하나를 지움", "result-rows", (d) => { delete d.resultBlock.rows.secondGuessedFirst; }],
  ["결과 줄 이름에 맞힘 말", "guess-claim", (d) => { d.resultBlock.rows.meGuessedPartner.guessLabel = "내가 맞힌 쪽"; }],
  ["결과 구역 밑줄이 관계 평가", "result-rows", (d) => { d.resultBlock.sub = "서로를 얼마나 아는지 나란히 놓았어요."; }],
  ["내 답 질문이 골라 주세요로 끝나지 않음", "prompt-shape", (d) => { d.prompts.self = "지금 마음이 가는 쪽이 있어요."; }],
  ["짐작 질문이 원래 꼴이 아님", "prompt-shape", (d) => { d.prompts.guess = "상대는 어느 쪽인가요?"; }],
  ["짐작 질문 밑 안내를 지움", "prompt-shape", (d) => { d.guessNote = "골라 주세요."; }],
  ["보내는 화면 문구 하나를 지움", "link-notice", (d) => { delete d.linkNotices.sendCouple; }],
  ["받는 화면 문구가 마치기 전 숨김을 말하지 않음", "link-notice", (d) => { d.linkNotices.receive = "링크 안에는 상대의 답과 상대가 한 짐작이 들어 있어요."; }],
  ["새 화면 문구 필드를 넣고 검사 목록에는 안 넣음", "uncovered-string", (d) => { find(d, "g.money.gift").hint = "속마음을 말해 보세요."; }],
  ["카드에 알 수 없는 필드", "card-shape", (d) => { card(d, "g.money.gift", "a").text = "갖고 싶은 걸 미리 물어보고 그중에서 골라요. 다만 받는 쪽이 열어 보기 전에 이미 아는 때가 있어요."; }],
  ["schema 이름이 다름", "schema", (d) => { d.schema = "wedding-code-guess/3"; }],
  ["대체 묶음을 되살림", "item-count", (d) => { d.fallbackSet = ["g.money.gift"]; }],
  ["카드 세 장", "card-count", (d) => { find(d, "g.money.gift").cards.push({ id: "c", act: "아무 일도 하지 않아요.", cost: "다만 선물이 없는 날이 생겨요." }); }],
  ["캡션이 겹침", "caption-dup", (d) => { find(d, "g.process.review").caption = find(d, "g.process.share").caption; }],
  ["dev.fit 메모를 지움", "fit-missing", (d) => { delete find(d, "g.scope.plans").dev.fit.parentsAbsent; }],
  ["목록 밖 낱말(줄어들어요)을 카드에", "new-word", (d) => { card(d, "g.money.gift", "a").cost = "다만 받는 쪽이 열어 보기 전에 이미 아는 때가 줄어들어요."; }],
  ["목록 밖 낱말(아련)을 카드에", "new-word", (d) => { card(d, "g.money.gift", "a").cost = "다만 받는 쪽이 열어 볼 때 아련해요."; }],
  ["목록 밖 낱말(넉넉한)을 장면에", "new-word", (d) => { find(d, "g.money.gift").stem = "서로에게 줄 선물을 정해 둔 넉넉한 예산 안에서 고르는 중이에요. 선물이 아니어도, 서로에게 무언가를 골라 주는 일이면 괜찮아요."; }],
  ["목록 밖 낱말을 소개 글에", "new-word", (d) => { d.intro = d.intro.replace("같은 장면마다", "같은 장면마다 천천히"); }],
  ["다른 장면의 카드 한 일이 거의 같음", "same-act", (d) => { card(d, "g.process.review", "b").act = "각자 더 익숙한 일을 정해서 맡아요."; }],
  ["카드 전체 길이 편차가 큼", "length-spread", (d) => { card(d, "g.support.quiet", "a").act = "물어봐요."; card(d, "g.support.quiet", "a").cost = "다만 답이 와요."; card(d, "g.support.quiet", "b").act = "말이 나올 때까지 하던 일을 하면서 그대로 곁에서 기다려요."; }],
  ["세트 글자가 두 글자", "set-id", (d) => { d.setId = "12"; }],
  ["세트 글자를 지움", "set-id", (d) => { delete d.setId; }],
  ["review 를 지움(검토 상태를 데이터에서 없앰)", "review", (d) => { delete d.review; }],
  ["review 가 없는 장면 id 를 가리킴", "review", (d) => { d.review.unreviewedItemIds = ["g.money.nothing"]; }],
  ["사람이 읽었다면서 미검토 장면이 남음", "review", (d) => { d.review.humanReviewed = true; }],
  ["review 에 알 수 없는 필드", "review", (d) => { d.review.extra = true; }],
];

/**
 * 못 잡는다고 알려진 것(문서의 한계 문단이 말하는 것). 아래 변형은 모두 위반 0이어야 한다. 위반이 잡히기 시작하면 한계 문단을 고친다.
 * 이 줄은 검사기가 사람 읽기와 사람 짝 맞추기를 대신하지 못한다는 것을 매번 눈에 보이게 한다.
 */
export const BLIND_SPOTS = [
  ["한 장면 안에서 두 카드의 값을 맞바꿈(뜻이 안 이어짐)", (d) => { const it = find(d, "g.process.share"); const t = it.cards[0].cost; it.cards[0].cost = it.cards[1].cost; it.cards[1].cost = t; }],
  ["두 장면의 장면 글을 맞바꿈", (d) => { const a = find(d, "g.process.share"); const b = find(d, "g.scope.plans"); const t = a.stem; a.stem = b.stem; b.stem = t; }],
];

/** 위반 여덟 개를 한 사본에 함께 심는다(과제가 정한 음성 대조). 서로 다른 규칙 여덟 가지를 이름으로 고른다. */
export const PLANTED_TOGETHER_NAMES = [
  "숫자를 카드 한 일에",
  "줄표를 장면에",
  "금지어 속마음을 카드 값에",
  "해요체가 아닌 카드 한 일",
  "평가어 든든을 카드 값에",
  "원인 낱말 때문에를 카드 값에",
  "예식 낱말을 장면에",
  "장면에서 대체 길을 지움",
];

/** 깨끗한 대조: 함정 낱말(오늘, 하늘, 집안일, 나란히, 일부 조건, 말하고 집에서, 통화가, 기울었어요, 좋아하는, 기기에)이 든 멀쩡한 글은 오탐이 없어야 한다. */
export const CLEAN_CONTROLS = [
  ["act", "sentence", "집안일과 일의 개수가 같아지게 나눠 맡아요."],
  ["act", "sentence", "오늘 하늘이 맑아도 일부 조건만 나란히 놓고 골라요."],
  ["cost", "sentence", "다만 말하고 집에서 이야기가 길어질 때가 있어요."],
  ["cost", "sentence", "다만 오늘 고른 것이 바라던 것과 달라 쓰지 않게 돼요."],
  ["stem", "sentence", "나란히 앉은 저녁에 집안일을 나눠 본 일이면 괜찮아요."],
  ["cost", "sentence", "다만 한쪽이 먼저 일어나도 나머지가 이어서 하는 때가 있어요."],
  ["cost", "sentence", "다만 통화가 길어지는 때가 있어요."],
  ["cost", "sentence", "다만 한쪽으로 기울었어요."],
  ["cost", "sentence", "다만 좋아하는 걸 고르는 데 말이 길어질 때가 있어요."],
  ["cost", "sentence", "다만 기기에 쌓인 사진을 다시 고를 때가 있어요."],
  ["intro", "sentence", "상대의 답과 다르게 짐작한 장면만 두 사람 결과에 나란히 놓아요."],
  ["note", "sentence", "여기에 없는 장면은 짐작이 서로의 답과 같았거나, 한쪽이 건너뛴 장면이에요."],
  ["note", "sentence", "거기에 놓인 장면과 저기에 놓인 장면은 달라요."],
];

/** 덮개 시험용 프로브: 규칙 가족마다 화면 글자열 끝에 붙여 보고, 그 자리에서 기대한 규칙이 잡히는지 센다. */
export const PROBES_ALL = [
  ["banned-word", " 속마음"],
  ["banned-word", " 속 마음"],
  ["banned-word", ` 속${cp(0x200b)}마음`],
  ["banned-word", ` 속${cp(0x2066)}마음`],
  ["banned-word", " 진 짜"],
  ["banned-word", " 회피"],
  ["causal-word", " 그래서"],
  ["causal-word", " 몰라서"],
  ["ceremony-word", " 상견례"],
  ["ceremony-word", " 결혼"],
  ["dash", " ㅡ"],
  ["dash", " —"],
  ["dash", ` ${cp(0x058a)}`],
  ["digit", " Ⅲ"],
  ["digit", " ３"],
  ["digit", " 삼십 분"],
  ["latin", " ab"],
  ["harm-lexicon", " 몰래"],
  ["assume-word", " 부모님"],
];
const CARD_PROBES = [["evaluative-word", " 민망했어요"], ["consequence-word", " 결국"], ["valence-word", " 깔끔해요"], ["trait-word", " 신중해요"], ["intensity-strong", " 항상"], ["card-pronoun", " 상대가"], ["card-pronoun", " 그 사람이"]];
const CLAIM_PROBES = [["guess-claim", " 맞혔어요"], ["count-claim", " 세 가지"]];
export const PROBES_BY_KIND = {
  act: CARD_PROBES,
  cost: CARD_PROBES,
  stem: [["evaluative-word", " 난감할 때"], ["consequence-word", " 결국"], ["feeling-question", " 어떤 기분이었어요?"]],
  intro: CLAIM_PROBES,
  note: CLAIM_PROBES,
  guessNote: CLAIM_PROBES,
  sub: CLAIM_PROBES,
  notice: CLAIM_PROBES,
  label: [["guess-claim", " 맞혔어요"]],
  subhead: [["guess-claim", " 맞혔어요"]],
  tail: [["closing-claim", " 차이가 있었는지"], ["count-claim", " 세 가지"], ["guess-claim", " 맞혔어요"]],
  empty: [["closing-claim", " 차이가 있었는지"], ["count-claim", " 세 가지"], ["guess-claim", " 맞혔어요"]],
};

export function report(V, out = console.log) {
  for (const v of V) out(`[${v.rule}] ${v.path}: ${v.message}${v.text ? ` | ${v.text}` : ""}`);
}
export function limitsTable() {
  return [
    `한도(글자 수): title ${LIMITS.title}, intro ${LIMITS.intro}, note ${LIMITS.note}, prompt ${LIMITS.prompt}, guessNote ${LIMITS.guessNote}, escape ${LIMITS.escape}, caption ${LIMITS.caption}, stem ${LIMITS.stem}, act ${LIMITS.act}, cost ${LIMITS.cost}, 카드 전체 ${LIMITS.cardTotal}, 결과 구역 밑줄 ${LIMITS.sub}, 줄 이름 ${LIMITS.label}, 소제목 ${LIMITS.subhead}, tail ${LIMITS.tail}, emptyState ${LIMITS.empty}, 보내는 화면 문구 ${LIMITS.notice}`,
    `한도(개수): 장면 ${EXPECT.itemCount}, 카드 2, 주제 ${EXPECT.topics.length}개 모두 덮고 주제당 ${LIMITS.perTopicMax} 이하, 생활 영역 ${EXPECT.areas.length}개 겹치지 않게, 탈출구 내 답 2 짐작 1, 줄 수 상한 없음`,
    `한도(균형): 한 일 길이 비율 ${LIMITS.actRatio}, 값 길이 비율 ${LIMITS.costRatio}, 카드 전체 비율 ${LIMITS.totalRatio}, 어절 수 차이 ${LIMITS.tokenDiff}, 세트 전체 카드 길이 편차 ${LIMITS.setSpread}, 같은 행동 자카드 ${LIMITS.sameActJaccard} 미만, 같은 앞머리 ${LIMITS.samePrefix}자 미만, 값이 반대 카드 한 일을 되풀이하는 자카드 ${LIMITS.mirrorJaccard} 미만`,
  ].join("\n");
}


/** 파일 하나를 읽어 검사한다: 세트 옆의 어휘 목록(또는 vocabPath)을 읽어 문을 켠다. 목록이 없으면 그 사실 자체가 위반이다(문이 조용히 꺼지지 않게). */
export function lintFile(file, vocabPath = null) {
  const d = JSON.parse(fs.readFileSync(file, "utf8"));
  const vp = vocabPath ?? vocabPathFor(file);
  let vocab = null;
  try { vocab = JSON.parse(fs.readFileSync(vp, "utf8")).tokens; } catch { vocab = null; }
  const V = lintGuessSet(d, vocab ? { vocab } : {});
  if (!vocab) V.push({ rule: "vocab-missing", path: basename(vp), message: `승인한 어휘 목록(${basename(vp)})이 없다. 낱말 목록 검사만으로는 목록 밖 낱말을 못 잡으므로, 사람이 읽은 뒤 --freeze 로 만든다`, text: "" });
  return { d, V, vocab };
}

/**
 * 음성 대조를 한 번 돌려 구조화된 결과를 낸다(명령줄 --selftest 는 이것을 찍고, vitest 는 이것을 단언한다. 같은 검사를 두 곳에 베끼지 않는다).
 * base: 원본 세트. gate: { vocab } 어휘 문 설정(목록 밖 낱말 시험이 쓴다). 얼린 목록이 아니라 지금 원본에서 만든 후보를 줘도 규칙 시험은 된다.
 */
export function runSelfTest(base, gate) {
  const clean = lintGuessSet(base, gate);
  const mutations = MUTATIONS.map(([name, rule, fn]) => {
    const d = clone(base);
    fn(d);
    const hits = lintGuessSet(d, gate);
    return { name, rule, ok: hits.some((v) => v.rule === rule), got: [...new Set(hits.map((v) => v.rule))] };
  });
  const blind = BLIND_SPOTS.map(([name, fn]) => {
    const d = clone(base);
    fn(d);
    const hits = lintGuessSet(d, gate);
    return { name, stillBlind: hits.length === 0, got: [...new Set(hits.map((v) => v.rule))] };
  });
  const planted = clone(base);
  const plantedRules = [];
  for (const nm of PLANTED_TOGETHER_NAMES) {
    const m = MUTATIONS.find((x) => x[0] === nm);
    if (!m) throw new Error(`함께 심을 변형이 없다: ${nm}`);
    m[2](planted);
    plantedRules.push(m[1]);
  }
  const hitsTogether = lintGuessSet(planted, gate);
  const plantedCaught = plantedRules.filter((r) => hitsTogether.some((v) => v.rule === r));
  const texts = collectTexts(base);
  const leaves = stringLeaves(base).filter(({ keys }) => !isNonScreen(keys));
  const missedProbe = [];
  let probes = 0;
  for (const { keys, value } of leaves) {
    const kind = texts.find((t) => t.text === value)?.kind;
    for (const [rule, probe] of [...PROBES_ALL, ...(PROBES_BY_KIND[kind] ?? [])]) {
      probes += 1;
      const dd = clone(base);
      let node = dd;
      for (const k of keys.slice(0, -1)) node = node[k];
      node[keys.at(-1)] = node[keys.at(-1)] + probe;
      // 낱말 규칙 자체가 그 자리에서 잡는지 보려고 어휘 문은 끈다(문이 켜져 있으면 새 낱말이라 무엇이든 잡혀서 시험이 되지 않는다).
      if (!lintGuessSet(dd).some((v) => v.rule === rule && isStr(v.text) && v.text.endsWith(probe))) missedProbe.push(`${keys.join(".")}<${rule}${probe}>`);
    }
  }
  const falsePositives = [];
  for (const [kind, role, text] of CLEAN_CONTROLS) {
    const hits = [];
    textRules({ path: `clean.${kind}`, text, kind, role }, (rule, path, message, tx) => hits.push({ rule, path, message, text: tx }));
    copyMirrorRules({ path: `clean.${kind}`, text, kind, role }, (rule, path, message, tx) => hits.push({ rule, path, message, text: tx }), {});
    if (hits.length) falsePositives.push({ kind, text, hits });
  }
  return {
    clean,
    mutations,
    blind,
    planted: { doc: planted, rules: plantedRules, caught: plantedCaught },
    probes: { total: probes, missed: missedProbe, leaves: leaves.length },
    falsePositives,
  };
}
