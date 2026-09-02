#!/usr/bin/env node
// 가입 인증 메일이 왜 안 나가는지 **한 번의 명령으로** 확인한다.
//
// ## 왜 필요한가
//
// 2026-09-02 운영: 이메일 가입이 `POST /api/auth/signup` → 502 로 끝나고 있었다.
// 화면에는 "인증 메일을 보내지 못했어요" 한 문장만 나오고, 서버에는 원인이 남지
// 않았다. 그래서 밖에서는 "가입이 안 된다"만 보이고 안에서는 무엇이 고장 났는지
// 아무도 몰랐다.
//
// 저장소 안에서 확인할 수 있는 것은 모두 정상이었다:
//
//   - DNS: `resend._domainkey` DKIM · `send.hanbang.ai` SPF/MX 전부 살아 있다
//   - 코드: 발송 성공 판정(`data.id`)이 SDK 6.10.0 의 응답 모양과 맞다
//   - 코드: 받는 주소는 소문자 정규화된 평범한 주소다
//   - 코드: 한글 표시 이름은 2026-08-22 에 실제로 메일이 도착했던 그 값이다
//   - Supabase: 502 는 `generateLink` 가 성공한 **뒤에만** 닿는 자리다
//
// 남은 것은 제공자 계정 상태(키가 회수됐는지, 도메인 검증이 풀렸는지, 한도인지)이고
// 그것만은 저장소 밖이다. 이 도구가 그 하나를 본다.
//
// ## 무엇을 하지 않는가
//
// **메일을 보내지 않는다.** 읽기 전용 조회만 한다 — 진단하려고 남의 받은편지함에
// 메일을 넣지 않는다. 키 값은 어디에도 출력하지 않는다.
//
// ## 쓰는 법
//
//   RESEND_API_KEY=re_... node ./scripts/check-email-delivery.mjs
//
// 나오는 코드는 런타임이 사용자에게 돌려주는 코드와 같은 어휘다
// (`apps/web/src/lib/email/deliveryFailure.ts`). 그래서 Sentry 에 찍힌 코드와
// 이 도구의 판정을 그대로 맞춰 볼 수 있다.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SENDER_FILE = "apps/web/src/lib/email/sender.ts";

/**
 * 앱이 실제로 쓰는 보내는 주소의 도메인.
 *
 * 값을 여기 베껴 적지 않는다 — 베껴 적으면 앱이 주소를 바꿀 때 이 도구가 조용히
 * 엉뚱한 도메인을 확인하게 된다.
 */
export function readSenderDomain(source) {
  const match = /ACCOUNT_EMAIL_SENDER\s*=\s*"([^"]+)"/u.exec(source);
  if (!match) {
    throw new Error(`${SENDER_FILE} 에서 ACCOUNT_EMAIL_SENDER 를 찾지 못했습니다.`);
  }
  const address = /<([^>]+)>/u.exec(match[1])?.[1] ?? match[1];
  const domain = address.split("@")[1]?.trim().toLowerCase();
  if (!domain) throw new Error(`보내는 주소에서 도메인을 읽지 못했습니다: ${match[1]}`);
  return domain;
}

/**
 * 조회 결과를 판정으로 옮긴다. 네트워크를 모르는 순수 함수라 테스트가 값싸다.
 *
 * `code` 는 런타임 분류기와 같은 어휘를 쓴다. 두 곳이 같은 말을 해야 Sentry 의
 * 한 줄과 이 도구의 출력을 맞춰 볼 수 있다.
 */
export function verdict({ apiKeyPresent, status, domains, senderDomain, error }) {
  if (!apiKeyPresent) {
    return {
      code: "EMAIL_DELIVERY_UNCONFIGURED",
      summary: "RESEND_API_KEY 가 이 환경에 없습니다.",
      next: "배포 환경에 키를 넣으세요. 키가 없으면 가입은 계정을 만들기 전에 503 으로 되돌아갑니다.",
    };
  }

  // 상태 코드만 보면 안 된다. 실측(2026-09-02)에서 같은 "키가 틀렸다"가 부르는
  // 자리마다 다른 코드로 왔다:
  //
  //   GET  /domains  잘못된 키  → 400 validation_error "API key is invalid"
  //   GET  /domains  키 없음    → 401 missing_api_key   "Missing API Key"
  //   POST /emails   잘못된 키  → 401 validation_error  "API key is invalid"
  //
  // 그래서 런타임 분류기와 같은 방식으로 **문장**을 본다.
  const detail = `${error?.name ?? ""} ${error?.message ?? ""}`.toLowerCase();
  if (
    status === 401
    || status === 403
    || /api.?key|unauthorized|restricted/.test(detail)
  ) {
    return {
      code: "EMAIL_DELIVERY_CREDENTIAL",
      summary: `제공자가 키를 거절했습니다 (HTTP ${status}${error?.name ? `, ${error.name}` : ""}).`,
      next: "키가 회수·회전됐거나 권한이 좁혀졌습니다. Resend 에서 키를 새로 만들어 배포 환경의 RESEND_API_KEY 를 바꾸세요.",
    };
  }

  if (typeof status === "number" && status >= 500) {
    return {
      code: "EMAIL_DELIVERY_PROVIDER_ERROR",
      summary: `제공자가 응답하지 못했습니다 (HTTP ${status}).`,
      next: "제공자 장애일 수 있습니다. 잠시 후 다시 확인하세요.",
    };
  }

  if (typeof status === "number" && status !== 200) {
    return {
      code: "EMAIL_DELIVERY_PROVIDER_ERROR",
      summary: `예상하지 못한 응답입니다 (HTTP ${status}).`,
      next: "Resend API 응답을 직접 확인하세요.",
    };
  }

  const list = Array.isArray(domains) ? domains : [];
  const match = list.find((entry) => entry?.name?.toLowerCase() === senderDomain);

  if (!match) {
    return {
      code: "EMAIL_DELIVERY_SENDER_DOMAIN",
      summary: `보내는 도메인 ${senderDomain} 이 이 계정에 등록돼 있지 않습니다.`,
      next: `등록된 도메인: ${list.map((entry) => entry?.name).filter(Boolean).join(", ") || "(없음)"}. 키가 다른 계정의 것일 수 있습니다.`,
    };
  }

  if (match.status !== "verified") {
    return {
      code: "EMAIL_DELIVERY_SENDER_DOMAIN",
      summary: `보내는 도메인 ${senderDomain} 의 상태가 "${match.status}" 입니다 (verified 아님).`,
      next: "Resend 에서 도메인을 다시 검증하세요. DNS 레코드는 저장소 밖에서 확인했을 때 정상이었으므로, 계정 쪽 검증 상태만 풀린 경우일 수 있습니다.",
    };
  }

  return {
    code: "OK",
    summary: `키가 유효하고 ${senderDomain} 은 verified 입니다${match.region ? ` (region: ${match.region})` : ""}.`,
    next: "설정은 정상입니다. 그래도 가입이 실패한다면 남은 원인은 한도(일일·월간 쿼터, 초당 요청 제한)입니다 — Sentry 의 kind=rate_limit 을 확인하세요.",
  };
}

async function main() {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const senderDomain = readSenderDomain(
    readFileSync(resolve(repoRoot, SENDER_FILE), "utf8"),
  );

  console.log(`[email-delivery] 보내는 도메인: ${senderDomain} (${SENDER_FILE} 기준)`);

  if (!apiKey) {
    report(verdict({ apiKeyPresent: false, senderDomain }));
    process.exitCode = 1;
    return;
  }

  let status;
  let payload;
  try {
    // 읽기 전용 조회. 메일을 보내지 않는다.
    const response = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    status = response.status;
    payload = await response.json().catch(() => null);
  } catch (error) {
    console.log(`[email-delivery] 조회 실패: ${error.message}`);
    report(verdict({ apiKeyPresent: true, status: 599, senderDomain }));
    process.exitCode = 1;
    return;
  }

  const domains = Array.isArray(payload?.data) ? payload.data : payload?.data?.data;
  for (const entry of Array.isArray(domains) ? domains : []) {
    console.log(`[email-delivery]   ${entry?.name} → ${entry?.status}${entry?.region ? ` (${entry.region})` : ""}`);
  }

  const result = verdict({
    apiKeyPresent: true,
    status,
    domains,
    senderDomain,
    error: payload && typeof payload === "object" ? payload : null,
  });
  report(result);
  process.exitCode = result.code === "OK" ? 0 : 1;
}

function report({ code, summary, next }) {
  console.log(`[email-delivery] 판정: ${code}`);
  console.log(`[email-delivery] ${summary}`);
  console.log(`[email-delivery] 다음 할 일: ${next}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
