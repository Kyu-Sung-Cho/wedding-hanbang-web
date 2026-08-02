# Password-change security gate

비밀번호 변경은 탈취된 세션을 장기 계정 탈취로 바꿀 수 있는 보안 경계다. 저장소 설정과
앱 구현만으로 hosted Supabase 설정이 적용됐다고 간주하지 않는다.

## 저장소 계약

- `supabase/config.toml`
  - `minimum_password_length = 8`
  - `password_requirements = "lower_upper_letters_digits_symbols"`
  - `auth.email.secure_password_change = true`
  - `auth.email.notification.password_changed.enabled = true`
- 모바일 설정 화면은 현재 비밀번호와 `reauthenticate()`로 받은 이메일/전화 nonce를 모두
  요구하고 `updateUser({ current_password, password, nonce })`에 포함한다.
- Supabase의 `secure_password_change`는 세션이 없거나 로그인 후 24시간이 지난 경우에만
  서버에서 nonce를 강제한다. 모바일 UI는 세션 나이와 관계없이 항상 nonce를 요구하지만,
  최근 세션을 가진 직접 API 클라이언트까지 막으려면 hosted Auth의 별도
  `require current password` 설정과 `current_password` 입력 경계를 함께 검증해야 한다.
- 변경 성공 후 기본 `global` scope 로그아웃 경계를 호출해 모든 refresh session을 철회한다.
  이미 발급된 access JWT는 만료 시점까지 유효할 수 있으므로 현재 1시간 JWT 만료 계약도
  함께 유지한다.
- 복구 링크를 통한 웹 비밀번호 재설정은 검증된 일회용 recovery session을 사용하고 변경 후
  global logout을 수행한다.

근거: [Supabase password security](https://supabase.com/docs/guides/auth/password-security),
[Supabase sessions](https://supabase.com/docs/guides/auth/sessions),
[Supabase sign-out scopes](https://supabase.com/docs/guides/auth/signout).

## Hosted 배포 차단 조건

아래 증거가 모두 없으면 비밀번호 변경 기능과 신규 production 배포를 `BLOCKED`로 둔다.

1. 승인된 운영자가 대상 project ref를 재확인한 뒤 Auth 설정을 적용한다. 로컬
   `config.toml` 변경은 hosted 적용 증거가 아니다.
2. hosted Auth 설정 캡처 또는 Management API의 비밀값 제외 export로 네 가지 저장소 계약이
   실제 값과 일치함을 확인한다.
3. production SMTP가 reauthentication OTP와 password-changed notification을 모두 전달하는지
   별도로 모니터링하고 테스트한다. Supabase Auth는 password-changed 알림 전송이 실패해도
   비밀번호 변경 트랜잭션을 되돌리지 않는 best-effort 동작이므로, 알림 성공을 변경 성공의
   원자적 조건으로 간주하지 않는다. SMTP 수신 증거와 실패 경보가 없으면 릴리스를 차단한다.
4. 별도 테스트 계정과 직접 Auth API로 다음을 검증한다.
   - 7자 이하 또는 필수 문자군이 빠진 비밀번호는 거절된다.
   - 로그인 후 24시간이 지난 세션의 nonce 없는 변경은 거절된다.
   - 로그인 후 24시간 이내 세션은 `secure_password_change`만으로 nonce가 강제되지 않음을
     확인하고, 별도 `require current password` 설정을 켠 경우 올바른 `current_password` 없이는
     변경이 거절되는지 검증한다.
   - 잘못된 nonce, 만료 nonce, 재사용 nonce는 거절된다.
   - 올바른 nonce 한 번만 성공하며 password-changed 알림이 도착한다.
   - 변경 전 다른 기기의 refresh session은 더 이상 갱신되지 않는다.
   - 기존 access JWT는 최대 설정 만료 시간까지만 남고, 민감 API가 더 강한 즉시 철회 보장을
     요구한다면 `session_id` 존재 검증을 별도 적용한다.
5. 이메일/전화가 없는 OAuth-only 계정은 OTP를 받을 수 없으므로, 해당 계정 유형의 안전한
   provider 재인증 UX가 검증되기 전에는 비밀번호 추가/변경 UI를 노출하지 않는다.
6. hosted `Require current password when changing password`를 켜고 비밀번호를 이미 가진 계정은
   올바른 현재 비밀번호 없이는 최근 세션에서도 변경할 수 없음을 검증한다. 모바일은 현재
   비밀번호를 별도 보안 입력으로 받아 `current_password`로 전달한다. OAuth-only 계정의 최초
   비밀번호 설정과 충돌하지 않는지도 직접 API로 검증한다. 이 옵션은 저장소의
   `secure_password_change`와 다른 서버 경계이므로 `config.toml`만으로 적용됐다고 주장하지 않는다.

운영 설정 변경, 실제 메일 수신, 오래된 세션·다기기 검증 결과에는 실행 일시, 대상 환경,
담당자, 비밀값을 제거한 응답, 기대 결과와 실제 결과를 남긴다.
