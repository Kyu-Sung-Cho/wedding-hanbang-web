# 아모라 클릭 가능한 안내 링크 — 분리 릴리스

기준일: 2026-10-11 (Asia/Seoul)

상태: LOCAL CANDIDATE / REMOTE CI·PREVIEW·PRODUCTION 미검증.
사용자 요청: 자료·사이트 이름만 알려주지 말고 바로 열 수 있는 링크로 안내하고,
GitHub와 Vercel을 통해 hanbang.ai까지 배포한다.

## 기준과 범위

- 운영 기준 SHA: `143449c84fd4c7910a7883348301c2377a8e502e`.
- 분리 브랜치: `codex/amora-reference-links-20261011`.
- 작업 폴더: `amora-reference-links-20261011/wedding`.
- 2026-10-11T11:36:55Z `/api/health` 직접 확인: ok=true, database=up,
  commit=`143449c84fd4`. 이 결과는 새 후보의 배포 증거가 아니다.
- 원래 `amora-team-feedback-20261004`의 사용자 변경은 그대로 보존한다.

포함: 공유 URL 형식 검사·링크 토큰화, 웹 답변 렌더링, 출처 안내 프롬프트,
모바일 답변 렌더링과 대응 테스트. 새 의존성 없이 shared export 한 줄 추가.

제외: DB 마이그레이션 241/242, CAS·삭제 API와 릴리스 계약, ChatBubble의 저장·오류·
말풍선 변경, 장소 검색 변경, 기능 플래그, 의존성·lockfile, 다른 미완료 작업.
기존 Production 환경·권한·Supabase 프로젝트를 변경하지 않는다.

## 사용자 동작과 한계

- 제공된 HTTPS 주소와 서비스 내부 경로는 자료명 링크로 표시한다.
- 주소만 있는 기존 AI 안내도 클릭할 수 있다. 내부 경로는 같은 탭에서,
  외부 주소는 새 탭에서 열며 opener/referrer를 분리한다.
- 코드·이미지·위험한 scheme·credential URL·내부 API/Auth/Admin 주소·불완전 링크는
  실행 링크로 만들지 않는다. 원문을 보존하고 자동 접속·이미지 요청을 하지 않는다.
- 주소 제공은 사실 검증이나 공식 출처 인증이 아니다. 모델에 주소를 만들지 말고,
  주소가 없으면 확인되지 않았다고 말하도록 지시한다.
- 모바일 내부 주소는 설정된 서비스 웹사이트로 이동하므로 웹 로그인이 필요할 수 있다.
- Vercel 배포는 웹/API 배포다. Expo export는 앱스토어·설치 앱 업데이트 증거가 아니다.
- 프롬프트·합성 테스트만으로 모든 실제 모델 답변의 준수를 보장하지 않는다.

## 이번 분리 후보의 직접 검증

- frozen-lockfile 설치 PASS. main의 Next 16.3.8·lockfile 유지.
- 수정 전 동일한 웹 링크·프롬프트 31개 중 17 실패, 14 통과 (RED).
- 수정 후 동일한 31개 모두 통과, 실패 0 (GREEN).
- `git diff --check` PASS. d.mts CRLF 변환 안내는 오류가 아니다.
- 독립 검수가 main 기준 12개 구현/테스트 파일의 이전 작업 혼입 부재를 확인했다.
- 추가 검수로 quote/list 블록 분리, oversized label, 연쇄 불완전 링크,
  중간 빈 줄, nested 이미지 label의 표 구분 문자, 모바일 URL의 표 구분 문자
  경계를 재현했다. 각 실패 입력을 먼저 RED로 확인하고 GREEN으로 닫았다.
- 최종 관련 검증: 웹 123 PASS(링크 36 + 프롬프트 구성 87),
  shared 7 + 모바일 21 = 28 PASS. 세 패키지 타입 검사·변경 파일 ESLint PASS.
- 새 테스트의 행동 감지 검증 4/4 PASS: credential 허용, 외부 rel 제거,
  출처 프롬프트 형식 제거, 모바일 링크 토큰 제거를 각각 심으면 검사가 실패한다.
  provided prove-guard 스크립트가 원본 bytes/md5 복구를 확인했다.
- 공통 저장소 검사 1,572 PASS/0 fail. ingest 858 PASS/4 skip/0 fail.
  공통 DB 검사는 로컬 합성 fixture이며 기존 운영 DB 실행 증거가 아니다.
- 초기 전체 Turbo 실행은 후보 수정으로 무효화되어 중단했다. PASS로 세지 않는다.
- 수정 전 진단 웹 build·Expo all export는 성공했으나 최종 증거로 승계하지 않는다.
- 최종 코드의 전체 typecheck·lint·test, 정상 웹 build, Expo all export: 진행 중.
- PR의 필수 CI·exact-head Preview·merge SHA·Production build·별칭·운영 smoke:
  아직 확인하지 않았으며 배포 완료로 보고하지 않는다.

최종 코드 고정 시점의 SHA256:

- shared parser: `3c8e22ab865ab8eedfed7a3401ef9ebb21aab6197ed29149c3d6aef0d792a831`
- web renderer: `0973ce56a7738d53f70988d88d6fb113b457a995fc3ed4b16cc96f1ba4ab33aa`
- source prompt: `ff52ff37ebcb1c81f4fb76e584461531feecdb2bff3f4aa1dcd221a309825fa9`
- mobile parser: `7e4bbf6568cb01a6549f2ea45fb322c9809db63ad84b86cb4d0491578a90d968`

## 배포 및 복구 계약

정상 로컬 gate → PR → 필수 Code Quality와 관련 잡 → exact-head Preview 확인 →
정상 main 병합 → Vercel Production Ready·hanbang.ai 별칭·동일 merge SHA의 health →
운영 읽기 smoke 순서다. 검사·브랜치 보호·Production fence를 우회하지 않는다.
dispatch-only Production Readiness/Quality Gate의 SKIPPED는 PASS가 아니다.

이번 변경은 DB·Storage 쓰기 계약을 바꾸지 않는다. 회귀가 확인되면 해당 릴리스
커밋만 정상 revert PR로 되돌리고 원래 운영 기준과 기존 데이터를 유지한다.
강제 push·reset·사용자 변경 삭제·DB 복원은 하지 않는다.
최종 결과는 검증 완료 후 별도 완료 기록으로 추가한다.
