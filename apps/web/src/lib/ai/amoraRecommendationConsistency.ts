// 추천의 근거를 새로 판단하지 않는다. 같은 문단에서 스스로 후보라고 낮춘 명칭만 맞춘다.
const RANK_LABEL = /^([ \t]*(?:\*\*)?)(추천[ \t]*1[ \t]*순위|1[ \t]*순위[ \t]*추천|최우선[ \t]*추천)(?=[ \t]*(?:[은는이가:：]|\*\*|$))/u;
const RANKED_RECOMMENDATION = /(?:추천[ \t]*1[ \t]*순위|1[ \t]*순위[ \t]*추천|최우선[ \t]*추천)/u;
const UNVERIFIED = /(?:확인|검증)(?:되지\s*않|하지\s*못|하지\s*않|할\s*수\s*없)|미(?:확인|검증)/u;
const SELF_CANDIDATE = /(?:현재(?:로서는)?|지금(?:은|으로서는)?|이\s*(?:안|제안|추천|선택)(?:은|이)?|제가\s*(?:제시한|드린)\s*(?:안|제안)(?:은|이)?)\s*(?:아직\s*)?(?:실제|확정(?:적인)?|최종)\s*추천(?:이|은)?\s*(?:아니라|아닌|아니고)(?=\s)[^.!?\n]{0,96}후보(?:예요|이에요|입니다)(?=[.!?]|$)/u;
const PROTECTED_PROSE = /[`"'“”‘’「」『』]|(?:라고|라는|이라고|이라는)\s*(?:말|표현|문구|요청|의견|뜻|의미)|(?:^|\n)[ \t]*(?:>|\||[-*+]\s|\d+[.)]\s|#{1,6}\s)/u;
const FACT_SUBJECT = /^(?:견적|가격|비용|예산|상한|인원|날짜|일정|범위|금액|수용량|접근성|식대)$/u;

function namedCandidates(text: string): Set<string> {
  return new Set([...text.matchAll(/(?:[A-Z0-9]+\s*안|안\s*[A-Z0-9]+|[가-힣A-Za-z0-9·-]+(?:웨딩홀|예식장|호텔|홀))(?=[은는이가입을를의\s,.!?*]|$)/gu)]
    .map(match => match[0].replace(/\s/gu, "").replace(/^안([A-Z0-9]+)$/u, "$1안"))
    .filter(name => !["웨딩홀", "예식장", "호텔"].includes(name)));
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
    const candidateStatements = [...plain.matchAll(new RegExp(SELF_CANDIDATE.source, "gu"))];
    if (!UNVERIFIED.test(plain) || candidates.size !== 1
      || candidateStatements.length !== 1
      || [...plain.matchAll(new RegExp(RANKED_RECOMMENDATION.source, "gu"))].length !== 1
      || /(?:[2-9]|\d{2,})\s*순위/u.test(plain)) return block;
    const candidateStatement = candidateStatements[0];
    // 후보 설명 뒤에 정정·새 판단이 이어지면 앞 명칭과의 관계를 추정하지 않는다.
    if (!/^[.!?。\s]*$/u.test(plain.slice(candidateStatement.index + candidateStatement[0].length))) return block;

    const firstEnd = plain.search(/[.!?]\s/u);
    // 단독 제목·부정 설명·다른 문장의 주제가 섞인 경우는 같은 대상을 추정하지 않는다.
    if (firstEnd < 0 || /단정하지|추천하지|하지\s*않|(?:이|은)\s*(?:아니|없)/u.test(plain.slice(0, firstEnd))) return block;
    const firstCandidates = namedCandidates(plain.slice(0, firstEnd));
    if (firstCandidates.size !== 1 || ![...firstCandidates].every(candidate => candidates.has(candidate))) return block;
    // 포함 범위를 묻는 집합 표현만 제외하고, 연결 어미와 무관하게 명시적 주제를 살핀다.
    const scope = plain.slice(firstEnd + 1, candidateStatement.index)
      .replace(/(?:^|\s)등이\s+포함되는지는(?=\s)/gu, " ");
    const subjects = [...scope.matchAll(/(?:^|\s)([가-힣A-Za-z0-9·-]+?)(?:은|는|이|가)(?=\s)/gu)];
    if (subjects.some(match => !FACT_SUBJECT.test(match[1]))) return block;

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
