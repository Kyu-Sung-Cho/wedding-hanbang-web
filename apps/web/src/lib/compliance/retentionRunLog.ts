import { randomUUID } from "node:crypto";
import { log } from "@/utils/log";

export type RetentionRunStep = "client" | "ai_interactions" | "admin_access" | "wedding_code_research";

type RetentionRunEvent = {
  status: "started" | "disabled" | "completed" | "failed" | "partial";
  failedStep?: RetentionRunStep;
  redacted?: number;
  purgedAdminAccess?: number;
  purgedWeddingCodeResearch?: number;
};

/** 운영 info 로거는 비활성이라, 고객 원문 없는 고정 필드만 별도로 기록한다. */
export function createRetentionRunLog(enabled: boolean): (event: RetentionRunEvent) => void {
  try {
    const runId = randomUUID();
    const deployment = process.env.VERCEL_DEPLOYMENT_ID;
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    const deploymentId = deployment && /^dpl_[a-zA-Z0-9]{1,80}$/.test(deployment) ? deployment : null;
    const commit = sha && /^[a-fA-F0-9]{40}$/.test(sha) ? sha : null;

    return (event) => {
      try {
        // 요청 헤더/URL, SDK 예외, DB 응답 원문은 이 경로로 받지 않는다.
        console.log(JSON.stringify({
          event: "ai_log_retention_run",
          version: 1,
          runId,
          occurredAt: new Date().toISOString(),
          deploymentId,
          commit,
          enabled,
          status: event.status,
          failedStep: event.failedStep ?? null,
          redacted: event.redacted ?? null,
          purgedAdminAccess: event.purgedAdminAccess ?? null,
          purgedWeddingCodeResearch: event.purgedWeddingCodeResearch ?? null,
        }));
      } catch {
        // 관측 실패 때문에 이미 처리한 파기를 재시도하거나 응답을 바꾸지 않는다.
      }
      if (event.status === "failed" || event.status === "partial") {
        try {
          // JSON 출력이 실패해도 별도의 오류 알림 경로는 시도한다.
          log.error("api/cron/ai-log-retention", new Error(`Retention run failed at ${event.failedStep}`));
        } catch {
          // 알림 장애도 파기 결과를 바꾸지 않는다.
        }
      }
    };
  } catch {
    return () => {};
  }
}
