# 사전등록 Double Opt-In 운영 경계 (2026-08-03)

## 목표

- 공개 폼 제출만으로 `preregistrations` 영구 행을 만들지 않는다.
- 이메일 소유자가 확인 화면에서 명시적으로 POST해야 영구 행으로 승격한다.
- 확인 전에는 이메일·이름·예식일·역할·메시지·UTM을 AES-256-GCM으로 암호화하고, DB에는 30분 TTL의 암호문과 고정 길이 digest만 저장한다.
- 확인 링크의 원문 토큰은 DB에 저장하지 않는다. 링크는 URL fragment에 넣어 GET 요청·서버 접근 로그·일반 링크 스캐너에 전달되지 않게 한다.
- GET은 절대 확인이나 취소를 수행하지 않는다.

## 운영 전 필수값

1. `PREREGISTRATION_INTENT_ENCRYPTION_KEY`
   - 다른 자격증명과 재사용하지 않은 32자 이상의 CSPRNG base64url 값
   - 생성 예시: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
   - 회전하면 이미 발급된 최대 30분짜리 링크를 복호화할 수 없다. 배포 중 즉시 회전하지 않는다.
2. `RESEND_API_KEY`, `NEXT_PUBLIC_SITE_URL`, Supabase 서버 환경변수, Turnstile 환경변수
3. `CRON_SECRET`
4. `PREREGISTRATION_PENDING_PURGE_ENABLED=false`로 먼저 배포

## 배포 순서

1. `20260803102000_preregistration_double_opt_in.sql`을 검토된 Supabase 릴리스 절차로 적용한다.
2. 마이그레이션의 RPC ACL·FORCE RLS·trigger postflight 결과를 확인한다.
3. 별도 암호화 키와 이메일 공급자 환경변수를 Production에 설정한다.
4. 웹 코드를 배포한 뒤 새 주소로 신청한다.
5. DB pending 행에 이메일·원문 토큰이 없는지 확인한다.
6. 이메일 링크 GET만으로 `preregistrations` 행이 생기지 않는지 확인한다.
7. 화면의 확인 POST 후 행 1개와 동의 버전·동의 시각·이메일 확인 시각이 함께 생성되는지 확인한다.
8. 같은 링크 재사용, 이전 재발급 링크, 취소 링크가 모두 승격되지 않는지 확인한다.
9. 위 확인 뒤에만 `PREREGISTRATION_PENDING_PURGE_ENABLED=true`로 전환한다. Cron은 15분마다 최대 1,000개의 만료 pending 행만 삭제한다.

## 실패 및 복구

- 메일 전달 성공을 증명하지 못하면 신규 intent를 즉시 회수하고 503을 반환한다.
- DB issue가 실패하면 이메일을 보내지 않는다.
- 확인 RPC의 insert와 token consume은 같은 DB 트랜잭션이다. insert가 실패하면 token도 소비되지 않는다.
- 암호화 키가 없거나 약하면 발급·확인이 모두 fail-closed한다.
- 재발급은 동일 이메일의 keyed lookup digest를 기준으로 이전 token을 원자적으로 교체한다.
- 확인 전 사용자는 확인 화면의 취소 POST로 즉시 intent를 회수할 수 있다.
- 확인 후 철회·열람·삭제 요청은 현재 개인정보 처리방침의 고객센터 경계를 따른다. 별도의 법정 보유기간은 이 변경에서 임의로 확정하지 않는다.

## 기존 데이터 주의

마이그레이션 이전 `preregistrations` 행은 이메일 소유권 증거가 없으므로 자동으로 verified 처리하지 않는다. 공개 카운트와 운영 신청 목록은 `email_verified_at IS NOT NULL`인 새 행만 사용한다. 기존 행의 보유 필요성·연락 적법성·삭제 여부는 별도 개인정보 검토와 승인 없이 추정하지 않는다.
