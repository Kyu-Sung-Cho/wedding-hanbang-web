# Amora Engine V2 production release — 2026-07-16

이 문서는 아모라 장기기억·명시적 케어 동의·양측 중재 확인을 운영에 적용하는
릴리스 게이트다. 이전 OpenAI 전환 릴리스와 별개이며, 완료 증거 없이 완료로
표시하지 않는다.

## 범위

- 기준 브랜치: `feat/amora-engine-v2-20260716`
- 운영 Supabase: `slrtobkksjmxgzatjyqb`
- 검증용 복구 클론: `syhmfxauqyhgdcokrheg`
- 마이그레이션 순서:
  1. `20260716090000_amora_memory_engine_v2.sql`
  2. `20260716091000_care_explicit_consent.sql`
  3. `20260716092000_amora_mediation_confirmation.sql`
- 새 런타임은 `AMORA_AUXILIARY_MEMORY_ENABLED=false`로 시작한다.

## 변경 전 안전 게이트

1. 원격 `main`과 현재 브랜치를 다시 fetch하고 예상하지 않은 커밋·파일이 없는지
   확인한다.
2. 마이그레이션 해시와 원격 pending set이 릴리스 manifest와 정확히 일치해야 한다.
3. 운영의 최신 공급자 물리 백업이 `COMPLETED`이고 Restore가 가능한지 확인한다.
4. 새 메모리 테이블이 아직 없는 운영 DB에서는 변경 전 `main`의 11-table HBAM2
   도구로 깨끗한 커밋에서 백업·즉시 검증한다. 식별자·해시·개인 데이터는 Git에
   기록하지 않는다.
5. 세 마이그레이션을 복구 클론에 먼저 적용하고 DB 통합/RLS/RPC 테스트를
   통과시킨다. `pnpm amora:db:test-engine-v2`는 운영 ref를 기본 거부하며 합성
   사용자만 만들고 종료 시 Auth cascade로 정리한다.
6. 웹 전체 test/typecheck/lint/build, 모바일 test/typecheck/export, 백업 E2E,
   릴리스 정적 fence가 모두 통과해야 한다.
7. Vercel에 `CRON_SECRET`이 존재하고 Preview/Production 모두에서 값이 노출되지
   않는지 확인한다. `OPENAI_API_KEY`는 읽거나 출력하지 않고 존재 여부만 본다.

## 운영 DB 적용

- 일반 `supabase db push`, `--include-all`, migration history 추측 보정은 금지한다.
- 각 파일은 manifest 해시, 프로젝트 ref, 직전 원격 pending set을 다시 확인한 뒤
  짧은 lock/statement timeout을 가진 파일 자체의 트랜잭션으로 순서대로 한 번만
  적용한다.
- 성공 여부가 불명확하면 재실행하지 말고 migration ledger와 후조건을 먼저 읽는다.
- 적용 후 pending set은 0이어야 한다.
- 익명 RLS probe와 다음 후조건을 확인한다.
  - 기억 설정·동의·작업 테이블은 익명/일반 사용자 쓰기 불가
  - 공유 기억은 두 사용자 동의 전 `enabled=false`
  - 기억 upsert 재시도는 같은 노드, 값 변경은 이전 노드 폐기
  - 중재는 두 사용자 동의 전 공동 결정 0건
  - 과거 케어 기본값은 동의 시각 없이 발송 가능하지 않음
- 서비스 전용 RPC probe는 큐 등록·기억 저장·수정·삭제·요약 저장·케어 메시지
  저장이 모두 DB에서 회원 범위와 최신 동의를 다시 확인하는지 검증한다.
- 전체 초기화도 요청 사용자 UUID를 받아 DB에서 현재 커플과 개인 범위를 다시
  확인해야 한다. API 인증만으로 충분하다고 보지 않는다.
- 동의를 처음 켠 뒤 과거 메시지가 소급 컴파일되지 않고, 사용자가 고친 기억이
  자동 저장으로 덮어써지지 않으며, 개별 삭제한 의미 키가 다시 생기지 않아야 한다.
- 큐·기억 노드·요약 RPC는 `memory_reset_at` 이전 메시지를 DB에서 최종 거부해야
  한다. 애플리케이션 쿼리만으로 이 경계를 보장한 것으로 간주하지 않는다.
- 최초 활성화는 명시적 동의 도입 전의 자동 요약·프로필·미확인 추론 기억을 같은
  트랜잭션에서 제거해야 한다. 사용자가 직접 고친 기억은 보존한다.
- 만료 후 재획득된 작업은 이전 `attempt_count`의 완료 호출을 거부하고, 5번째
  시도에서 워커가 사라진 작업은 `LEASE_EXHAUSTED`로 종결돼야 한다.
- 병렬 `claim_amora_memory_job` 호출에서도 같은 커플·범위의 작업은 하나만 선점돼야
  한다. 복구 클론의 실제 병렬 RPC로 검증한다.
- 적용 직후 새 15-table HBAM2 백업을 생성·즉시 검증한다.

## 복구 클론 검증 기록

- 2026-07-16: 검토 대상 마이그레이션 3개만 `syhmfxauqyhgdcokrheg`에 직접 적용.
- `pnpm amora:db:test-engine-v2`: 통과. 익명/일반 사용자 권한, 2인 기억 동의,
  동의 이전 메시지 차단, 병렬 큐 선점 직렬화, 수정 보호, 삭제 tombstone, 전체 초기화, 케어 양측 동의,
  중재 양측 확인을 실제 호스팅 PostgreSQL에서 검증.
- `pnpm amora:db:test-preview`: 통과. Auth 삭제 cascade, 원자적 커플 초기화,
  남은 파트너 유지, 병렬 채팅·도구·비용 fence를 회귀 검증.
- 위 기록은 클론 검증 증거일 뿐 운영 DB 적용·GitHub 병합·Vercel 배포 완료를
  의미하지 않는다.

## 호환 배포와 활성화

1. GitHub 필수 체크가 모두 성공한 불변 커밋만 병합한다.
2. Vercel을 `AMORA_AUXILIARY_MEMORY_ENABLED=false`로 배포한다.
3. 로그아웃/로그인, 공유·개인 채팅, 일정·예산 도구, 웹과 네이티브 모바일의 기억
   설정, 중재 카드, 케어 설정을 카나리한다. 메모리 크론은 인증되지만
   `enabled:false`로 응답해야 하며 새 동의만 차단되고 삭제·철회는 가능해야 한다.
4. 오류율·첫 토큰 시간·중복 도구 실행·모바일 레이아웃 회귀가 없을 때만 플래그를
   `true`로 바꾼다.
5. 플래그 활성화 후에도 사용자 동의 기본값은 꺼짐이다. 합성 계정으로 개인 기억과
   공유 양측 동의 흐름을 검증하고 합성 데이터를 삭제한다.
6. 30분 이상 크론 성공/실패/재시도, 상담 오류율, 비용을 관찰한다.

## 롤백

1. 가장 먼저 `AMORA_AUXILIARY_MEMORY_ENABLED=false`로 설정하고 재배포해 새 큐
   생성과 처리를 멈춘다.
2. 문제가 케어 발송이면 크론 경로를 비활성화한다. 명시적 동의 시각이 없는 외부
   발송은 계속 fail-closed여야 한다.
3. 이전의 검증된 Vercel 배포로 되돌린다.
4. DB 마이그레이션은 expand-only로 남긴다. 장애 중 테이블/열/함수를 삭제하는
   down migration은 실행하지 않는다.
5. 데이터 손상이 확인된 경우에만 새 쓰기를 차단하고 공급자 복구 또는 별도 승인된
   HBAM2 복원 절차를 사용한다. 운영 DB에 논리 백업을 직접 재생하지 않는다.
6. 케어 동의를 과거 `true` 값으로 자동 복원하지 않는다. 사용자가 다시 동의해야
   한다.

## 완료 정의

- 운영 DB 적용·15-table 백업 검증·GitHub 병합·Vercel ready·플래그 전후 카나리와
  30분 관찰이 모두 증거로 남았을 때만 완료다.
- 복구 클론, 실제 EAS 모바일 빌드 또는 운영 환경 인증이 막히면 해당 항목을 미완료로
  기록한다. 로컬 export를 실제 스토어 빌드라고 부르지 않는다.
