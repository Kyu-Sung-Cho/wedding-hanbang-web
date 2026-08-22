// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_FACTS,
  ACCOUNT_DELETION_POLICY_ANCHORS,
} from "@/constants/accountDeletionPolicy";
import { CONTACT } from "@/lib/constants/contact";

// 설정 화면은 사유 선택과 "탈퇴합니다" 입력 확인까지 갖춘 모달을 그대로 렌더하면서
// 제출하면 항상 503 이었고, 약관 제10조·처리방침 제6조는 "설정 페이지에서 직접
// 처리할 수 있습니다"라고 명시했다. 문서가 약속한 경로가 동작하지 않던 상태다.
//
// 동작하게 만든 뒤에도 남는 문제가 있다. 되돌릴 수 없는 행동인데 무엇이 지워지고
// 무엇이 남는지 화면이 말하지 않았다. 특히 "파트너 화면에는 대화가 그대로 남는다"는
// 사실은 사람이 놀라는 자리다(couples.bride_id/groom_id 와 messages.sender_id 가
// ON DELETE SET NULL 이라 커플·대화는 보존되고 식별자만 지워진다).

function source(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), "utf8");
}

describe("탈퇴 정책이 화면과 문서에서 같은 말을 한다", () => {
  it("사실 목록에 되돌릴 수 없음과 파트너 보존이 들어 있다", () => {
    const keys = ACCOUNT_DELETION_FACTS.map((fact) => fact.key);
    expect(keys).toContain("irreversible");
    expect(keys).toContain("partner_keeps_history");
    expect(keys).toContain("vendor_owner_blocked");

    // 놀라는 사실 둘은 눈에 띄어야 한다.
    const emphasized = ACCOUNT_DELETION_FACTS
      .filter((fact) => fact.emphasis)
      .map((fact) => fact.key);
    expect(emphasized).toEqual(["irreversible", "partner_keeps_history"]);
  });

  it("설정 화면이 그 목록을 확인 버튼 앞에서 보여준다", () => {
    const settings = source("src/app/(app)/settings/page.tsx");

    expect(settings).toContain("ACCOUNT_DELETION_FACTS");
    expect(settings).toContain("탈퇴하면 이렇게 돼요");

    // 정책이 확인 입력(그리고 제출 버튼)보다 먼저 나와야 한다. 눌러 버린
    // 뒤에 알려주는 것은 알려주지 않은 것과 같다.
    // 파일 앞쪽에도 "확인을 위해"가 있으므로 모달 안에서만 비교한다.
    const modalAt = settings.indexOf("정말 탈퇴하시겠어요?");
    expect(modalAt).toBeGreaterThan(-1);
    const modal = settings.slice(modalAt);

    const policyAt = modal.indexOf("탈퇴하면 이렇게 돼요");
    const confirmAt = modal.indexOf("확인을 위해");
    const submitAt = modal.indexOf("계정 삭제 요청");
    expect(policyAt).toBeGreaterThan(-1);
    expect(confirmAt).toBeGreaterThan(-1);
    expect(submitAt).toBeGreaterThan(-1);
    expect(policyAt).toBeLessThan(confirmAt);
    expect(policyAt).toBeLessThan(submitAt);
  });

  it("모달에서 약관과 처리방침 전문으로 갈 수 있다", () => {
    const settings = source("src/app/(app)/settings/page.tsx");
    const modalStart = settings.indexOf("탈퇴하면 이렇게 돼요");
    expect(modalStart).toBeGreaterThan(-1);
    const modalRegion = settings.slice(modalStart, modalStart + 2000);

    expect(modalRegion).toContain('href="/privacy"');
    expect(modalRegion).toContain('href="/terms"');
  });

  it("약관과 처리방침이 같은 사실을 적고 있다", () => {
    const terms = source("src/app/terms/page.tsx");
    const privacy = source("src/app/privacy/page.tsx");

    for (const anchor of ACCOUNT_DELETION_POLICY_ANCHORS) {
      expect(terms, `약관에 "${anchor}" 가 없다`).toContain(anchor);
      expect(privacy, `처리방침에 "${anchor}" 가 없다`).toContain(anchor);
    }
  });

  // ⚠️ 이 테스트의 이름은 "문서가 **여전히** 설정 페이지를 탈퇴 경로로 안내한다"
  // 였고, 본문은 그 문장이 소스에 있는지만 봤다. 그런데 접수 스위치가 꺼져 있으면
  // 제출은 503 이고 앱은 고객센터 주소(CONTACT.email)를 돌려준다
  // (api/auth/delete/route.ts:41-49). **테스트가 거짓 문장을 붙잡아 두고 있었고,
  // 심지어 주석에 "그 경로가 오늘 열려 있는지까지는 아무 자동 검사도 보장하지
  // 않는다"고 스스로 적어 두었다.**
  //
  // 그래서 문장을 고정하는 대신 **문서가 앱이 실제로 여는 창구를 가리키는지**를
  // 양방향으로 본다. 접수를 켜는 릴리스에서는 반대 방향이 자동으로 걸린다.
  it("문서가 앱이 실제로 여는 탈퇴 창구를 가리킨다", () => {
    const privacy = source("src/app/privacy/page.tsx");
    const terms = source("src/app/terms/page.tsx");
    const intakeOpen = process.env.ACCOUNT_DELETION_INTAKE_ENABLED === "true";

    if (intakeOpen) {
      expect(privacy).toContain("설정 페이지");
      expect(terms).toContain("설정 페이지");
      return;
    }

    // 접수가 닫혀 있는 동안 문서가 설정 페이지를 가리키면, 사용자는 눌러도
    // 503 이 나오는 버튼을 찾아다니게 된다.
    expect(privacy).not.toContain("설정 페이지에서 직접 처리할 수 있습니다");
    expect(terms).not.toContain("설정 페이지에서 탈퇴를 신청할 수 있습니다");
    for (const doc of [privacy, terms]) {
      // 이 검사는 **파일 원문**을 읽으므로 상수가 풀린 값을 볼 수 없다. 주소를 축자로
      // 찾으면 두 화면이 상수를 쓰도록 고친 순간 이 검사가 실패한다 — 실제로 그랬다.
      // 그래서 "주소가 적혀 있나"가 아니라 **"한 곳에서 가져오나"**를 본다.
      // 떠도는 주소가 없다는 것은 `contactAddressIsSingleSourced` 가 따로 지킨다.
      expect(doc).toContain("CONTACT.email");
    }
    expect(privacy).toContain("탈퇴는 현재 고객센터");
    expect(terms).toContain("현재는 고객센터");
  });

  it("정책 목록이 스위치에 따라 거짓이 되는 문장을 담지 않는다", () => {
    // "접수하면 바로 처리를 시작해요"가 여기 있었다. 이 목록은 클라이언트가
    // 조건 없이 렌더하는데, 접수가 꺼져 있으면 그 문장은 거짓이 된다.
    // 이 목록은 **무엇이 지워지고 무엇이 남는가**만 말해야 한다.
    const texts = ACCOUNT_DELETION_FACTS.map((fact) => fact.text).join("\n");
    for (const timing of ["바로 처리를 시작", "즉시 삭제", "곧바로 삭제"]) {
      expect(texts, `처리 시점 단정("${timing}")은 스위치에 따라 거짓이 된다`)
        .not.toContain(timing);
    }
    // 사용자가 할 수 없는 일을 지시하지 않는다. 오너가 자기 업체를 내리는
    // 수단이 제품에 없다(오너용 DELETE 라우트도, 화면도 없다).
    expect(texts).not.toContain("먼저 정리해야 탈퇴할 수 있어요");
    expect(texts).toContain("고객센터로 먼저 문의해 주세요");
  });
});

describe("배포 게이트가 사람을 가두는 조합을 막는다", () => {
  const gate = () => source("../../scripts/check-amora-production-env.mjs");

  it("접수만 켜고 워커를 끈 상태를 거부한다", () => {
    expect(gate()).toContain("accountDeletionWorkerFollowsIntake");
    expect(gate()).toMatch(
      /accountDeletionWorkerFollowsIntake:[\s\S]{0,200}ACCOUNT_DELETION_INTAKE_ENABLED !== "true"[\s\S]{0,120}ACCOUNT_DELETION_CRON_ENABLED === "true"/u,
    );
  });

  it("두 플래그 모두 상태를 명시해야 한다", () => {
    expect(gate()).toContain("accountDeletionIntakeStateExplicit");
    expect(gate()).toContain("accountDeletionWorkerStateExplicit");
    // 예전의 "무조건 false" 검사는 남아 있으면 안 된다 — 남아 있으면
    // 켤 수 없으면서 문서만 켜졌다고 말하는 상태로 되돌아간다.
    expect(gate()).not.toContain("accountDeletionIntakeDisabledForExpandDeploy");
    expect(gate()).not.toContain("accountDeletionWorkerDisabledForExpandDeploy");
  });
});
