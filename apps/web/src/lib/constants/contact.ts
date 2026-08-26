// 연락처는 이제 `packages/shared` 에 있다 — 모바일도 같은 값을 써야 하기 때문이다.
// 이 파일은 웹의 기존 import 경로(`@/lib/constants/contact`)를 유지하기 위한 재수출이다.
//
// 왜 옮겼나: 2026-08-22 에 웹의 여덟 자리를 상수로 모았는데 모바일은 안 따라와서,
// 모바일 동의 화면이 메일을 받지 않는 `support@hanbang.ai` 를 계속 안내하고 있었다.
export { CONTACT } from "@hanbang/shared/constants";
