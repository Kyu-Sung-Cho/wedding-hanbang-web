# W12 합성 지원 탈퇴 시험 마감 — 2026-09-28

**판정: `SCOPED_SYNTHETIC_E2E_VERIFIED`. 승인된 합성 A/B의 지원 탈퇴, 시험 자료 삭제와 상대 자료 보존 검증을 완료했다. 전체 고객 자료 삭제·W13 원본 복구·웹 정식 출시 완료는 아니다.**

이 기록은 [실제 마감 원문](C:/Users/kcho1/.codex/visualizations/web-launch-20260928/w12-successor/w12-scoped-closeout.json)과 [운영 검토 기록](C:/Users/kcho1/.codex/visualizations/web-launch-20260928/W12_SCOPE_CLOSURE_ACTUAL.md)을 승계한다. 마감 기록 시각은 `2026-09-28T09:21:21.5992513Z`다. 문서 작성 중에는 공개 증거 파일·해시·검증 코드를 대조했으며 운영 호출, 보호 원문 복호화, 시험 재실행은 하지 않았다.

## 운영 source와 원래 시험의 승계

- [PR468](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/468) 운영 commit: `ae25725b7dd1c3fe2a27e210305f11c753d6ed7b`.
- 검증된 tree: `c813efed50d5d5f18f9d3baacff09939ef14dcf1`. Vercel `dpl_DgxWjJTMb6666tf7pkmqSTdtQr5u`의 READY·동일 full commit·`hanbang.ai`/`www.hanbang.ai` alias 관측을 저장했다.
- 운영 `account_deletions.user_id`의 기존 NOT NULL이 식별자 없는 감사 기록 삽입을 막았다. `20260928073546_account_deletion_anonymous_audit`의 해당 컬럼 nullability 변경만 전용 경로로 ROLLBACK 예행·적용·독립 조회했다. 기존 ledger는 보존됐고 실제 행 수는 228→229다. 해당 릴리스의 로컬 migration 240개와 혼동하지 않는다.
- 대상은 09-13 UTC fixture에서 만든 기존 두 합성 계정이다. 오늘 새 계정을 만들거나 A를 재생성하지 않았다. 원래 run은 `8304e094-b6d8-46d7-8639-908c81710090`이다.

| 실행 구간 | 실제 source commit |
|---|---|
| 삭제 전 원본 baseline·A 초기 처리 | `4f1570a6bdd022bb06edd48d9ccc36e1346d0aeb` |
| Storage 부재 확인 수정 후 A 재개 | `8ae2a44da66bffa98f1afe1fb110f6ad60167931` |
| SDK 모듈 경계 수정 후 A 재개 | `5631dfea59e08212a93424f7d7069e8281e91b0a` |
| 감사 컬럼 수정 후 A 완료·상대 보존·B 정리·최종 확인 | `ae25725b7dd1c3fe2a27e210305f11c753d6ed7b` |

서로 다른 시점의 source를 하나로 합치지 않는다. 원본 baseline의 source와 bytes를 보존하고, `reviewedBaselineOrigin`으로 마지막 source에 연결했다. 마지막 after-A·B enqueue·final의 source와 tree는 서로 같다.

## 실제 결과

| 경계 | 확인한 결과 |
|---|---|
| A 같은 job 재개 | 기존 `9e39fb21-8a36-45af-be55-0f0cfbb8fae8`을 재개했다. 독립 `inspect-a5-audit-result.json`은 `SCOPE_REVIEW_REQUIRED`이며 제품 job의 완료를 확인했다. |
| A 삭제 후 B 보존 | `after-a-audit2-result.json` PASS. 삭제 전 원본 baseline 대비 22범위에서 B 개인 자료와 공유 준비 자료를 보존했다. A 개인 자료·사진 장부·Storage 목록 부재, B의 사진 재조회 404 및 A 옛 세션 재조회 401·no-store를 확인했다. |
| 보존 확인 후 B 정리 | B enqueue manifest는 위 after-A 결과 SHA를 고정하고, 원래 B 사건의 `prepared/job=null`에서 시작한다. 그 뒤 inventory 처리·같은 B job `7a80d70e-4758-4809-84d1-3a33ee1dc6ac` 완료·독립 inspect를 거쳤다. |
| 최종 pair 관측 | 두 Auth·프로필 부재, 두 completed job 영수증, 소유 사진 목록·media manifest 부재, 같은 couple 및 16개 couple 테이블의 시험 자료 부재를 확인했다. 준비 version 1·시각 순서·job 소유자/claim/error NULL도 검증했다. |
| 만료 전 세션 거부 | 최종 관측에서 B의 아직 유효한 JWT로 제품 `/api/auth/me?consent_only=1` GET 1회가 401·no-store였다. 요청 전후 잔여 유효시간 60초 이상을 확인했고 refresh는 0회다. A 옛 JWT는 이미 만료됐으므로 만료 전 거부 증거로 사용하지 않는다. |

A 보존 관측은 HTTP 35회와 제한 SQL 1회(4범위), 최종 관측은 HTTP 34회와 제한 SQL 1회(4범위)다. 관측 자체의 원격 변경·삭제 시도는 0이며, 앞선 지원 worker의 실제 삭제 실행과 구별한다. B 정리 전에 확보한 after-A 원본 manifest/result/receipt를 최종 검증에 다시 결합했다.

## 증거 고정

공개 증거 디렉터리는 `C:/Users/kcho1/.codex/visualizations/web-launch-20260928/w12-successor/`다. 마감 원문에 열거한 14개 파일의 SHA-256이 실제 bytes와 모두 일치한다. 보호된 토큰·문의 원문은 이 문서에 복사하지 않는다.

| 증거 | SHA-256 |
|---|---|
| `w12-scoped-closeout.json` | `399b11822fc1d46a51ab2830f754a27da6b2644bf361fb9031ccd05d60767866` |
| 원본 `baseline-current-manifest.json` | `81685ee3b16ee8f18a7d69fbb09e9bbbea2b1386771f48d06181c52b7c9edc0a` |
| 원본 `baseline-current-result.json` | `074a634d015189e5a692f1d0219997393f858b0c9e2003e5c04168401d0ee8ff` |
| 원본 baseline 보호 receipt | `e6022b8df9ce85fa3afeca926d89c8e03f8cfc25ce08d007e5127faa73781f20` |
| `source-audit.json` | `24c1cb385f5646a341f886d539e9ba7855d734f8a3a46d16c24e475aae944036` |
| after-A 결과 / 보호 receipt | `ed78803aee1105e69061cc5cd1065f4bca48704ae59753134b7d88b6a8b6127c` / `a6310d83264764e9fbe80e5249b989442b20ff35f842b5c16e2af76bd5fa8987` |
| 최종 결과 / 보호 receipt | `5d7d164dd40d5818505f8db8fb460558a81aaad3662a893031d1a2ed19ff6ad9` / `2ea0b99b6fbbce7df4d9857b0e638978bf9becbe3f1d9ae703e30c2a9625bf9b` |

## 마감 범위와 남은 출시 조건

- 지원 CLI의 `scope_review_required`와 `generalCustomerDataRemovalVerified=false`를 그대로 유지한다. 임의의 완료 상태를 만들거나 상태를 강제 변경하지 않았다. 완료 감사 job과 암호화 지원 증거는 검증·추적을 위해 남긴다.
- 공유 보존은 관측한 준비 자료·예산·체크리스트·일정과 해당 22범위에 한정한다. `couple_plan_change_requests`, `couple_plan_change_acceptances`, `couple_change_notifications` 이력 전체는 제외하며 Auth FK cascade로 A 작성 이력이 삭제될 수 있는 경계를 유지한다.
- 모든 고객·legacy·운영 자료의 삭제, 완전 익명화, 물리 저장 매체 byte 소거를 증명하지 않는다. 실제 고객 완료 안내 메일을 보내거나 그 수신을 시험하지 않았다.
- `w13OriginalRestoreVerified=false`, `fullWebLaunchReady=false`다. W13 원본 DB/Auth/Storage 복원과 삭제 재반영, W15 최종 실기기 등 남은 출시 조건은 별도로 마감한다.
- **별도 P6 권한 과제:** `2026-09-28 08:44:58 UTC`의 [기존 fitting 함수 catalog 증거](C:/Users/kcho1/.codex/visualizations/web-launch-20260928/fitting-advisor-catalog-review.json)는 `public.increment_fitting_usage(uuid,date)`와 `public.cleanup_expired_fittings()`에 PUBLIC·anon·authenticated EXECUTE, postgres 소유 SECURITY DEFINER, 호출자 확인과 고정 search_path 부재를 기록한다. 전자는 전달된 커플/기간의 사용량을 변경하고 후자는 사용자 구분 없이 만료·미저장 피팅을 삭제하는 본문이다. 이는 DB 권한 경계에서 확인된 별도 출시 차단 과제이며, 이 W12 수정이 만든 결함이라는 근거는 없다. 실제 함수 실행·REST 도달성·악용·영향 행 수는 시험하지 않았다. 권한 수정의 운영 적용·독립 조회가 완료되기 전까지 미완료이며 프로젝트 전체의 보안 완료를 뜻하지 않는다. 해당 증거 파일 SHA-256은 `249f432ba87db63d9da05065c203289fe46b9eeb1b577ab66f5e1d0c74e7f1fb`다.
