# WeddingCode v4.2 웹 배포 기록

## 승인과 범위

2026-10-06 사용자가 기존 웨딩코드 개선 작업에 대해 “그리고 배포까지해”라고 요청했다. 운영 `main` 위의 웨딩코드 웹 변경만 PR로 반영한다. 문항판, 결과 근거, 응답 방향 빈도, 개인·커플 결과, 로그인 없는 링크 초대·반환, 개인정보 고지 및 관련 검사를 포함한다.

DB migration, Storage 정책, 운영 환경변수, AI 모델·대화 저장, 모바일 릴리스를 변경하지 않는다. 일반 웹 UI 배포 범위의 근거는 `docs/operations/PLANNER_HTML_DESIGN_2026-09-11.md`의 「후속 웹 배포 범위」다. 전체 서비스의 hosted 출시 증거를 이 UI 배포로 대신하지 않는다.

기본 입구를 v4.2로 여는 것은 사용자의 즉시 공개 요청을 따른 결정이다. v4 계약 G1의 즉시 입구 교체 대안을 적용하며, 인지면접·재검사 관문이 통과했다는 뜻이 아니다. 사람 확인 0건 / UNVALIDATED, noindex·사이트맵 제외·과학적 성격 유형 및 궁합 주장 금지를 유지한다.

## 확인한 기준점

- 배포 준비 전 운영 SHA: `f1cf5f0e30e830e2586f64a74b1a206294867077` (#485).
- 기존 운영 Vercel artifact: `dpl_2s7MnWHwvGG4LL9i1p1fTiK25rW7`, target `production`, 상태 `READY`.
- 기존 운영 artifact 주소: `wedding-hanbang-5wc7d42ng-hanbang.vercel.app`.
- 배포 대상 도메인: `https://hanbang.ai/wedding-code`.
- 구현 커밋: `7dddbdde`; 최신 main 병합 커밋: `b11488c4876af4f88a1152ad0fc972becbd32c32`.
- 최신 main 병합은 충돌 없이 완료했으며 main에 독립적으로 추가된 v3.1 캐릭터 및 확인 화면 변경을 보존했다.

## 필수 검수

운영 병합 전에 새 검사의 의미 있는 오류 검출 증명, 전체 로컬 검증, 빌드, 최신 PR Code Quality, Vercel Preview를 확인한다. PR 초록불은 DB·Storage·모바일의 운영 출시 허가가 아니다. CI·보호 규칙·운영 환경변수를 수정해 관문을 우회하지 않는다.

v4 계약의 #473 링크 개인정보 관문은 정제기의 main 포함과 운영 재현을 구분한다. 현재 운영 정제기의 포함과 `beforeSendTransaction` 연결은 다운로드한 운영 자산에서 확인했으나, 이 정적 확인만으로 실제 송신 payload 검사를 통과했다고 기록하지 않는다. 운영 재현 완료 전에는 이 링크 입구를 운영에 병합하지 않는다.

## 실패 대응

배포 실패나 웨딩코드 회귀가 확인되면 이번 UI PR을 revert해 기존 화면으로 복귀한다. 필요하면 위의 기존 운영 artifact를 복귀 대상으로 확인한다. 이번 diff에 DB 변경이 없어 DB schema rollback은 적용하지 않는다. 실제 rollback 실행 여부·새 merge SHA·새 deployment ID·검사 영수증은 확인 후 아래에 추가한다.

## 현재 상태

배포 준비 중. PR 생성·운영 병합·새 운영 배포는 아직 완료하지 않았다. 실제 사람 검증과 OS 공유 앱에서 수신자에게 전달되었는지의 확인도 완료하지 않았다.
