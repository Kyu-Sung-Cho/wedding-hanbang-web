# 아모라 OpenAI 전환 계획 및 안전 게이트

기준일: 2026-07-14 (Asia/Seoul)

기준 브랜치: `fix/amora-openai-hardening-20260714`

기준 베이스: `origin/main` (`d2eab99304c0d79fbbe6f20354074b229c9035cf`)

## 현재 사실

- 운영 아모라 런타임은 아직 Anthropic 경로다.
- 이 브랜치는 OpenAI Responses API 기반, 비용 계산, 개인정보 비기록, 모델 라우팅을 먼저 추가하는 **A단계 기반 PR**이다.
- `AMORA_OPENAI_ENABLED=false`가 기본이며, 이 PR만 배포해도 OpenAI 호출은 시작되지 않는다.
- OpenAI API 키는 Git에 넣지 않는다. 운영 환경변수 등록과 런타임 활성화는 별도 안전 게이트다.
- PR #38은 보관용이며 통째로 병합하거나 파일 단위로 복사하지 않는다. 필요한 설계만 현재 `main` 위에서 다시 구현한다.

## 공식 API 계약

2026-07-14에 OpenAI 공식 문서로 확인한 계약이다.

- 기본 고빈도 모델: `gpt-5.6-luna`
- 복잡한 계약·위험·수정 반복 모델: `gpt-5.6-terra`
- API: Responses API
- reasoning effort: `none`
- 생성 저장: `store: false`
- 생성 자동 재시도: `0`
- 최대 출력: `800` 토큰
- prompt cache: 측정 전까지 명시적으로 사용하지 않음
- tool 호출: 한 라운드에 하나, 서버 AJV 검증 후 실행
- 사용자를 OpenAI에 보낼 때 원 ID 대신 namespace가 분리된 안정적인 SHA-256 `safety_identifier` 사용

참고:

- <https://developers.openai.com/api/docs/guides/latest-model>
- <https://developers.openai.com/api/docs/models/gpt-5.6-terra>
- <https://developers.openai.com/api/docs/models/gpt-5.6-luna>
- <https://developers.openai.com/api/docs/pricing>

`store: false`는 API 응답 저장을 끄는 설정이지 Zero Data Retention 보증이 아니다. 실제 abuse-monitoring 보존, 처리 지역, DPA 및 ZDR/MAM 자격은 운영 계약으로 별도 확인한다.

## 단계별 완료 정의

### A. Provider 기반 — 현재 브랜치

- [x] kill switch가 꺼져 있으면 키가 있어도 OpenAI 설정을 사용할 수 없음
- [x] Luna/Terra 외 모델을 fail-closed로 거부
- [x] Responses API streaming/non-streaming adapter
- [x] 요청·응답 ID와 `usage_status=complete|unknown` 분리
- [x] refusal과 일반 오류 분리
- [x] 원문 prompt/response/tool/error 감사 로그 차단
- [x] 공식 가격과 272K 초과 장문 요율 계산
- [x] targeted typecheck/unit tests
- [ ] 전체 로컬 release gate, 독립 코드 리뷰, CI
- [ ] PR 병합 및 동작 불변 배포 확인

### B. 운영 DB 확장

> 2026-07-14 security re-review: Stage B is **not complete**. The earlier HBAM1
> capture and generic PGlite JSONB staging check are superseded evidence. A
> fresh HBAM2 capture/verification is still required, and the PGlite round-trip
> is not an actual schema restore. Isolated real-schema restore plus RLS/RPC
> contract verification remain open gates.

- [ ] 운영 스키마와 migration history 읽기 전용 inventory
- [ ] timestamped 논리 백업, checksum, 복구 명령 확보
- [ ] Amora 전용 expand-only migration 작성
- [ ] 격리된 실제 스키마로 복원하고 RLS/RPC contract 검증 (PGlite JSONB round-trip만으로 충족되지 않음)
- [ ] 운영 dry-run과 write fence 통과 후 migration 적용

DB 변경은 기존 대형 migration을 복사하지 않는다. 현재 운영 스키마에서 필요한 lifecycle, request claim, provider lease, usage reservation 구조만 새 migration으로 만든다.

### C. 원자적 런타임 전환

- [ ] API는 클라이언트 history를 신뢰하지 않고 canonical DB에서 직접 조회
- [ ] `clientMessageId` 저장 멱등성 및 동일 요청 replay
- [ ] partner-only 메시지를 provider context에서 제외
- [ ] 위기 고정 응답은 provider·quota·키·DB 장애와 독립적으로 화면에 표시
- [ ] demo 상태를 서버에서 서명·검증하며 위조/stale cookie는 provider 0회
- [ ] quote 분석은 raw 문자열 태그 대신 서명된 서버 권한 사용
- [ ] provider mock route integration: timeout, abort, refusal, 429, 5xx, interrupted stream, duplicate request, visibility 공격
- [ ] 웹 store와 서버 route를 같은 PR에서 전환하고 이전 fallback을 제거

### D. 소비자 UX·모바일·접근성

- [ ] partner 첨부 금지/설명, 화면 종료 시 첨부 소실 안내
- [ ] demo UX와 실제 동작 일치
- [ ] 429 reason/retryAt 및 저장된 질문 재시도 UX
- [ ] 실제 서버 stage가 없으면 과장된 진행 문구 사용 금지
- [ ] 핵심 조작 44×44px, label, tab/radio ARIA, 키보드 동작
- [ ] 웹·모바일 동일한 privacy/visibility/attachment 계약
- [ ] PDF·이미지·DOCX/cancel/retry/느린 네트워크 실제 기기 검증

### E. 운영 활성화와 카나리

- [ ] 개인정보 처리 고지에 DOCX 추출 텍스트와 OpenAI 처리 내용 반영
- [ ] DPA, 처리 지역, ZDR/MAM 여부, 실제 수신 가능한 support 채널 확인
- [ ] 보수적 초기 비용 제한과 즉시 끌 수 있는 운영 kill switch
- [ ] Vercel preview에서 실제 OpenAI 키로 비식별 synthetic smoke
- [ ] 백업·롤백 확인 후 production env 등록 및 제한된 canary
- [ ] 오류율, interrupted/unknown usage, latency, 모델 비율, provider HTTP 호출 수, 비용 하한 모니터링
- [ ] 카나리 통과 후에만 OpenAI 전환 완료로 선언

## A단계 변경 경계

포함:

- `apps/web/src/lib/ai/`의 OpenAI provider·라우팅·도구 스키마·안전 식별자
- `apps/web/src/lib/compliance/ai-log.ts`의 가격 및 원문 비기록
- `scripts/amora-cost-report.mjs`의 OpenAI 가격·unknown usage 처리
- 의존성, 환경변수 예시, CI의 명시적 비활성화
- 단위 테스트와 이 문서

제외:

- `/api/chat` 호출 경로 변경
- Anthropic 의존성 제거
- 운영 OpenAI 키 등록
- `AMORA_OPENAI_ENABLED=true`
- 운영 DB migration
- 개인정보·AI 정책에서 아직 일어나지 않는 OpenAI 처리를 완료된 것처럼 표시

## 롤백

A단계는 런타임에서 사용되지 않으므로 롤백은 해당 PR revert다. 기능 플래그 기본값은 계속 `false`여야 한다. 이후 단계에서 이상이 생기면 가장 먼저 OpenAI/Amora runtime kill switch를 끄고, provider 호출이 0회가 된 것을 확인한 뒤 코드 또는 DB를 롤백한다. DB rollback은 destructive down migration보다 사전에 검증한 백업 복구 절차를 우선한다.

## 인수인계 시 확인 명령

```powershell
git fetch --all --prune
git status --short --branch
git log --oneline --decorate -8
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web test
corepack pnpm qa:local
```

## Preview stub safety fence

- Vercel Preview may set `NEXT_PUBLIC_PREVIEW_STUB_MODE=true` without copying any production Supabase or AI secret.
- The flag has priority over accidentally injected Supabase values: public landing auth/realtime/feed effects stay disconnected.
- Every `/api` and `/api/*` request returns `503` with `Cache-Control: no-store`, so preview code cannot read or write through application routes.
- Production must keep the flag absent or `false`. Missing Supabase configuration without the flag remains a visible fail-fast configuration error.
- Rollback: remove the Preview-scoped variable (or set it to `false`) and redeploy. Do not compensate by copying production service-role or provider keys into Preview.

키 값 자체를 출력하는 명령은 실행하거나 문서화하지 않는다. 환경변수는 존재 여부와 placeholder 여부만 검증한다.
