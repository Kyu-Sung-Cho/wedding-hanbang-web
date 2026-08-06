import { createHash } from "node:crypto";

/**
 * 선제 케어 메시지의 동일성 — 언제 같은 말이고 언제 다른 말인가.
 *
 * ## 무엇이 잘못돼 있었나
 *
 * 중복 방지 키에 시간 버킷이 들어 있었다.
 *
 *   lifecycleBucket = floor(now / 6시간)
 *   digest = sha256(coupleId + actionId + lifecycleBucket)
 *
 * 그래서 6시간마다 새 키가 되고, 내용이 한 글자도 바뀌지 않았는데 같은 메시지가 다시
 * 나갔다. 무기한으로. 문서 §15의 "같은 내용은 상태가 바뀌기 전 반복하지 않는다"와
 * 정면으로 어긋나고, "알림을 무시해도 죄책감을 만들지 않는다"도 깨진다.
 *
 * ## 왜 본문을 해시하지 않는가
 *
 * 본문에는 "확인 시점까지 30일 남았어요" 같은 날짜 숫자가 들어간다. 본문을 해시하면
 * 숫자가 줄어드는 매일이 '새 내용'이 되어, 6시간마다가 매일로 바뀔 뿐이다.
 *
 * 날짜가 하루 줄어드는 것은 상태 변화가 아니다. 같은 항목이 여전히 남아 있다는 뜻일
 * 뿐이다. 진짜 상태는 `primaryAction.id`가 담는다 — 어떤 항목인지와 얼마나 급한지
 * (`category_${key}_${severity}`). 그래서 항목이 바뀌거나 심각도가 올라갈 때만 다시
 * 말하고, 그 사이에는 조용하다.
 *
 * 문서의 표현을 그대로 쓰면 — 아모라가 정말 잘 케어하고 있다면 중요하지 않은 날에는
 * 조용할 수 있어야 한다.
 *
 * ## 사용자가 놓치면 어떡하나
 *
 * 놓쳐도 다시 밀어붙이지 않는다. 마감이 가까워지면 심각도가 올라가 id가 바뀌고 그때
 * 한 번 더 말한다. 같은 급함으로 같은 말을 반복하는 것은 케어가 아니라 재촉이다.
 */
export function buildLifecycleCareDigest(
  coupleId: string,
  primaryActionId: string,
): string {
  return createHash("sha256")
    .update(coupleId)
    .update("\0")
    .update(primaryActionId)
    .digest("hex");
}
