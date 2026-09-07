import { createHash } from "node:crypto";

/** 인증·커플·공개 범위와 DB에서 읽은 화면 정리 커서로만 호출한다. */
export function buildAmoraInitialGreetingRequestKey(input: {
  actorId: string;
  coupleId: string;
  visibility: "shared" | "bride_private" | "groom_private";
  resetAt: string | null;
}): string {
  if (input.resetAt === null) return `greeting:${input.actorId}`;

  // greeting:<actor> 접미사는 기존 RPC가 거부한다. 이미 허용된 lifecycle
  // 계약을 쓰고, 선제 돌봄의 digest와 섞이지 않도록 용도를 해시에 포함한다.
  const digest = createHash("sha256").update(JSON.stringify([
    "amora-initial-greeting-view-reset-v1",
    input.coupleId,
    input.actorId,
    input.visibility,
    input.resetAt,
  ])).digest("hex");
  return `lifecycle:${digest}`;
}
