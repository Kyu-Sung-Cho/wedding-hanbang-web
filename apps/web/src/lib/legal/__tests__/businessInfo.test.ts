import { describe, expect, it } from "vitest";

import { businessInfoRows, readBusinessInfo } from "../businessInfo";

// 사업자 정보는 지어낼 수 없는 값이다. 값이 없을 때 자리표시자라도 띄우면
// 그게 곧 허위 표시가 되므로, "없으면 아예 안 나온다"를 못 박는다.
describe("readBusinessInfo", () => {
  const full = {
    NEXT_PUBLIC_BUSINESS_NAME: "웨딩한방",
    NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER: "000-00-00000",
    NEXT_PUBLIC_BUSINESS_REPRESENTATIVE: "조규성",
    NEXT_PUBLIC_BUSINESS_CONTACT_EMAIL: "ceo@hanbang.ai",
  };

  it("상호와 사업자등록번호가 모두 있어야 노출한다", () => {
    expect(readBusinessInfo(full)).not.toBeNull();
    expect(readBusinessInfo({ ...full, NEXT_PUBLIC_BUSINESS_NAME: undefined })).toBeNull();
    expect(
      readBusinessInfo({ ...full, NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER: undefined }),
    ).toBeNull();
  });

  it("값이 하나도 없으면 아무것도 노출하지 않는다", () => {
    expect(readBusinessInfo({})).toBeNull();
  });

  it("공백만 있는 값은 없는 것으로 본다", () => {
    expect(readBusinessInfo({ ...full, NEXT_PUBLIC_BUSINESS_NAME: "   " })).toBeNull();
  });

  it("설정되지 않은 항목은 목록에서 빠진다", () => {
    const rows = businessInfoRows(readBusinessInfo(full)!);
    const labels = rows.map(([label]) => label);
    expect(labels).toEqual(["상호", "대표자", "사업자등록번호", "이메일"]);
    // 통신판매업 신고번호·주소·전화는 값이 없으므로 아예 나오지 않는다.
    expect(labels).not.toContain("통신판매업 신고번호");
    expect(labels).not.toContain("사업장 주소");
  });

  it("비정상적으로 긴 값은 받지 않는다", () => {
    expect(
      readBusinessInfo({ ...full, NEXT_PUBLIC_BUSINESS_NAME: "가".repeat(201) }),
    ).toBeNull();
  });
});
