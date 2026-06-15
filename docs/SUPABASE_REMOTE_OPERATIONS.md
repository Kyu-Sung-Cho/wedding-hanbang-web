# Supabase Remote Operations

## Recommended Safe Flow

For production or shared Supabase projects, use the guarded automation first:

```powershell
pnpm supabase:ship:safe
```

This command runs local checks, asks for the database password only inside the current PowerShell session, dry-runs pending migrations, requires typing `APPLY`, pushes migrations, and then runs the anonymous security probe.

Use the manual steps below only when debugging the safe flow or when a maintainer explicitly asks for a specific Supabase CLI command.

이 문서는 원격 Supabase 프로덕션 DB에 마이그레이션을 적용할 때 쓰는 최소 안전 절차다.

## 준비물

- Supabase personal access token
- Supabase project ref
- Supabase Database password

비밀값은 Git에 커밋하지 않는다. `.env.local`, 문서, 이슈, 채팅에 토큰이나 DB 비밀번호를 남기지 않는다.

## 1. CLI 확인

```powershell
pnpm supabase:version
```

## 2. Supabase 로그인

Supabase Dashboard에서 personal access token을 만든 뒤 현재 PowerShell 세션에만 넣는다.

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<personal-access-token>"
pnpm supabase:login -- --token $env:SUPABASE_ACCESS_TOKEN --name hanbang-prod
```

## 3. 원격 프로젝트 연결

`project-ref`는 Supabase URL의 `<project-ref>.supabase.co` 부분이다.

```powershell
$env:SUPABASE_DB_PASSWORD = "<database-password>"
pnpm supabase:link -- --project-ref <project-ref> --password "$env:SUPABASE_DB_PASSWORD"
```

## 4. 적용 전 상태 확인

```powershell
pnpm supabase:migrations -- --password "$env:SUPABASE_DB_PASSWORD"
pnpm supabase:push:dry -- --password "$env:SUPABASE_DB_PASSWORD"
```

`push:dry` 출력에서 적용될 마이그레이션 목록이 예상과 다르면 멈춘다.

## 5. 원격 적용

```powershell
pnpm supabase:push -- --password "$env:SUPABASE_DB_PASSWORD"
```

적용 후에는 anon key로 민감 테이블이 더 이상 읽히지 않는지 재검증한다.

## 운영 원칙

- 운영 DB에는 항상 `supabase:push:dry`를 먼저 실행한다.
- RLS/권한 변경은 새 migration 파일로만 적용한다.
- Supabase SQL Editor에서 직접 수정한 경우, 반드시 같은 SQL을 migration 파일에도 남긴다.
- public Storage bucket을 private로 바꾸는 변경은 앱/웹 이미지 로딩 경로와 같이 배포한다.
- `supabase db reset --linked`, `migration repair`, `--include-all`은 별도 확인 없이 실행하지 않는다.
