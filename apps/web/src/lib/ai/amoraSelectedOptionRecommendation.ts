// 선택지 자체가 밝힌 예산 가능성 미확인만 연결한다. 가격이나 견적의 사실성을 판단하지 않는다.
const OPTION_HEADING = /^\*\*((?:절충안[ \t]+[1-9]\d*|[1-9]\d*안))[ \t]+[—–-][ \t]+[^*\r\n]+\*\*$/u;
const SELECTED_RANK = /^([ \t]*(?:\*\*)?(?:(?:현재|지금)[ \t]+)?)(추천[ \t]*1[ \t]*순위)[ \t]*는[ \t]*((?:절충안[ \t]+[1-9]\d*|[1-9]\d*안))(?:\*\*)?(?:이에요|입니다)[.!](?=\s|$)/u;
const FEASIBILITY_UNCONFIRMED = /^-[ \t]+(?:\d[\d,]*(?:\.\d+)?[ \t]*(?:천|만|억)?[ \t]*원|총예산|예산)[ \t]*(?:안에서|이내에서)[ \t]+가능한지는[ \t]+(?:실제|서면)[ \t]+견적[ \t]+확인[ \t]+필요(?:해요|합니다)?[.!]?$/u;
const PROTECTED_CONTEXT = /[`"'“”‘’「」『』]|(?:^|\n)[ \t]*(?:>|\||#{1,6}\s|~{3,})|(?:이전|지난|과거|예전)(?:번)?(?:의)?\s*(?:제안|답변|추천|설명)|(?:라고|라는)\s*(?:말|표현|문구|원문)|(?:^|\s)만약(?:\s|$)|가정(?:하면|한|해서)/u;
const UPDATED_EVIDENCE = /(?:확인|검증)(?:했|됐|되었|된)|확정|정정|철회|취소|최종\s*견적/u;

export function alignSelectedOptionRecommendation(text: string): { text: string; count: number } {
  const unchanged = { text, count: 0 };
  if (PROTECTED_CONTEXT.test(text)) return unchanged;

  // 빈 줄로 분리된 굵은 번호 제목+목록만 지원한다. 모호한 참조를 임의로 이어 붙이지 않는다.
  const pieces = text.split(/(\r?\n[ \t]*\r?\n)/u);
  const blocks = pieces.flatMap((block, index) => index % 2 || !block.trim() ? [] : [{ block, index }]);
  const last = blocks.at(-1);
  if (!last) return unchanged;
  const rank = last.block.match(SELECTED_RANK);
  if (!rank || UPDATED_EVIDENCE.test(last.block)
    || [...last.block.matchAll(/(?:절충안[ \t]+[1-9]\d*|[1-9]\d*안)/gu)].length !== 1
    || [...last.block.matchAll(/(?:추천[ \t]*\d+[ \t]*순위|\d+[ \t]*순위[ \t]*추천|최우선[ \t]*추천)/gu)].length !== 1) return unchanged;

  const options = blocks.flatMap(({ block, index }) => {
    const lines = block.split(/\r?\n/u);
    const heading = lines[0].match(OPTION_HEADING);
    return heading ? [{ number: heading[1].replace(/\D/gu, ""), lines, index }] : [];
  });
  const selected = options.filter(option => option.number === rank[3].replace(/\D/gu, ""));
  if (selected.length !== 1 || selected[0].index >= last.index) return unchanged;
  // 다른 안의 본문에서 선택 번호를 다시 다루면 최신 상태의 교차 참조가 모호하다.
  if (options.some(option => option.index !== selected[0].index
    && [...option.lines.slice(1).join("\n").matchAll(/(?:절충안[ \t]+[1-9]\d*|[1-9]\d*안)/gu)]
      .some(reference => reference[0].replace(/\D/gu, "") === selected[0].number))) return unchanged;
  // 다른 형식의 중복 제목이나 선택지 사이의 별도 정정 문단은 현재 근거로 해석하지 않는다.
  if ([...text.matchAll(/^\*\*(?:절충안[ \t]+[1-9]\d*|[1-9]\d*안)/gmu)].length !== options.length
    || blocks.some(({ index }) => index > selected[0].index && index < last.index
      && !options.some(option => option.index === index))) return unchanged;

  const evidence = selected[0].lines.slice(1);
  if (!evidence.length || evidence.some(line => !/^-\s+[^\r\n]+$/u.test(line))
    || UPDATED_EVIDENCE.test(evidence.join("\n"))
    || !FEASIBILITY_UNCONFIRMED.test(evidence.at(-1) ?? "")) return unchanged;

  pieces[last.index] = last.block.slice(0, rank[1].length) + "우선 검토 후보"
    + last.block.slice(rank[1].length + rank[2].length);
  return { text: pieces.join(""), count: 1 };
}
