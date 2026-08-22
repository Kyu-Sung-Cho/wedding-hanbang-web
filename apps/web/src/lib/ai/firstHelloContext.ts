import { buildAmoraFirstHello, readPreparationStage } from "@hanbang/shared";

/**
 * 아모라의 첫마디를 **모델이 볼 수 있게** 만드는 자리.
 *
 * ## 무엇이 문제였나
 *
 * 첫 실행 안내가 끝나면 아모라가 먼저 말을 건다. 그 첫마디는 모델이 쓰지 않고
 * 온보딩 입력만으로 결정적으로 만들어지며(`buildAmoraFirstHello`), 화면에만 존재한다 —
 * `chat_messages`에 저장되지 않는다.
 *
 * 그래서 사람이 그 인사를 읽고 "그래"라고만 답하면, 모델은 인사를 본 적이 없는 채로
 * "그래" 한 마디만 받는다. 대화의 첫 번째 턴이 곧바로 어긋난다. 아모라가 중심인
 * 제품에서 이건 작은 흠이 아니다.
 *
 * ## 왜 DB에 쓰지 않았나
 *
 * AI 메시지를 넣는 정식 경로는 `insert_amora_care_message`인데, 그 RPC는 **양쪽 파트너가
 * 아웃바운드 케어에 명시 동의**해야 삽입한다. 갓 가입한 커플은 동의가 없으니 NULL이
 * 돌아온다. 그 동의 게이트를 우회하는 새 경로를 만드는 것은 개인정보 경계에 관한
 * 제품 결정이라 코드 편의로 처리할 일이 아니다.
 *
 * ## 그래서 서버가 다시 만든다
 *
 * 이 턴의 프롬프트 맥락에만, 서버가 **스스로** 같은 첫마디를 만들어 맨 앞에 놓는다.
 * 클라이언트가 보낸 assistant 이력은 이 저장소가 원칙적으로 신뢰하지 않으므로
 * (route.ts의 canonical 규칙) 클라이언트에게 받지 않고 커플 자신의 여정 데이터에서
 * 계산한다. 저장하지 않으니 기록을 오염시키지도 않는다.
 *
 * ## 언제만 놓는가
 *
 * - 그 사람이 **실제로 첫마디를 본** 경우에만. 판정 기준은 안내 완료 기록이다.
 * - 아직 아모라 메시지가 **하나도 없는** 대화에만. 진짜 이력이 생기면 저절로 멈춘다.
 *
 * 둘 중 하나라도 아니면 아무것도 하지 않는다 — 보지도 않은 인사를 모델이 언급하는 편이
 * 맥락이 조금 빈 것보다 나쁘다.
 */

export interface FirstHelloContextInput {
  /** DB에서 온 정본 대화. 여기에 assistant가 하나라도 있으면 놓지 않는다. */
  canonicalMessages: ReadonlyArray<{ role: "user" | "assistant"; content: string }>;
  /** `profiles.first_run_tutorial_completed_at`. 컬럼이 없거나 안 봤으면 null. */
  tutorialCompletedAt: string | null;
  weddingDate: string | null;
  /** `couples.progress` JSONB 원본. 단계는 여기서 읽는다. */
  progress: unknown;
  /**
   * 화면의 첫마디는 파트너가 없으면 초대 한 줄을 덧붙인다. 채팅 라우트에는 커플 구성원
   * 정보가 없어서 여기서는 생략할 수 있게 뒀다 — 그 줄은 사실이 아니라 권유라, 모델
   * 맥락에서 빠져도 어긋나는 사실이 없다.
   */
  partnerLinked?: boolean;
  now: number;
}

export function buildFirstHelloContextTurn(
  input: FirstHelloContextInput,
): { role: "assistant"; content: string } | null {
  if (!input.tutorialCompletedAt) return null;
  if (input.canonicalMessages.some((message) => message.role === "assistant")) {
    return null;
  }

  const hello = buildAmoraFirstHello({
    weddingDate: input.weddingDate,
    preparationStage: readPreparationStage(input.progress),
    partnerLinked: input.partnerLinked,
    now: input.now,
  });

  return { role: "assistant", content: hello.body };
}
