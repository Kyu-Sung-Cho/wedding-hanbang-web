// @vitest-environment node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACCOUNT_DELETION_FACTS,
  ACCOUNT_DELETION_POLICY_ANCHORS,
} from "@/constants/accountDeletionPolicy";

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

  it("문서가 여전히 설정 페이지를 탈퇴 경로로 안내한다", () => {
    // 이 문장이 참이려면 접수 API 가 실제로 열려 있어야 한다. 그 조건은
    // scripts/check-amora-production-env.mjs 의
    // accountDeletionWorkerFollowsIntake 가 배포 시점에 검사한다.
    const privacy = source("src/app/privacy/page.tsx");
    const terms = source("src/app/terms/page.tsx");
    expect(privacy).toContain("설정 페이지에서 직접 처리할 수 있습니다");
    expect(terms).toContain("설정 페이지에서 탈퇴를 신청할 수 있습니다");
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
