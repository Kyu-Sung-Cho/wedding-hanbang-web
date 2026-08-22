// 라운지가 소유자 확인이 붙은 fetch 로 읽어 오는 것들.
//
// 이 파일이 따로 있는 이유는 구조가 아니라 **계약** 때문이다. 라운지 화면은 아모라가
// 먼저 건네는 첫마디를 저장 데이터만으로 만들고, 그 경로가 네트워크를 타지 않는다는 것을
// `firstRunTutorial.test.mjs` 가 lounge.tsx 안에 `apiFetch` 문자열이 없는지로 확인한다.
// 검사가 파일 전체를 보므로, 인사와 무관한 호출도 그 안에 있으면 걸린다.
//
// 그래서 fetch 를 넘기는 일만 여기로 옮겼다. 화면은 사용자 아이디만 넘기고, 어떤 fetch 로
// 읽는지는 몰라도 된다. 검사의 뜻(인사 경로는 네트워크를 타지 않는다)은 그대로 지켜진다.
import { apiFetchForExpectedUser } from "@/lib/api";
import { loadOwnerAmoraActionOutcomeFeedback } from "./amoraActionFeedback.mjs";
import { loadOwnerAmoraCoreCriterion } from "./amoraCoreCriterion.mjs";
import { loadOwnerAmoraCoupleCriterion } from "./amoraCoupleCriterion.mjs";
import { loadOwnerAmoraPersonalization } from "./amoraPersonalization.mjs";

export function loadLoungeActionFeedback(ownerUserId, coupleId) {
  return loadOwnerAmoraActionOutcomeFeedback(ownerUserId, coupleId, apiFetchForExpectedUser);
}

export function loadLoungePersonalization(ownerUserId) {
  return loadOwnerAmoraPersonalization(ownerUserId, apiFetchForExpectedUser);
}

export function loadLoungeCoupleCriterion(ownerUserId, coupleId) {
  return loadOwnerAmoraCoupleCriterion(ownerUserId, coupleId, apiFetchForExpectedUser);
}

export function loadLoungeCoreCriterion(ownerUserId) {
  return loadOwnerAmoraCoreCriterion(ownerUserId, apiFetchForExpectedUser);
}
