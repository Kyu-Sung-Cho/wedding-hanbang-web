import { describe, expect, it } from "vitest";
import { WEDDING_CODE_V31_TASTES, WEDDING_CODE_V31_OPTIONS } from "@/constants/weddingCodeV31";
import { createV31Draft, decodeV31, encodeV31, v31ChoiceLabels } from "../v31";
import { v31TasteNoPreferenceLabel } from "../v31DisplayCopy";

describe("display wording preserves saved choice meaning", () => {
  it("keeps neutral distinct from unknown and the rating value", () => {
    expect(WEDDING_CODE_V31_OPTIONS[2]).toEqual({value:3,label:"동의하지도 반대하지도 않아요"});
    const draft=createV31Draft();draft.answers.B1=3;draft.answers.B3="undecided";
    expect(decodeV31(encodeV31(draft))?.answers).toEqual(draft.answers);
  });
  for(const taste of WEDDING_CODE_V31_TASTES) it(`preserves ${taste.key} no preference and other escape statuses`, () => {
    const draft=createV31Draft();draft.tastes[taste.key]={status:"no_preference"};
    const code=encodeV31(draft);const restored=decodeV31(code)!;
    expect(restored.tastes[taste.key]).toEqual({status:"no_preference"});
    expect(v31ChoiceLabels(restored.tastes[taste.key],taste.options)).toEqual([v31TasteNoPreferenceLabel(taste.key)]);
    const statuses=["undecided","no_match","not_applicable","skipped"] as const;
    const expected=["아직 모르겠어요","맞는 보기가 없어요","이번 계획에는 없어요","지금 답하지 않을게요"];
    statuses.forEach((status,index)=>expect(v31ChoiceLabels({status},taste.options)).toEqual([expected[index]]));
    expect(encodeV31(restored)).toBe(code);
  });
});
