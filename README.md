# 웨딩한방

웨딩한방은 웹, Expo 모바일 앱, 공유 패키지, Supabase 스키마를 한 저장소에서 관리하는 pnpm/Turbo 모노레포입니다.

> 구현 상태와 버전은 문서의 과거 스냅샷보다 실제 코드, 각 `package.json`, `pnpm-lock.yaml`, `supabase/migrations/`를 우선합니다.

현재 아모라는 OpenAI Responses API의 `gpt-5.6-luna`를 기본으로 사용하고 계약·분쟁/안전·반복
교정 턴만 `gpt-5.6-terra`로 승격합니다. Anthropic/Claude 런타임은 제거되었습니다.
WeddingCode는 개인 결과를 브라우저에서만 계산하며, 커플 초대·비교와 익명 응답 수집은
보안·동의·보유기간 재설계 전까지 코드에서 비활성화되어 있습니다.
업체 연결은 실제 전달·상태 왕복·연락처 철회가 검증될 때까지 새 상담 요청·문의·결과·공개 후기
저장을 하드 비활성화하고 과거·예시 기록만 조회합니다.
계정 없는 예시 체험은 합성 데이터와 24시간 서명 쿠키만 사용하며 OpenAI 호출과 아모라 전송을
서버에서 차단합니다. 운영에서는 `DEMO_SESSION_SECRET`이 없으면 예시 세션을 만들지 않습니다.

## 워크스페이스

- `apps/web`: Next.js 16 웹 앱과 Route Handlers
- `apps/mobile`: Expo 54 / React Native 모바일 앱
- `packages/design-tokens`: 웹·모바일 공유 디자인 토큰
- `packages/shared`: 공유 타입·상수·유틸리티
- `supabase`: 데이터베이스 마이그레이션과 백엔드 설정
- `scripts`: QA, 릴리스, Supabase 운영 스크립트

## 로컬 실행

요구사항은 Node.js 22.13 이상, Corepack, 저장소에 고정된 pnpm 11.7.0입니다.

```bash
corepack pnpm install
corepack pnpm dev:web
```

모바일 개발 서버는 다음 명령으로 실행합니다.

```bash
corepack pnpm dev:mobile
```

환경변수는 [`apps/web/.env.example`](apps/web/.env.example)과 [`apps/mobile/.env.example`](apps/mobile/.env.example)을 기준으로 로컬 파일에 설정합니다. 비밀값은 커밋하지 않습니다.

## 검증 명령

```bash
corepack pnpm --filter @hanbang/web typecheck
corepack pnpm --filter @hanbang/web lint
corepack pnpm --filter @hanbang/web test
corepack pnpm --filter @hanbang/web build
corepack pnpm mobile:release-check
```

루트의 전체 워크스페이스 스크립트는 `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm build`입니다.

## 원칙과 디자인

- 제품 의사결정 원칙: [`PRINCIPLES.md`](PRINCIPLES.md)
- 디자인 의도: [`DESIGN.md`](DESIGN.md)
- 공유 디자인 토큰: [`packages/design-tokens/src/`](packages/design-tokens/src/)
- 웹에 실제 적용된 디자인 값: [`apps/web/src/app/globals.css`](apps/web/src/app/globals.css)
- 에이전트 작업 규칙: [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md)

## 검토 기록

감사 문서는 작성 시점의 스냅샷이며 현재 코드를 대신하지 않습니다.

- 현재 서비스 기준: [`WEDDINGHANBANG_SERVICE_DOC.md`](WEDDINGHANBANG_SERVICE_DOC.md)
- 2026-07-12 전체 QA와 현재 NO-GO 근거: [`docs/codex-tasks/FULL_QA_2026-07-12.md`](docs/codex-tasks/FULL_QA_2026-07-12.md)
- 운영 출시·백업·롤백 순서: [`docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md`](docs/PRODUCTION_RELEASE_ROLLBACK_RUNBOOK.md)
- 모바일 스토어 출시 체크리스트: [`docs/MOBILE_APP_STORE_RELEASE_CHECKLIST_2026-06-30.md`](docs/MOBILE_APP_STORE_RELEASE_CHECKLIST_2026-06-30.md)
- 2026-07-11 소비자 여정·보안·출시 보수 감사: [`docs/CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md`](docs/CONSUMER_JOURNEY_AND_RELEASE_AUDIT_2026-07-11.md)
- 아모라 OpenAI GPT-5.6 전환 검토: [`docs/AMORA_OPENAI_MIGRATION_REVIEW_2026-07-10.md`](docs/AMORA_OPENAI_MIGRATION_REVIEW_2026-07-10.md)
- 2026-07-10 보수적 전체 감사와 출시 경계: [`docs/AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md`](docs/AUDIT_2026-07-10_CONSERVATIVE_FULL_REVIEW.md)
- 최신 광역 문서-코드 대조: [`docs/DOC_VS_CODE_AUDIT_2026-07-03.md`](docs/DOC_VS_CODE_AUDIT_2026-07-03.md)
- 보안 감사 묶음: [`docs/SECURITY_AUDIT_2.1_ADMIN_AUTH_2026-07-03.md`](docs/SECURITY_AUDIT_2.1_ADMIN_AUTH_2026-07-03.md)부터 `2.5_RLS`까지
- WeddingCode candidate.10 문항·계산·UX 전면 재설계: [`docs/wedding-code/63_candidate10_evidence_based_rebuild_2026-07-11.md`](docs/wedding-code/63_candidate10_evidence_based_rebuild_2026-07-11.md)
- WeddingCode 최소 32문항 연구 풀: [`docs/wedding-code/64_candidate10_32_item_research_pool_2026-07-11.md`](docs/wedding-code/64_candidate10_32_item_research_pool_2026-07-11.md)
- WeddingCode candidate.8~9 카피 감사와 인수인계: [`docs/wedding-code/60_candidate8_full_item_plain_language_audit_2026-07-09.md`](docs/wedding-code/60_candidate8_full_item_plain_language_audit_2026-07-09.md), [`docs/wedding-code/61_2026-07-09_worklog_handoff.md`](docs/wedding-code/61_2026-07-09_worklog_handoff.md), [`docs/wedding-code/62_candidate9_conservative_copy_pass_2026-07-09.md`](docs/wedding-code/62_candidate9_conservative_copy_pass_2026-07-09.md) (역사 기록)
- 과거 기준선: [`FEATURE_AUDIT.md`](FEATURE_AUDIT.md), [`AUDIT_2026-04-28.md`](AUDIT_2026-04-28.md)

## 배포 표면

| 표면 | 설정/소스 | 주의 |
|---|---|---|
| 웹 | `apps/web`, `apps/web/vercel.json`, Vercel | 브랜치·PR 상태는 라이브 배포 상태가 아니다. 배포 URL에서 별도 확인한다. |
| 모바일 | `apps/mobile`, `apps/mobile/eas.json`, Expo EAS | 웹 배포와 별도 빌드·제출 절차를 사용한다. |
| 데이터/백엔드 | `supabase/migrations/`, Supabase | 로컬 SQL 존재와 원격 적용 완료는 다르다. 적용 후 원격 검증이 필요하다. |
