# Windows 릴리스 호스트 실행 파일 검증 — 2026-09-11

배포 준비 중 현재 System32 PowerShell이 이전 정확한 바이트 핀과 달라 정식 컨트롤러가 `PRODUCTION_TOOLCHAIN_INVALID`로 거절했다. 실행 파일의 검증을 생략하지 않고 현재 Windows 구성요소를 독립적으로 확인했다.

- 경로: `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`.
- 현재 SHA-256: `8BB6FA8C283B4D92120B1EF249A9B311B0F804D4CABBE9981159976C8BE76A5E`, 495,616 bytes, AMD64 PE `8664`.
- Authenticode: `Valid`, 서명자 `CN=Microsoft Windows, O=Microsoft Corporation, L=Redmond, S=Washington, C=US`, thumbprint `DC91E564D5BC1E3A8E02D6A8508682ABEA8A2443`.
- `fsutil hardlink list`는 위 실행 파일이 WinSxS의 `amd64_microsoft-windows-powershell-exe_31bf3856ad364e35_10.0.26100.9278_none_04f3d8c2b22390e6\powershell.exe`와 같은 파일임을 확인했다. 해당 구성요소 원본도 같은 hash·Microsoft 유효 서명이다.
- 실제 `-NoProfile -NonInteractive` 실행은 Desktop PowerShell `5.1.26100.9444`, 64비트로 응답했다. 로컬화된 VersionInfo의 `10.0.26100.8875`만으로 구성요소 버전을 판정하지 않았다.
- 이전 `7600FFE12DA441FE89D035B13801E8E91D064BC544A27B19A5CF49F6AB8B18F5`는 보존된 WinSxS `10.0.26100.8875`의 454,656-byte 파일과 일치한다. 이전 파일을 System32로 되돌리지 않는다.

`production-windows-toolchain.mjs`의 PowerShell hash 한 개만 현재 검증한 값으로 갱신했다. Git 핀, 표준 경로, 열기 전후 파일 일치 검사, symlink 거절, Windows 루트 검사, 암호화·백업·릴리스·canary 조건은 유지한다. 임의의 서명된 실행 파일이나 환경변수로 지정한 파일을 허용하는 일반 예외를 추가하지 않는다. 과거 핀은 이전 Git 이력에 보존된다.

검증 범위는 현재 Microsoft 서명·구성요소 hardlink·실행 응답이며, 특정 Windows Update KB의 설치 원인을 추정하지 않는다. 이 도구 검증 자체는 DB 적용이나 운영 배포 성공이 아니다.
