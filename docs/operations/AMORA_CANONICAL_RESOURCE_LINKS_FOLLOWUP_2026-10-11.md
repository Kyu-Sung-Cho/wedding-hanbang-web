# 운영 자연질문에서 누락된 제품 자료 링크 보완

기준: 2026-10-11. 상태: LOCAL CANDIDATE / 추가 Production 미검증.

## 재현과 원인

PR496은 정상 CI·병합·Vercel Production Ready·hanbang.ai/WWW health를 통과했고,
운영 SHA는 `da4897ef8023dfe0188ab1d49a7c61f63d0e907c`이다.
그러나 로그인된 테스트 계정의 private 자연질문에서 공시 가격·위약금 자료를
클릭 링크로 요청하자 `hanbang.ai/price`가 일반 글자로 나왔고 위약금 주소가 없다고
답했다. 이 실제 실패를 완료로 숨기지 않고 작은 후속 패치로 보완한다.

같은 계정에서 정확한 `/price`, `/wedding/manners` 경로를 제공하면 자료명 링크가
표시되고 `/price` 클릭은 같은 탭에서 실제 가격 페이지(829 표시)를 연다.
즉 URL 렌더링과 제품 자료의 주소·범위 공급은 서로 다른 검증이다.

읽기 전용 독립 감사: 질문은 W0로 정상 분류되고 private/no-tool 48k·25k 최종
프롬프트에도 링크 규칙은 남아 있다. 그러나 완전한 가격 URL과 위약금 원문 위치는
없다. shared의 저장된 preparation reference도 이 private 자연질문에는 적용되지
않는다. 길이 절단이나 렌더러를 추측하지 않고 실제 누락된 목적지 정보를 수정한다.

## 대안과 선택

- bare 도메인 전체를 HTTPS로 추측해 링크화: 위험한 입력·코드 예시까지 활성화하거나
  주소를 만들 수 있어 선택하지 않았다. URL 허용 경계는 유지한다(P1·P3).
- 단순 단어 매칭으로 고정 답변: 질문의 역할·맥락을 우회할 수 있어 선택하지 않았다.
- 보호된 Source Citation의 확인된 제품 경로: `/price`·`/wedding/manners`와 자료 범위를
  제공하고 실제 자연질문으로 검증한다. 이 최소 범위를 선택했다(P2·P4·P5·P6).

## 변경 범위

`prompts.ts`에서 기존 bare 제품 주소를 실제 자료명 HTTPS 링크로 바꾸고,
Source Citation에 가격·위약금 안내의 시작점, 카테고리→업체→계약 전 확인의 열람
방식, 공시된 원문이 있을 때만 제공된다는 한계를 넣는다. 예절 가이드도 실제
서비스 경로를 제공한다. URL 제공은 지금 본문 열람·조건 검증·계약 판정이 아니며,
관련 위치 질문에만 링크를 사용하고 무관한 추천·저장을 추가하지 않는다.

공유 URL parser·웹/native renderer·권한·DB·환경·의존성은 변경하지 않는다.
이전 dirty branch/HOLD 작업도 포함하지 않는다.

## 직접 검증

- 다섯 shared/private/demo 및 48k/25k 실제 최종 프롬프트 사례를 먼저 RED로 재현:
  5fail/7pass. 수정 후 같은12개 PASS.
- 링크·프롬프트 조립·길이 절단·도구 필터 관련6files/87tests PASS.
- 보호 카탈로그에서 가격 URL만 빼고 legacy 안내는 남기는 mutant를 검사1/1이 잡았다.
  provided prove-guard가 원본 bytes/md5 복구를 확인했다.
- `git diff --check` PASS.
- 정상 pre-push·새 PR 필수 CI·exact-head Preview·운영 병합·Production Ready·
  로그인된 실제 자연질문/클릭/새로고침 검증은 뒤이어 수행한다. 아직 PASS로 세지 않는다.

첫 릴리스의 원격 테스트22509/native1417/shared141과 기존 dependency alerts11은
별도 기록이다. 추가 패치의 완료는 새 커밋·새 CI·운영 응답 증거로 구분해 기록한다.
