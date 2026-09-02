import { createServer, type Server } from "node:http";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { readEmailDeliveryApiKey } from "../deliveryFailure";

// SDK 는 목적지를 **모듈을 읽는 순간** 한 번만 정한다
// (`const baseUrl = process.env.RESEND_BASE_URL || defaultBaseUrl`).
// 그래서 서버를 띄운 **뒤에** 환경변수를 세우고 그때 불러온다. 정적 import 로
// 두면 이미 api.resend.com 을 향한 뒤라 이 검사가 조용히 아무것도 확인하지 않는다.
let Resend: typeof import("resend").Resend;

// **실제 SDK 로** 확인한다. 여기서 `resend` 를 모킹하면 검증하려는 것이 사라진다 —
// 문제는 우리 코드가 아니라 "SDK 가 값을 검사하지 않고 그대로 헤더에 넣는다"였다.
//
// SDK 는 `RESEND_BASE_URL` 로 목적지를 바꿀 수 있으므로(resend 6.10.0), 로컬
// 서버를 세워 **제공자가 실제로 받는 Authorization 헤더**를 본다. 메일은 나가지
// 않는다 — 받는 쪽이 우리 서버다.
//
// 2026-09-02 운영 증상: `POST /api/auth/signup` → 502 「인증 메일을 보내지 못했어요」.
// 실측한 제공자 응답:
//   {"statusCode":401,"name":"validation_error","message":"API key is invalid"}
// 환경변수 끝의 줄바꿈 한 글자로 그 응답이 나온다.

let server: Server;
let baseUrl: string;
const received: Array<string | undefined> = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      received.push(request.headers.authorization);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "stub-message-id" }));
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("스텁 서버 주소를 얻지 못했습니다");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
  process.env.RESEND_BASE_URL = baseUrl;
  ({ Resend } = await import("resend"));
});

afterAll(async () => {
  delete process.env.RESEND_BASE_URL;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

afterEach(() => {
  received.length = 0;
  vi.unstubAllEnvs();
});

async function sendWith(key: string | undefined) {
  return new Resend(key).emails.send({
    from: "웨딩한방 <noreply@hanbang.ai>",
    to: "probe@example.test",
    subject: "probe",
    html: "<p>probe</p>",
  });
}

/**
 * 어떤 지저분함이 **실제로** 요청을 망가뜨리는가.
 *
 * 처음에는 "환경변수 끝의 줄바꿈이 원인"이라고 적었다. 관측해 보니 틀렸다 —
 * Node 의 `Headers` 가 뒤쪽 공백을 지워 주기 때문에 그것은 무해하다. 위험한 것은
 * **앞쪽** 공백과 값 안쪽의 이물질이다. 이 표를 여기 고정해 두면 다음 사람이
 * 같은 오판을 하지 않는다.
 */
describe("자격 문자열이 제공자에 도착하는 모양 (실측)", () => {
  const HARMLESS = [
    ["깨끗한 키", "re_example_key"],
    ["뒤에 줄바꿈", "re_example_key\n"],
    ["뒤에 CRLF", "re_example_key\r\n"],
    ["뒤에 공백", "re_example_key "],
  ] as const;

  for (const [label, key] of HARMLESS) {
    it(`${label} → 다듬지 않아도 깨끗한 헤더가 나간다`, async () => {
      await sendWith(key);
      expect(received).toEqual(["Bearer re_example_key"]);
    });
  }

  const CORRUPTING = [
    ["앞에 공백", "  re_example_key", "Bearer   re_example_key"],
    ["앞뒤 공백", "  re_example_key  ", "Bearer   re_example_key"],
    ["따옴표로 싸임", '"re_example_key"', 'Bearer "re_example_key"'],
  ] as const;

  for (const [label, key, dirtyHeader] of CORRUPTING) {
    it(`${label} → 다듬지 않으면 헤더가 망가진다`, async () => {
      await sendWith(key);
      // 제공자는 이 헤더를 "API key is invalid" 로 거절한다 → 가입이 502 로 끝난다.
      expect(received).toEqual([dirtyHeader]);
    });
  }

  it("값 안의 줄바꿈은 SDK 안에서 던진다 — 502 가 아니라 500 이 된다", async () => {
    // 이 경우만 응답 모양이 다르다. Headers.append 가 거부하므로 요청이 아예
    // 나가지 않고, 라우트의 바깥 catch 가 "회원가입 처리 중 오류" 500 을 낸다.
    await expect(sendWith("re_exa\nmple")).rejects.toThrow(/invalid header value/i);
    expect(received).toEqual([]);
  });

  it("우리가 읽는 값을 쓰면 앞쪽 공백 사고가 사라진다", async () => {
    vi.stubEnv("RESEND_API_KEY", "  re_example_key\n");

    const result = await sendWith(readEmailDeliveryApiKey() ?? undefined);

    expect(received).toEqual(["Bearer re_example_key"]);
    expect(result.error).toBeNull();
    expect(result.data?.id).toBe("stub-message-id");
  });

  it("공백만 있는 값은 발송을 시도하지 않는다", async () => {
    // SDK 는 "   " 를 받아도 던지지 않으므로, 우리가 먼저 걸러야 한다.
    vi.stubEnv("RESEND_API_KEY", "   ");

    expect(readEmailDeliveryApiKey()).toBeNull();
    expect(received).toEqual([]);
  });
});
