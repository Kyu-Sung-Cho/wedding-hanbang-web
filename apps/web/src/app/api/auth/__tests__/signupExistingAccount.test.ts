import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// 예전에 가입한 걸 잊고 다시 가입한 사람은 "가입 확인 이메일을 보냈어요"를 보고
// 받은편지함을 계속 새로고침했다. 메일은 영영 오지 않았다. 로그인하면 "이메일 인증이
// 완료되지 않았습니다" 한 줄뿐이고 재발송 수단도 없어, 가입도 로그인도 못 하는 상태에
// 갇혔다.
//
// 응답을 신규 가입과 다르게 만드는 것은 답이 아니다 — 그러면 어떤 주소가 이 서비스에
// 있는지 밖에서 확인할 수 있다. 응답은 그대로 두고 메일을 실제로 보내야 한다.

const source = readFileSync(
  resolve(process.cwd(), "src/app/api/auth/signup/route.ts"),
  "utf8",
);

describe("이미 가입된 주소로 다시 가입할 때", () => {
  it("계정 주인에게 실제로 메일을 보낸다", () => {
    // 예전에는 이 분기가 아무것도 보내지 않고 성공만 돌려줬다.
    expect(source).toContain("sendExistingAccountNotice");
    expect(source).toMatch(
      /already been registered[\s\S]{0,1200}sendExistingAccountNotice/u,
    );
  });

  it("비밀번호를 되찾을 길을 함께 보낸다", () => {
    // 비밀번호를 잊어 다시 가입하는 경우가 가장 흔하다.
    expect(source).toMatch(/sendExistingAccountNotice[\s\S]*?type:\s*"recovery"/u);
    expect(source).toContain("비밀번호 새로 정하기");
  });

  it("링크를 만들지 못해도 메일 자체는 보낸다", () => {
    // 아무것도 오지 않는 것이 원래의 문제였다. 링크가 없으면 로그인 경로라도 준다.
    expect(source).toContain("로그인하러 가기");
  });

  it("본인이 아닐 수 있다는 것을 알려준다", () => {
    expect(source).toContain("본인이 시도하신 게 아니라면");
  });
});

describe("계정이 있는지 밖에서 알 수 없어야 한다", () => {
  it("응답 본문이 신규 가입과 글자 하나까지 같다", () => {
    const responses = [...source.matchAll(
      /NextResponse\.json\(\{\s*success:\s*true,\s*message:\s*"([^"]+)"/gu,
    )].map((match) => match[1]);

    // 성공 응답이 두 갈래(신규 / 이미 있음) 모두 같은 문장이어야 한다.
    expect(responses.length).toBeGreaterThanOrEqual(2);
    expect(new Set(responses).size).toBe(1);
  });

  it("이미 가입됨을 드러내는 문구를 응답에 쓰지 않는다", () => {
    // 메일 본문에는 있어도 되지만(주인만 본다) API 응답에는 있으면 안 된다.
    const responseBodies = [...source.matchAll(/NextResponse\.json\(([\s\S]{0,200}?)\)/gu)]
      .map((match) => match[1])
      .join("\n");

    for (const leak of ["이미 가입", "already registered", "exists"]) {
      expect(responseBodies, leak).not.toContain(leak);
    }
  });

  it("메일 발송이 실패해도 응답이 달라지지 않는다", () => {
    // 실패를 호출부로 올리면 응답 모양이나 시간이 달라져 그 자체가 신호가 된다.
    expect(source).toMatch(
      /async function sendExistingAccountNotice[\s\S]*?try\s*\{[\s\S]*?\}\s*catch/u,
    );
    expect(source).toMatch(/sendExistingAccountNotice[\s\S]*?Promise<void>/u);
  });
});

// 동의 없이 만들어진 계정이 문제였다. 검사가 계정 생성보다 **앞**에 있어야
// 하고, 동의 사실이 실제로 기록돼야 한다.
describe("필수 동의 없이는 계정을 만들지 않는다", () => {
  it("동의 검사가 계정 생성보다 먼저 온다", () => {
    // 파일 위쪽 sendExistingAccountNotice 도 generateLink 를 쓴다(type: "recovery").
    // 계정을 만드는 쪽은 type: "signup" 하나뿐이므로 그것을 지목한다.
    const consentAt = source.indexOf("parseSignupConsent(body)");
    const createAt = source.indexOf('type: "signup"');
    expect(consentAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(-1);
    expect(consentAt).toBeLessThan(createAt);
  });

  it("동의가 없으면 400 으로 되돌린다", () => {
    expect(source).toMatch(
      /if \(!consent\)[\s\S]{0,400}SIGNUP_CONSENT_REQUIRED[\s\S]{0,200}status: 400/u,
    );
  });

  it("무엇에·어느 판에·언제 동의했는지 남긴다", () => {
    for (const field of [
      "terms_agreed",
      "privacy_agreed",
      "consent_policy_version",
      "consent_agreed_at",
    ]) {
      expect(source, field).toContain(field);
    }
  });
});
