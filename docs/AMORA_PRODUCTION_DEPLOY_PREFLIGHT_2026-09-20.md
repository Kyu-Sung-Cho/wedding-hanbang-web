# 아모라 운영 배포 사전 점검 — BLOCKED

확인 시각: 2026-09-20 23:27 KST. 이번 요청은 기존 GitHub/Vercel/Supabase를 사용한 `hanbang.ai` 운영 배포다. 새 프로젝트·유료 플랜 변경은 범위 밖이다.

## 결론

배포만 남은 상태가 아니다. 이번 점검에서는 커밋·push·PR 생성·merge·Vercel 배포·원격 DB 변경을 실행하지 않았다. 제품 소스도 변경하지 않았다. 기존 수정분은 작업 폴더에 보존했다.

`land-and-deploy`의 PR 부재 및 CI 실패 중단 조건에 따라 운영 반영을 중단했다. 테스트 통과, Vercel 빌드 성공, 운영 출시 허용을 서로 구분한다.

## 이번에 직접 확인한 사실 (E)

- 작업 폴더: `C:/Users/kcho1/.codex/worktrees/claude-update-audit-20260919/wedding`.
- 작업 브랜치: `codex/amora-feedback-fixes-20260919`, HEAD `c676609dd7b0b9e16ecd7273efdeb81e49550518`.
- `gh auth status`: 기존 GitHub 계정 인증 정상. 이 브랜치의 PR은 없다.
- `git fetch --prune origin` 후 `origin/main`은 `969f6f5ab8c67d1e0f19025063a9c4fafd767efd`. `git rev-list --left-right --count HEAD...origin/main` 결과는 `0 12`다. 로컬 미커밋 변경은 이 수치에 포함되지 않는다.
- 최신 main은 준비 스타일 기능과 전용 `--preparation-style` DB 릴리스 절차를 추가했다. 이 절차는 정확히 237개 SQL만 허용한다.
- 최신 main의 `20260920120000_wedding_preparation_style.sql`과 로컬의 `20260920120000_amora_approved_decision_records.sql`은 동일한 migration version `20260920120000`을 사용한다.
- 로컬의 위 결정 저장 SQL 및 `20260920160000_privacy_confirmation_targets.sql`에는 등록된 후속 릴리스 실행 경로가 없다.
- 로컬 `corepack pnpm supabase:release:fence`는 `MIGRATION_SET_DRIFT`로 실패했다. 구 기본 경로의 검사다. 로컬의 마지막 등록 경로인 `node scripts/supabase-release-fence.mjs --wedding-code-research-scene-v10`도 `NEW_MIGRATION_NOT_REVIEWED`로 차단했다. 검사 우회·허용 목록 완화는 하지 않았다.
- 최신 main [CI 실행](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/actions/runs/35513607926)의 코드·웹·모바일·정적 계약 검사는 성공했다. `Production Readiness: BLOCKED (Hosted Evidence Required)`와 최종 `Quality Gate`는 실패했다.
- 실패 로그와 해당 실행의 출력은 운영 검증·백업/복구·Storage·finalizer 근거를 요구하는 의도적인 차단을 보여 준다. GitHub Actions 인증/결제 장애나 테스트 실행 불능으로 해석하지 않는다. 이 로그만으로 모든 외부 증거가 실제로 존재하지 않는다고 단정하지도 않는다.
- 최신 main SHA의 GitHub commit status에는 Vercel `success`가 있다. 이것은 이번 아모라 미커밋 수정의 배포나 `hanbang.ai` 도메인 연결을 증명하지 않는다. 이 점검에서는 실제 도메인의 배포 SHA를 확인하지 않았다.

## 원문 기록과 직접 운영 확인의 구분

최신 main의 `docs/operations/PREPARATION_STYLE_RELEASE_2026-09-20.md`는 준비 스타일 SQL이 07:04 UTC에 기존 Supabase 프로젝트에 적용되고 별도 readback도 통과했다고 기록한다. 이는 이번에 읽은 저장소 기록이며, 이번 점검에서 원격 DB ledger를 직접 조회한 결과는 아니다.

따라서 이미 적용됐다고 기록된 준비 스타일 migration 원문/번호를 변경해서는 안 된다. 로컬 아모라 SQL이 다른 곳에서 적용된 이력이 없는지 확인한 뒤 아직 미적용인 새 변경의 번호를 조정해야 한다. 원격 ledger의 수동 수정이나 `supabase db push`로 충돌을 우회해서는 안 된다.

## 구버전 앱 영향 (코드 기반 판단)

- TodayOne PUT은 `expectedOwnerId`가 없으면 409를 반환한다. 켜기뿐 아니라 끄기·쉬기도 포함된다. 이전 앱의 동의 해제 경로가 동작하는지 확인 없이 웹/API만 출시하면 안 된다.
- profile 수정도 `expectedOwnerId`를 요구한다.
- 기억 설정/삭제 및 커플 초기화는 `confirmationTarget`을 요구한다. 오래된 앱의 이전 요청 계약과 새 서버 계약을 함께 검증해야 한다.
- 최신 main의 모바일 코드에서도 TodayOne은 `{ mode }`만, 케어 동의 해제는 `{ care_notifications_enabled: false }`만, 커플 초기화는 `{ confirmText: "초기화합니다" }`만 보내는 것을 직접 확인했다. 저장소에 실제로 남아 있는 이전 요청 계약이며 가상의 호환성 우려가 아니다. 실제 설치된 앱 버전 분포는 확인하지 않았다.
- DB만 먼저 적용하는 것도 안전하지 않다. 새 개인정보 SQL은 기존 인자 없는 초기화 RPC를 항상 거절하도록 바꾸고, 기존 기억 동의/삭제 RPC의 service-role 실행 권한을 회수한다. 이전 웹 서버와 새 DB가 공존하는 전환 구간도 검증해야 한다.
- 이 보호 조건을 지우거나 서버에서 현재 계정으로 자동 보충하는 방식은 계정 전환/재연결 안전 장치를 약화시키므로 배포 편의를 위한 해결책으로 사용하지 않는다.
- 최신 main의 준비 스타일 membership/계정 삭제 트리거와 새 privacy reset/결정 저장을 함께 통합한 상태에서 권한·경합·삭제 회귀 검증이 필요하다.

## 안전한 다음 작업

1. 기존 dirty 작업을 보존하면서 최신 main을 통합한다. 양쪽에서 수정된 package 스크립트·release fixture·build fence 검사를 함께 검토한다.
2. 원격 이력을 읽기 전용으로 확인하고 새 아모라 migration 번호 충돌을 해소한다. 이미 적용된 SQL은 변경하지 않는다.
3. 최신 237개 원문을 보존하면서 새 두 SQL만 포함하는 전용 후속 릴리스 계약/실행기/기대 catalog 및 검증을 구현한다. 단순한 개수/해시 변경을 검토 완료로 취급하지 않는다.
4. 지원 모바일 버전·업데이트 안내·기존 동의 해제 경로를 결정하고 구버전/신버전 조합을 검증한다. Vercel 배포는 모바일 설치본을 업데이트하지 않는다.
5. 통합 commit 기준 전체 회귀 및 대상 DB 권한·두 계정 동작 검증을 다시 실행한다. 기존 로컬 성공을 새 통합본의 성공으로 재사용하지 않는다.
6. 기존 프로젝트와 검토 commit에 결합된 운영 확인·필요한 복구/차단 근거를 확보한 후 승인된 controller 경로로만 적용한다. 실패 시 불명확한 변경을 자동 재시도하지 않는다.
7. PR/필수 검사/실제 운영 DB readback을 통과한 뒤 Vercel 운영 반영과 `hanbang.ai` 배포 식별·주요 사용자 흐름을 확인한다.

## 이전 검증의 적용 범위

[후속 수정 보고서](AMORA_POST_FIX_REPAIR_2026-09-20.md)의 로컬 전체 검증은 기존 HEAD와 그때 고정한 미커밋 소스에 대한 결과다. 이번에 발견한 최신 main 통합본·새 DB 릴리스 실행기·운영 환경에 대한 검증은 아니다. 이번 배포 점검에서는 전체 테스트를 다시 실행하지 않았다.

이 문서는 배포 차단 원인과 다음 작업 기록이며 배포 완료 선언이 아니다.
