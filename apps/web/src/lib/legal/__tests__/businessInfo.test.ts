import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { businessInfoRows, readBusinessInfo, BUSINESS_INFO_ENV_KEYS } from "../businessInfo";

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

  // 위 테스트들은 전부 env를 직접 주입해서, 인수 없이 부르는 실제 호출 경로를
  // 한 번도 밟지 않았다. privacy 페이지는 그 경로를 쓴다.
  it("인수 없이 부르면 실제 환경변수를 읽는다", () => {
    vi.stubEnv("NEXT_PUBLIC_BUSINESS_NAME", "웨딩한방");
    vi.stubEnv("NEXT_PUBLIC_BUSINESS_REGISTRATION_NUMBER", "000-00-00000");

    expect(readBusinessInfo()?.companyName).toBe("웨딩한방");

    vi.unstubAllEnvs();
  });
});

// privacy 페이지는 "use client"다. Next는 소스에 **리터럴**로 적힌
// `process.env.NEXT_PUBLIC_X`만 빌드 시점에 값으로 치환한다 —
// `env[key]`나 별칭 객체를 거치면 브라우저에서 undefined가 되고,
// 서버 프리렌더 HTML에는 보이던 사업자 정보가 하이드레이션 직후 사라진다.
// (env를 주입하는 단위 테스트로는 절대 잡히지 않는 종류의 결함이다.)
describe("businessInfo 클라이언트 번들 계약", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src", "lib", "legal", "businessInfo.ts"),
    "utf8",
  );

  it("읽는 모든 키를 리터럴 process.env 접근으로 적어 둔다", () => {
    const missing = BUSINESS_INFO_ENV_KEYS.filter(
      (key) => !source.includes(`process.env.${key}`),
    );

    expect(
      missing,
      `리터럴 접근 누락: ${missing.join(", ")} — 클라이언트 번들에 값이 들어가지 않는다`,
    ).toEqual([]);
  });

  it("공개 키 목록이 화면에 뿌리는 항목과 어긋나지 않는다", () => {
    // 키를 새로 추가하고 목록에 안 넣으면 그 값만 조용히 브라우저에서 빈다.
    const declared = [...source.matchAll(/env\.(NEXT_PUBLIC_BUSINESS_[A-Z_]+)/g)]
      .map((match) => match[1]);

    expect(new Set(declared)).toEqual(new Set(BUSINESS_INFO_ENV_KEYS));
  });
});
