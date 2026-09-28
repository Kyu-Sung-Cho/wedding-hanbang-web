# W12 탈퇴 처리 재개 점검 — 2026-09-28

범위는 기존 웹 출시 목록의 W12다. 정식 출시 또는 실제 탈퇴 완료 기록이 아니다.

## 확인한 문제와 수정

### 지원 사건이 100개 이력에서 진행 불가

E: 기존 `supportCase.ts`는 이력을 100개로 제한하고 process마다 실행 전·후 두 기록을 추가했다. 로컬 합성 실행에서 49번째 처리 후 `process-unverified`/100개로 남았으며 inspect도 기록을 더하지 못했다. 암호화 store에도 별도의 파일 100개 제한이 있었다.

수정은 사건 v2에 누적 개수와 보관 이력의 digest를 추가한다. 활성 상태에는 최초 prepared 기록과 최근 99개를 유지한다. 생략된 원문은 기존 append-only 암호화 파일에 그대로 남고, store는 모든 파일의 순번·이전 암호문 hash·정확한 한 이벤트 전이를 검증한다. v1 원장을 덮어쓰지 않으며 100개에서 다음 v2 기록으로 이어간다. v2 기록 이후 옛 실행기로 되돌리면 읽을 수 없으므로 같은 변경의 실행기와 검증 모듈을 함께 사용한다.

파일 개수 100개 제한을 제거하되 파일명 연속성, 안전 정수, 원문 256 KiB 미만·암호문 384 KiB 미만 제한은 유지한다. 선기록 실패 시 worker를 실행하지 않고, 응답 유실 시 기존 사건 inspect를 먼저 요구한다. 사용자·작업 소유자와 탈퇴 완료 판단은 바꾸지 않는다.

Windows Node 24.15.0에서 `tsx`의 ESM namespaced import가 중첩 TypeScript 경로를 찾지 못하는 것도 실행으로 확인했다. 같은 저장소에 쓰인 `tsx/cjs/api`로 지원 실행기와 store의 타입스크립트 로딩을 통일했다. CLI 도움말과 worker 모듈 로딩은 실제 성공했으며 worker import의 네트워크 호출은 0회였다.

### 중단된 시험 도구의 혼합 저장

E: 09-14 fixture 결과는 `plan-request/WRITE_FAILED`에서 중단했고 실제 탈퇴는 실행하지 않았다. 과거 HTTP status/body는 보존되지 않아 당시 응답을 단정할 수 없다. 원래 fixture와 같은 구조의 예산·체크리스트·일정 혼합 changes를 현행 정책 SQL을 로드한 PGlite에 직접 제출하여 `COUPLE_PLAN_CHANGE_UNSUPPORTED_MIXED_DELTA`를 재현했다. 시험의 eventId·날짜·문구는 새 합성 값이다.

로컬 SQL 계층에서 예산 → 체크리스트 → 일정 순서로 매번 최신 revision을 읽어 별도 요청하면 revision 0→1→2→3으로 반영된다. 현행 정책의 required_count는 1이며, 항상 상대 승인 2명을 요구하는 옛 fixture mock은 현재 계약이 아니다. 각 변경의 결정·상대 알림은 하나씩 생기고 동일 요청 재전송은 추가 반영하지 않는다. 오래된 revision은 준비 데이터를 보존하며 stale 감사 영수증을 남긴다. 이 시험은 surface를 직접 지정하며 실제 HTTP route의 파싱·surface 계산·응답 및 기존 pair 재개를 검증한 것은 아니다.

제품 SQL의 혼합 변경 가드는 유지했다. 이번 변경은 실제 SQL 회귀를 추가했으며 옛 외부 fixture를 그대로 다시 실행하는 재개기는 만들지 않았다.

## 실제 조회와 검증 범위

2026-09-28 02:34:37 UTC에 운영 프로젝트 `slrtobkksjmxgzatjyqb`의 기존 합성 A/B만 READ ONLY/REPEATABLE READ 트랜잭션으로 조회하고 ROLLBACK했다. 알려진 subject SHA256, 서버 canary UUID 태그, 시험 이메일 일치, 상호 couple/profile 역할을 모두 대조했다. 원문·이메일·subject·토큰은 결과에 출력하지 않았다.

- 합성 A/B 각각 정확히 1개, 같은 pair 확인.
- journey 1개, revision 0, total_budget 0/progress 빈 객체.
- 해당 두 사람의 pair 계획 요청 0개(pending/applied/applying/terminal 모두 0).
- 원격 쓰기·삭제·새 계정 생성 0회.

이는 현재 관측 시점의 상태다. 과거 HTTP 결과, 과거 부작용 없음, 이후 무조건 재시도 가능을 뜻하지 않는다. 일반 active 목록은 일부 surface와 pending만 반환하고, 개별 status GET의 RPC는 stale 변경을 할 수 있어 이 관측에 사용하지 않았다.

근거 SQL·집계: 로컬 `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/w12-pair-observation.sql` 및 `w12-pair-observation.json`. 보호된 기존 capsule은 열거나 수정하지 않았다.

## 검증

- supportCase 신규 회귀의 RED 재현 후 기존·신규 29개 PASS.
- 실제 현재 SQL 계약 파일 전체 52개 PASS. 최종 assertion 보강 후 신규 3개 별도 PASS.
- Windows DPAPI 실제 암호화·재열기·중복 실행 잠금·변조 거절 PASS.
- 같은 journal 구현에서 합성 암호 codec으로 v1 100개 → 600회 process → 1,301개 원본 기록 보존·재열기 PASS. 중간 파일 누락/변조·위조 digest/subject 거절 PASS.
- 웹 typecheck 및 변경 TS 파일 ESLint PASS. 지원 사건·worker·Storage saga·본인 확인 proof 통합 4파일 73개 PASS. 전체 push 전 검사 결과는 PR의 실제 실행 증거로 추가한다.

검증 한계: 1,301개 실제 DPAPI 기록의 처리 시간은 측정하지 않았다. 재열기는 모든 파일을 검증하므로 시간이 기록 수에 비례한다. 합성 codec 성능을 실제 DPAPI 성능으로 표현하지 않는다.

## 남은 종료 조건

기존 두 계정의 정상 세션 승계, 최신 clean source/운영 commit 및 플래그 관측, 정확한 계획·revision·기존 checkpoint 대조를 마친 뒤 계획 변경 단계만 별도로 재개해야 한다. 동의·가입·채팅·사진을 반복 생성하지 않는다. 이어 새 baseline을 잡고 기존 지원 사건으로 A 탈퇴 후 B의 개인/공유 기록 보존을 확인하며, B 정리는 별도 정확 대상으로 수행한다.

외부의 역사 실행기 `w12-pair-boundary.mjs`와 `w12-final-pair-read.mjs`는 v1 사건만 허용한다. 이 파일을 덮어쓰거나 v2 사건의 이름만 v1로 바꾸지 않는다. 실제 재개 전 새 source에 고정한 successor가 v2 전체 원장 검증을 사용하도록 갱신하고 별도 검증해야 한다. 이번 PR은 그 외부 재개 실행기까지 완성한 것으로 표시하지 않는다.

실제 삭제는 대상·권한·복원 조건을 확정한 실행 단계에 남아 있다. 자동 intake/cron 플래그, 마이그레이션, 고객 데이터, 운영 배포는 이번 변경에서 바꾸지 않았다. W13 전체 원본 복원과 W15 남은 실기기 확인도 이번 로컬 검증으로 완료 처리하지 않는다.
