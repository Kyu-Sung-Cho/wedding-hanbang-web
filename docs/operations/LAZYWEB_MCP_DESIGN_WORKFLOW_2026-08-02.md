# Lazyweb MCP 디자인 조사 런북 — 2026-08-02

> [!IMPORTANT]
> **상태: 선택적 MACHINE-LOCAL 개발 도구 / 제품·릴리스 정본 아님**
>
> Lazyweb은 실제 제품 화면 사례와 디자인 보고서를 찾는 보조 도구다. 웨딩한방의
> 제품 계약, 사실 주장, 개인정보 기준, 배포 상태를 대신 결정하지 않는다. 결과는
> `PRINCIPLES.md`, `DESIGN.md`, 현재 코드와 실제 사용자 검증을 다시 통과해야 한다.

## 1. 이번 컴퓨터에서 확인한 기준

2026-08-02에 다음 항목을 직접 확인했다.

| 항목 | 확인한 값 |
|---|---|
| MCP endpoint | `https://www.lazyweb.com/mcp` |
| skill pack | `v0.14.9` |
| 설치에 사용한 공개 source commit | `b4b9dce613ba9cc0f34bff400eaa9d33b86a82ad` |
| 공개 source | `https://github.com/aboul3ata/lazyweb-skill` |
| 인증 환경변수 이름 | `LAZYWEB_MCP_TOKEN` |
| MCP 상태 | `healthy` |
| live tool 수 | 32개 |
| workflow discovery | `lazyweb_get_workflows` 성공 |
| Codex autorouter | global Codex instruction에 `v0.14.9` 설치·마커 검증 |

토큰 값, 사용자별 setup URL, Authorization header, Codex global config와 설치된 skill
파일은 저장소에 포함하지 않았다. 위 확인은 이 컴퓨터의 로컬 설정 사실이며 새
컴퓨터에 자동 복제되지 않는다.

## 2. Git으로 이동하는 것과 이동하지 않는 것

| 구분 | 위치 | GitHub 포함 |
|---|---|---|
| 이 런북과 제품 코드 | repository | 포함 |
| MCP server 이름과 env 변수 이름 | 이 문서 | 포함 |
| bearer token 값 | Windows user environment | **금지** |
| MCP client config | `~/.codex/config.toml` | **금지** |
| 설치된 skills | `~/.codex/skills/lazyweb*` | **금지** |
| autorouter와 manifest | `~/.codex/AGENTS.md`, `~/.lazyweb/` | **금지** |
| 화면 캡처·base64·signed upload URL | repository `/.lazyweb/` 또는 로컬 temp | **금지** |
| hosted report URL·raw MCP JSON | 세션 결과 또는 승인된 별도 기록 | 기본 **금지** |

`/.lazyweb/`과 `/artifacts/`는 `.gitignore` 대상이다. 다른 컴퓨터에서는 필요한 공개
화면을 다시 실행해 캡처한다. 인증된 화면, 커플 대화, 개인정보, 운영 관리자 화면은
Lazyweb에 업로드하지 않는다.

## 3. 새 Windows 컴퓨터에 설치

### 3.1 비밀값 준비

공개 Git이나 이 문서에서 토큰을 찾지 않는다. 승인된 private setup 경로에서 받은
값을 PowerShell의 대화형 입력으로 사용자 환경변수에 저장한다.

```powershell
$lazywebToken = Read-Host "Lazyweb MCP token"
[Environment]::SetEnvironmentVariable(
  "LAZYWEB_MCP_TOKEN",
  $lazywebToken,
  "User"
)
Remove-Variable lazywebToken
```

토큰을 명령 인자, shell history, `.env.local`, Markdown 또는 PR 본문에 직접 쓰지 않는다.
새 터미널과 Codex 앱은 환경변수 저장 뒤 다시 연다.

### 3.2 MCP 등록

Codex CLI가 설치된 새 터미널에서 실행한다.

```powershell
codex mcp add lazyweb `
  --url https://www.lazyweb.com/mcp `
  --bearer-token-env-var LAZYWEB_MCP_TOKEN
codex mcp get lazyweb
```

정상 결과는 URL과 `bearer_token_env_var = LAZYWEB_MCP_TOKEN`만 보여야 한다. raw token이
config에 들어가면 안 된다. 로컬 Codex 설정 문법 오류가 있으면 현재 CLI가 지원하는
값으로 그 오류를 먼저 고치고, 다른 컴퓨터의 `config.toml` 전체를 복사하지 않는다.

### 3.3 skills 설치

Codex의 기본 `skill-installer`에 공개 저장소와 위 source commit을 주고 root skill과
아래 user-facing mode를 설치하도록 요청한다.

- `lazyweb`
- `lazyweb-design`
- `lazyweb-quick-search`
- `lazyweb-growth-experiments`
- `lazyweb-apply-design-best-practices`
- `lazyweb-explain-flow`
- `lazyweb-propose-ui-changes`
- `lazyweb-update`

설치 후 Codex 앱을 다시 시작한다. 공개 설치 스크립트를 shell에 pipe하는 방법은 그
스크립트를 검토하고 사용자가 명시적으로 승인한 경우에만 사용한다.

### 3.4 Codex autorouter

Autorouter는 global instruction 파일을 수정한다. 새 컴퓨터에서도 사용자의 별도 동의를
받은 뒤 Codex host에만 설치한다. Git Bash 기본 설치 경로를 사용하는 예시는 다음과 같다.

```powershell
$routerPath = "$(($env:USERPROFILE -replace '\\', '/'))/.codex/skills/lazyweb/bin/lazyweb-router"
& 'C:\Program Files\Git\bin\bash.exe' $routerPath install --host codex --yes
& 'C:\Program Files\Git\bin\bash.exe' $routerPath status
```

`--all`은 Claude 등 다른 agent의 global instruction까지 바꿀 수 있으므로 사용하지 않는다.
프로젝트의 `AGENTS.md`나 `CLAUDE.md`에 autorouter marker를 복사하지 않는다.

## 4. 설치 검증

Codex를 다시 열고 다음 순서로 확인한다.

1. `lazyweb_health`가 `healthy`를 반환한다.
2. live tool 목록에 `lazyweb_get_workflows`가 있다.
3. `lazyweb_get_workflows`의 list 작업이 성공한다.
4. 공개 UI 사례 검색 또는 공개 테스트 화면 보고서가 실제 data-bearing 응답을 준다.

MCP 연결 성공과 data-bearing 도구 사용 권한은 별개다. 다음 응답은 재시도하거나 웹
검색으로 우회하지 않고 서버 메시지와 안내 링크를 사용자에게 전달한 뒤 중단한다.

- `MCP_PRO_REQUIRED`
- `FREE_REPORT_DAILY_LIMIT`
- `status: "locked_preview"`

## 5. 웨딩한방 UI 작업 라우팅

| 요청 | 사용할 mode |
|---|---|
| 기존 랜딩·온보딩·대시보드 개선, 비평, 재디자인 | `lazyweb-design` |
| 사용자가 명시적으로 몇 개 사례만 빠르게 요청 | `lazyweb-quick-search` |
| 가격·유료 전환·A/B 실험 근거 조사 | `lazyweb-growth-experiments` |
| 타이포·색상·접근성 등 특정 craft 지침 | `lazyweb-apply-design-best-practices` |

기존 화면 개선에는 실제 현재 화면 캡처가 필요하다. 랜딩 전체를 한 번에 뭉뚱그려
검색하지 않고 hero, 작동 방식, 신뢰, CTA처럼 판단 단위가 다른 섹션을 구분한다.
Lazyweb 사례는 관찰된 패턴이나 실험 맥락이지 웨딩한방의 전환 성과 보장이 아니다.

## 6. 공개 랜딩 디자인 보고서 절차

1. `corepack pnpm dev:web`으로 현재 branch를 실행한다.
2. `http://localhost:3000/landing`이 200으로 열리는지 확인한다.
3. desktop과 mobile 현재 화면을 `/.lazyweb/` 아래에 로컬 캡처한다.
4. 공개 화면이며 개인정보가 없음을 다시 확인한다.
5. `lazyweb-design`의 `objective: improve`, `platform: web`,
   `screen_type: landing`으로 보고서를 생성한다.
6. 보고서 제안을 `PRINCIPLES.md`, `DESIGN.md`, 공공 주장 테스트와 대조한다.
7. 검증되지 않은 통계·후기·가격·무료 보장·성과 보장·제휴·중개 주장은 버린다.
8. 채택한 변경만 코드에 반영하고 landing test, typecheck, browser QA를 다시 실행한다.

2026-08-02에는 현재 `/landing`의 공개 desktop 화면을 직접 캡처해 이 절차로 보고서를
완료했다. 무료 플랜에서 4개 중 1개 변형이 제공됐고 생성 실패나 degraded slot은 없었다.
보고서가 우선 지적한 항목은 첫 viewport의 초점, 일반 채팅이 아니라 정리 결과가 보이는
제품 증거, hero 본문 압축이었다.

현재 구현은 이미 `좌측 메시지·주 CTA + 우측 제품 mockup`, text-link 보조 CTA,
대화에서 찾은 예산·할 일·일정 결과 preview를 포함한다. 따라서 구조를 다시 뒤집지 않고
이 계약을 회귀 기준으로 유지한다. 공개 hero에 즉시 입력창을 넣는 제안은 입력·AI 호출의
privacy 경계와 제품 흐름을 새로 결정해야 하므로 이번 source snapshot에는 채택하지
않았다. 채팅을 완전히 아래로 내리는 제안도 “말하면 정리된다”는 실제 작동 방식을
숨길 수 있어 채택하지 않았다.

보고서 URL과 입력 캡처는 외부·로컬 실행 증거이므로 Git source에 넣지 않는다. 코드에
반영하거나 유지하기로 한 결과만 테스트와 함께 저장한다.

## 7. 제거와 복구

MCP 등록을 제거할 때는 현재 Codex CLI의 `codex mcp remove lazyweb`을 사용한다.
Autorouter만 제거할 때는 다음 명령을 사용한다.

```powershell
$routerPath = "$(($env:USERPROFILE -replace '\\', '/'))/.codex/skills/lazyweb/bin/lazyweb-router"
& 'C:\Program Files\Git\bin\bash.exe' $routerPath remove --host codex
```

토큰이 노출됐다고 의심되면 Git history에서 감추는 것만으로 끝내지 않는다. Lazyweb에서
credential을 폐기·재발급하고 Windows user environment의 값을 교체한 뒤, 노출 범위를
별도로 감사한다.
