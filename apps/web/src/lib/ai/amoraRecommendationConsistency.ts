// 추천의 근거를 새로 판단하지 않는다. 같은 문단에서 스스로 후보라고 낮춘 명칭만 맞춘다.
const RANK_LABEL = /^([ \t]*(?:\*\*)?(?:(?:현재|지금|현[ \t]*시점)(?:은|에는|에서는|에서|으로서는|로서는)?(?:\*\*)?[ \t]*(?:\*\*)?)?)(추천[ \t]*1[ \t]*순위|1[ \t]*순위[ \t]*추천|최우선[ \t]*추천)(?=[ \t]*(?:[은는이가:：]|\*\*|$))/u;
const RANKED_RECOMMENDATION = /(?:추천[ \t]*1[ \t]*순위|1[ \t]*순위[ \t]*추천|최우선[ \t]*추천)/u;
const PROTECTED_PROSE = /[`"'“”‘’「」『』]|(?:라고|라는|이라고|이라는)\s*(?:말|표현|문구|요청|의견|뜻|의미)|(?:^|\n)[ \t]*(?:>|\||[-*+]\s|\d+[.)]\s|#{1,6}\s)/u;
const FACT_SUBJECT = /^(?:견적|가격|비용|예산|상한|인원|날짜|일정|범위|금액|수용량|접근성|식대)$/u;
const DIRECT_CANDIDATE_STATE = /(?:아직\s*)?(?:(?:확인|검증)(?:되지\s*않은|하지\s*못한)|미(?:확인|검증)(?:인)?)\s*(?:(?:비교|검토|절충)\s*)?후보(?:안)?(?:이에요|예요|입니다)$/u;
const HYPOTHETICAL_STATE = /(?:^|\s)만약(?:\s|$)|(?<!서)면(?=[,\s])|(?:일|인)\s*경우/u;
const RECLASSIFICATION = /(?:(?:현재(?:로서는)?|지금(?:은|으로서는)?|이\s*(?:안|제안|추천|선택)(?:은|이)?|제가\s*(?:제시한|드린)\s*(?:안|제안)(?:은|이)?)\s*)?(?:(?:실제|확정(?:적인)?|최종)\s*)?추천(?:이(?:라기보다(?:는)?|라기보단)|(?:이|은)?\s*(?:아니라|아닌|아니고)|보다는)\s*(?:(?:먼저|우선)\s*)?(?:(?:견적을\s*받아볼|비교할|검토할)\s*)?(?:(?:검토|비교|절충)\s*)?후보(?:안)?(?:예요|이에요|입니다|로\s*(?:(?:두는|보는)\s*(?:게|것이)\s*(?:정확해요|정확합니다|맞아요|맞습니다)|두겠습니다|봐야\s*해요|제안해요))$/u;
const AGREEMENT_NEGATION = /(?:아직\s*)?(?:(?:두\s*(?:분|사람)|둘)(?:이|은|는)?\s*)?(?:(?:인원|날짜|예산|금액|범위)(?:에|을|를)\s*)?(?:공동으로\s*|함께\s*)?(?:(?:합의|동의)(?:하지\s*않(?:았으므로|아서|아)|되지\s*않(?:았으므로|아서|아))|정하지\s*못(?:했으므로|해서|해))/u;
const NOT_AN_AGREED_FACT = /(?:아직\s*)?(?:(?:두\s*(?:분|사람)|둘)(?:이|은|는)?\s*)?(?:합의한|함께\s*정한)\s*(?:숫자|인원|날짜|예산|금액|범위)(?:가|는|이)?\s*아니(?:므로|라서|어서)/u;

// 추천→후보라는 명시적인 자기 재분류 자체가 근거다. 앞 이유의 사실성을 추정하지 않는다.
function classifyCandidateState(text: string): { kind: "unverified-candidate" | "explicit-reclassification"; index: number } | null {
  const direct = text.match(DIRECT_CANDIDATE_STATE);
  if (direct && direct.index !== undefined) return { kind: "unverified-candidate", index: direct.index };
  const reclassified = text.match(RECLASSIFICATION);
  return reclassified && reclassified.index !== undefined ? { kind: "explicit-reclassification", index: reclassified.index } : null;
}

function namedCandidates(text: string): Set<string> {
  return new Set([...text.matchAll(/(?:[A-Z0-9]+\s*안|안\s*[A-Z0-9]+|[가-힣A-Za-z0-9·-]+(?:웨딩홀|예식장|호텔|홀))(?=[은는이가입을를의\s,.!?*]|$)/gu)]
    .map(match => match[0].replace(/\s/gu, "").replace(/^안([A-Z0-9]+)$/u, "$1안"))
    .filter(name => !["웨딩홀", "예식장", "호텔"].includes(name)));
}

function hasDifferentTopic(text: string, reason = false): boolean {
  let scope = text.replace(/(?:^|\s)같은(?=\s)/gu, " ");
  // 인물 이름이 아니라 선호 관계절만 구분한다. 별도 분야의 주제 전환은 계속 막는다.
  if (reason) scope = scope.replace(/(?:^|\s)[가-힣A-Za-z0-9·-]+(?:가|이)\s+(?:원하는|선호하는|중요하게\s*여기는)(?=\s)/gu, " ");
  // '…는 안이기 때문'의 관형절 종결은 별도 명사의 주제 조사와 구분한다.
  // 앞쪽의 촬영은/패키지는 등 명시적인 분야 전환은 그대로 검사한다.
  if (reason && /(?:^|\s)[가-힣]+는\s+안이기\s*때문(?:이에요|입니다|이죠)$/u.test(scope)) {
    const possessives = scope.replace(/(?:두\s*(?:분|사람)|둘)의(?=\s)/gu, " ");
    if (/(?:^|\s)[가-힣A-Za-z0-9·-]+의(?=\s)|(?:다른|별도(?:의)?)\s*(?:안|옵션|패키지|분야|후보)/u.test(possessives)) return true;
    scope = scope.replace(/(?:^|\s)[가-힣]+는(?=\s+안이기\s*때문(?:이에요|입니다|이죠)$)/u, " ");
  }
  return [...scope.matchAll(/(?:^|\s)([가-힣A-Za-z0-9·-]+?)(?:은|는|이|가)(?=\s)/gu)]
    .some(match => !FACT_SUBJECT.test(match[1]));
}

function isEvidenceFollowup(text: string): boolean {
  if (/추천|후보|확정|정정|철회|틀렸|취소|무시|아니|바꿔|변경/u.test(text) || hasDifferentTopic(text)) return false;
  if (!/(?:서면\s*견적|견적|식사\s*금액|식대|최소\s*(?:식사\s*)?인원|대관료|포함\s*(?:범위|항목)|총액|예산)/u.test(text)) return false;
  if (!/(?:받아|받은|요청|확인한\s*뒤|확인한\s*후)/u.test(text)) return false;
  return /(?:확인(?:하세요|해야\s*해요|해\s*보세요)|판단해야\s*해요|비교(?:하세요|해\s*보세요)|받아(?:보세요|야\s*해요)|요청하세요)$/u.test(text);
}

function isFactConditionPrefix(text: string): boolean {
  // 모르는 수식어를 같은 안의 조건으로 추정하지 않는다. '촬영 패키지의 예산'도 남긴다.
  let scope = text;
  scope = scope.replace(AGREEMENT_NEGATION, " ").replace(NOT_AN_AGREED_FACT, " ");
  scope = scope.replace(/\d[\d,]*(?:\.\d+)?\s*(?:만|억|천)?\s*(?:명|원)(?:은|는|이|가)(?=\s)/gu, " ");
  // 예산 안의 포함 범위를 묻는 항목 나열은 별도 분야의 후보 선언과 구분한다.
  if (/(?:\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?\s*원\s*안에|예산\s*(?:안에|에))/u.test(scope)) {
    scope = scope.replace(/(?:^|\s)[가-힣]+(?:\s*[·,]\s*[가-힣]+)*\s+등이\s+포함되는지는(?=\s)/gu, " ");
  }
  return scope
    .replace(/(?:확인|검증)(?:되지\s*않(?:아|아서|았으므로)|하지\s*못(?:해|해서|했으므로)|할\s*수\s*없(?:어|어서|으므로))/gu, " ")
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:억|만|천)?\s*(?:원|명)?/gu, " ")
    .replace(/(?:^|\s)(?:다만|아직|현재(?:로서는)?|지금(?:은)?|안에서|안에|이내에서|이내에|가능한지는|가능할지는|맞는지는|충족하는지는|이\s*(?:안은|제안은|후보는))(?=\s|$)/gu, " ")
    .replace(/(?:^|\s)(?:(?:견적|가격|비용|예산|상한|인원|날짜|일정|범위|금액|수용량|접근성|식대|적합성|가능성|여부)){1,3}(?:은|는|이|가|을|를|의|에|에서|으로)?(?=\s|$)/gu, " ")
    .replace(/[,~·\s]/gu, "") === "";
}

function hasCandidateStateWithContext(plain: string): boolean {
  // 물음표를 버리면 질문이 단정으로 바뀌므로 문장 종결도 함께 보존한다.
  const pieces = plain.split(/([.!?](?:\s+|$))/u);
  const sentences = pieces.flatMap((piece, index) => index % 2 || !piece.trim()
    ? [] : [{ text: piece.trim(), ending: pieces[index + 1]?.trim() ?? "" }]);
  const states = sentences.flatMap((sentence, index) => {
    if (sentence.text.includes("?") || sentence.ending.includes("?") || HYPOTHETICAL_STATE.test(sentence.text)) return [];
    const state = classifyCandidateState(sentence.text);
    return state ? [{ index, state }] : [];
  });
  if (states.length !== 1) return false;
  const { index, state } = states[0];
  // 추천의 인과 이유와 같은 조건의 확인 안내를 각각 한 문장까지만 허용한다.
  if (index < 1 || index > 2 || sentences.length > index + 2) return false;
  if (index === 2 && (!/때문(?:이에요|입니다|이죠)$/u.test(sentences[1].text) || hasDifferentTopic(sentences[1].text, true))) return false;
  if (!isFactConditionPrefix(sentences[index].text.slice(0, state.index))) return false;
  const followup = sentences[index + 1];
  return !followup || (followup.ending !== "?" && isEvidenceFollowup(followup.text));
}

export function alignAmoraRecommendationLabels(text: string): { text: string; count: number } {
  let fence: string | null = null;
  let count = 0;
  const corrected = text.split(/(\r?\n[ \t]*\r?\n)/u).map(block => {
    let protectedBlock = fence !== null;
    for (const line of block.split(/\r?\n/u)) {
      const marker = line.match(/^[ \t]*(`{3,}|~{3,})(.*)$/u);
      if (!marker) continue;
      protectedBlock = true;
      if (fence === null) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
    }
    if (protectedBlock || PROTECTED_PROSE.test(block)) return block;
    const label = block.match(RANK_LABEL);
    if (!label) return block;
    const plain = block.replaceAll("**", "");
    const candidates = namedCandidates(plain);
    if (candidates.size !== 1
      || [...plain.matchAll(new RegExp(RANKED_RECOMMENDATION.source, "gu"))].length !== 1
      || /(?:[2-9]|\d{2,})\s*순위/u.test(plain)) return block;

    const firstEnd = plain.search(/[.!?]\s/u);
    // 단독 제목·부정 설명·다른 문장의 주제가 섞인 경우는 같은 대상을 추정하지 않는다.
    if (firstEnd < 0 || plain.slice(0, firstEnd + 1).includes("?") || HYPOTHETICAL_STATE.test(plain.slice(0, firstEnd))
      || /단정하지|추천하지|하지\s*않|(?:이|은)\s*(?:아니|없)/u.test(plain.slice(0, firstEnd))) return block;
    const firstCandidates = namedCandidates(plain.slice(0, firstEnd));
    if (firstCandidates.size !== 1 || ![...firstCandidates].every(candidate => candidates.has(candidate))) return block;
    if (!hasCandidateStateWithContext(plain)) return block;

    let tail = block.slice(label[0].length);
    // 받침 있는 '추천은/추천이'를 모음으로 끝나는 '후보는/후보가'에 맞춘다.
    if (/추천$/u.test(label[2])) tail = tail.replace(/^([ \t]*(?:\*\*)?)(은|이)/u,
      (_match, prefix: string, particle: string) => prefix + (particle === "은" ? "는" : "가"));
    count++;
    return block.slice(0, label[1].length) + "우선 검토 후보" + tail;
  }).join("");
  return { text: corrected, count };
}

/** 뒤의 후보 단서가 오기 전에 순위 문장을 보내지 않는다. 정상 추천의 최종 본문은 보존한다. */
export function hasAmoraRankedRecommendation(text: string): boolean {
  return RANKED_RECOMMENDATION.test(text);
}
