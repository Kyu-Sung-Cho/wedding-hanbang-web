# GitHub 저장소 보안 통제 상태 (2026-08-03)

대상: private 저장소 `Kyu-Sung-Cho/wedding-hanbang-web`

이 문서는 코드의 보안성과 별개인 GitHub 계정·병합·Actions·보안 탐지 통제의 현재
상태를 기록한다. 저장소를 public으로 바꾸는 방식으로 기능 제한을 우회하지 않는다.

## 이번 세션에서 실제 적용한 설정

GitHub REST API의 적용 후 조회 결과로 다음을 확인했다.

- Dependabot vulnerability alerts: 활성, 조회 응답 `204 No Content`
- Dependabot automated security fixes: 활성, 조회 응답 `200 OK`
- Actions 허용 정책: `selected`
- GitHub 소유 Action: 허용
- verified creator Action: 허용
- 추가 허용 패턴: `pnpm/action-setup@*`
- Action SHA pinning: 필수
- 저장소의 현재 workflow Action은 모두 40자 commit SHA로 고정
- `.github/CODEOWNERS`: 기본·API·Auth·AI·Supabase·모바일 보안 경계를 현재 저장소
  소유자에게 라우팅

현재 필요한 Action은 `actions/checkout`, `actions/setup-node`,
`pnpm/action-setup`뿐이다. 새 외부 Action을 추가할 때는 allowlist를 넓히기 전에
publisher, source commit, 권한, 네트워크·secret 사용을 별도 검토하고 정확한 SHA로
고정한다.

## 아직 강제되지 않는 통제

2026-08-03 API 조회에서 다음 상태를 확인했다.

- `main` branch protection: 없음
- repository ruleset: 없음
- CODEOWNERS required review: enforcement 없음
- Preview/Production environment reviewer와 deployment branch policy: 없음
- GitHub code scanning: private 저장소의 현재 플랜/기능에서 사용 불가 응답
- GitHub secret scanning: 활성 증거 없음
- 현재 collaborator: 1명

따라서 CODEOWNERS는 review 요청을 돕지만 direct push나 self-merge를 막는 통제가
아니다. 소유자 계정 또는 `repo` 범위 토큰 탈취, 혹은 CI 실패를 무시한 실수는 여전히
main과 배포 경계에 도달할 수 있다.

## 다음 필수 설정

private 저장소에서 ruleset·보안 스캔을 지원하는 플랜과 최소 두 명의 독립 검토자를
준비한 뒤 다음을 설정한다.

1. `main`에 pull request 필수, stale approval 해제, conversation resolution,
   force-push/delete 금지, 관리자 포함 적용을 설정한다.
2. 실제 코드 파손 신호인
   `Code Quality (breakage signal only — not a release authorization)`를 required
   check로 지정한다. 항상 실패하도록 설계된 `Production Readiness`를 required로
   잘못 지정하지 않는다.
3. 승인 1명 이상을 요구하기 전에 두 번째 독립 collaborator/team을 추가한다. 현재
   1인 상태에서 승인 1명을 강제하면 정상 릴리스도 영구 차단된다.
4. Production environment에는 독립 reviewer와 `main`만 허용하는 deployment branch
   policy를 설정한다. Preview와 Production secret scope를 분리한다.
5. code scanning과 secret scanning을 활성화하고, 활성화 전까지는 별도의 reviewed
   CI scanner를 도입한다. 새 scanner 자체의 공급망 위험도 SHA pinning과 최소 권한으로
   검토한다.
6. Vercel에서 GitHub 코드 검사가 실패한 커밋을 Production으로 승격할 수 없도록
   deployment authorization을 별도로 검증한다.

## 재확인 명령

아래 명령은 값 자체가 비밀이 아닌 설정 상태만 읽는다.

```powershell
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/actions/permissions
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/actions/permissions/selected-actions
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/vulnerability-alerts --include
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/automated-security-fixes --include
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/rulesets
gh api repos/Kyu-Sung-Cho/wedding-hanbang-web/branches/main/protection
```

토큰 scope, Actions secret, 환경변수 값, 보안 경고의 취약 패키지 외 사용자 데이터는
로그·문서·PR에 복사하지 않는다.
