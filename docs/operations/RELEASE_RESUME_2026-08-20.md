# 릴리스 재개 지침 — 2026-08-20

이 문서는 **자격증명이 준비된 뒤 무엇을 어떤 순서로 하는가**와 **무엇을 다시 하지
않아도 되는가**만 담는다. 절차 자체는
`docs/operations/SUCCESSOR_SUPABASE_RELEASE_CONTROLLER_2026-07-31.md`가 정본이고,
이 문서는 그 앞에 놓이는 재개 메모다.

## 현재 상태

- 릴리스 후보: `codex/amora-release-hardening-20260811` (로컬 `codex/release-activation-20260819`)
- 매니페스트: `deployment_blocked` — activation은 아직 하지 않았다
- 운영에 나간 것: **없음**. 운영 DB 스키마 변경 0건, Vercel 배포 0건
- 운영에는 신규 18테이블이 **하나도 없다**(읽기 전용 실측). pending 81건은 실재한다

## 시작하기 전에 반드시 채울 것

| 항목 | 쓰임 | 없으면 |
|---|---|---|
| `AMORA_MEDIATION_OUTCOME_FOLLOW_UP_ENABLED=false` (Vercel Production) | 빌드 게이트 통과 | **첫 배포가 `next build` 전에 exit 1**. Vercel은 이전 빌드를 계속 서비스해 겉보기엔 멀쩡하다 |
| Vercel 토큰 | `VENDOR_DISCLOSURE_PRODUCTION_AUTHORIZATION` 갱신 · 배포 READY 확인 · canary 서버에러 수집 | activation 이후 진행 불가 |
| 운영 DB 연결 문자열 | write fence 관측 · 사전/사후 검사 | 컨트롤러 게이트 통과 불가 |
| `psql` | 위 관측 실행 | 같음 |
| canary 테스트 계정 | 운영 로그인/로그아웃 확인 | canary 미완 |

첫 항목은 코드 변경이 아니라 **설정**이다. 게이트가 읽는 변수는 총 29개인데
이번 릴리스가 추가한 것은 이 하나뿐이며, 나머지 28개는 기존 빌드가 성공해 왔으므로
이미 운영에 있다.

## 순서

1. 위 다섯 가지를 채운다.
2. `origin/main`을 다시 병합한다. main은 이 브랜치와 별개로 계속 움직인다.
3. **activation은 2커밋 경계다.** `--check` → `--write` → 생성된 파일 정확히 2개만 커밋
   (`supabase/release-contracts/vendor-disclosure-production-controller-v1.json`,
   `supabase/release-manifests/vendor-disclosure-v2-20260718.json`).
   `--write`는 `HEAD == @{upstream} == live origin SHA`를 요구하므로 **직전 커밋이
   push된 상태여야 한다.**
4. activation을 하면 **테스트 18건이 빨개진다**(root 17 + `productionBuildFence.test.ts` 1).
   가드를 약화시키는 것이 아니다 — 그 테스트들의 fixture가 저장소의 실제 매니페스트를
   복사해 변형하므로, 기반이 `deployment_blocked`에서 `controller_ready`로 바뀌면
   같은 변형이 다른 오류 코드를 낸다(예: `DEPLOYMENT_STATUS_INVALID` →
   `MANIFEST_SHAPE_INVALID`). activation 커밋과 함께 갱신해야 한다.
5. 이후는 정본 런북의 성공 순서를 그대로 따른다. **DB 적용(6단계)이 배포(8단계)보다
   먼저**이며 이 순서는 계약이 강제한다(`phase: "post-push-pre-deployment-canary"`,
   `requiredLeasePhase: "deployment-canary"`).
6. 런북 **10단계**를 잊지 말 것 — finalizer가 write fence를 내린 뒤
   `set_amora_provider_runtime_control(true, ...)`로 아모라 외부 호출을 켜고,
   **사람이 직접 아모라에게 말을 걸어 답하는지 확인**한다. 이 릴리스의 사용자 표면
   대부분이 아모라를 거치는데, 마이그레이션이 그 스위치를 꺼진 채로 심는다.
   canary는 write fence 안에서 돌기 때문에 이것을 확인할 수 없다.

## 다시 하지 않아도 되는 것 — Staging 실측 완료 (2026-08-20)

Staging(`rgxdizztidbgwnsbadml`)에는 신규 18테이블이 **18/18 존재**한다. 아래는 이
브랜치를 Staging에 붙여 실제로 눌러 확인한 결과다.

- 공개·리다이렉트 라우트 27개 + 신규 테이블 기반 API 20개 → **5xx 0건**
- 이메일 로그인 성공(실제 세션 생성 확인), 온보딩 완주, **1인 커플 생성 동작**
- 아모라 AI 경로 살아남 — `gpt-5.6-luna`, 3.8초, `ai_interactions_log`에 **원문 없음**
- 「오늘 하나」 열림. 날짜 계산 검산 일치(`meeting.ddayDeadline` D-300, 현재 D-135 → 165일)
- 대시보드 전체 5xx 0건
- 운영 카탈로그 fence 값 실측 일치: distinct slug **1053**,
  sha256 `43e07391e66a5eefdd61f1b6aa75813e4d691f76a0a68977daf99394e4db6180`

## 아직 검증하지 못한 것

**"두 사람이 확인한 것만 남는다" — 이 릴리스의 핵심 약속을 확인하지 못했다.**

아모라가 되묻는 순간 대화가 고리에 갇힌다. 범위 분류기가 대화 이력을 받지 않아
"응 넣어줘" 같은 짧은 확인이 범위 밖으로 떨어지고 도구가 0개가 된다. 그래서
변경 제안 → 확인 → 반영 흐름에 도달하지 못했다. 별도 작업으로 진행 중이며,
고쳐진 뒤 Staging에서 이 흐름을 반드시 확인하고 나서 운영으로 가야 한다.

공동 변경(양쪽 확인)도 같은 이유로 미검증이다. 확인하려면 Staging 계정 두 개가 필요하다.

## 알려진 결함 — 각자 별도 작업으로 진행 중

릴리스에 넣지 않았다. 여기 적는 이유는 **다시 찾아내느라 시간을 쓰지 않게** 하기 위해서다.

| 결함 | 릴리스 차단 | 비고 |
|---|---|---|
| 아모라 되묻기 고리 | 아니오(제품 결함) | 위 "검증 못 한 것"의 원인 |
| `/api/auth/me`가 스키마 결함을 `couple: null`로 삼킴 | 아니오 | DB 선행 순서가 창을 막는다. DB만 롤백하면 열린다 |
| 초대코드 만료를 "코드가 틀렸다"로 표시 | 아니오 | 기존 6자리 코드가 교체 대상. 영향 건수를 먼저 셀 것 |
| 클릭스트림 `sessionId` 형식 불일치 → `/api/events` 400 | 아니오 | main에도 있음. 고치면 수집이 켜지므로 방침 확인이 먼저다 |
| 신혼집 지출이 결혼식 예산 총액에 합산 | 아니오 | 파운더 결정: 예산에 포함하지 않는다 |
| dev 서버가 운영을 가리켜도 막지 않음 | 아니오 | 2026-08-20 실제 사고의 원인 |

## 사고 기록 — 반복하지 말 것

2026-08-20, 스테이징을 검증한다고 믿고 누른 「커플 초기화」가 **포트 3200에서 돌던
다른 워크트리의 dev 서버**로 갔고, 그 서버는 운영 DB를 보고 있었다. 파운더 본인의
운영 커플 연결이 끊어졌고 **되돌릴 수 없다** — roster epoch 트리거가 sealed 커플의
빈 슬롯 재삽입을 영구 차단한다. 대화 132건은 배우자 계정 쪽에 남아 접근 경로만
유지됐다. **배우자 계정까지 초기화하면 두 사람 다 그 기록에 접근할 수 없다.**

교훈: 이 PC에서는 여러 워크트리가 각자 dev 서버를 띄운다. 화면만 보고는 어느 DB인지
알 수 없다. **URL을 안내할 때 포트와 대상 프로젝트를 함께 밝히고, 누르기 전에
`Get-NetTCPConnection`으로 포트↔워크트리를 매핑할 것.**
