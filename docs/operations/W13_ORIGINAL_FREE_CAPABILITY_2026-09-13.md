# W13 — 원본 없는 GitHub Linux 제어 검사

`.github/workflows/w13-original-free-capability.yml`은 main의 수동 실행 전용이다.
코드 검토·정상 PR 반영 뒤 운영 담당자가 1회 실행하고 실제 job 결과를 기록한다.
현재 문서는 실행 성공이나 고객 원본 반입 승인이 아니다.

- 기존 private 저장소의 표준 `ubuntu-24.04` VM을 사용한다. 새 호스트·요금제·지출 한도를 만들지 않는다. 포함 분수 소진 시 실행 시간에 따른 과금은 가능하다.
- checkout·의존성 설치·secret·캐시·artifact 업로드·DB·서비스 이미지·고객 자료를 사용하지 않는다. 이미 성공한 Stage B 서비스 기동 검사는 반복하지 않는다.
- 임시 job VM 안에서 swap을 해제하고 별도 mount/net/PID namespace를 만든다. loopback 왕복과 외부 IPv4/IPv6 TCP·DNS UDP 거절, tmpfs 권한, 프로세스 core/dump 제한, 실제 8MiB memory lock/dont-dump/unlock을 확인한다.
- 전체 job은 10분, swap 해제는30초, namespace는180초 제한이다. 하위 timeout은 TERM 후5초 KILL 유예를 둔다. 자신이 만든 합성 파일을 제거하고 namespace를 종료한다.
- 성공 판정은 JSON의 모든 검사, namespace 종료 marker, 실제 job success가 모두 있어야 한다. 실패는 원인을 기록하며 자동 재실행하지 않는다.

8MiB 결과는 전체 원본 용량·DB/Auth/Storage 복원·공급자의 host/hypervisor 보호를 입증하지 않는다.
`sourceDataIncluded=false`, `fullRestoreVerified=false`, `originalDataAdmissionAllowed=false`를 유지한다.
원본 반입 전에는 현재 source/ledger 수집 successor, 암호화 전달·키 경계, 전체 복원/대조 실행기와
공급자 처리 계약·보관/삭제·고지 범위를 별도로 검토한다. GitHub를 코드 CI에 사용한다는 사실만으로
고객 원본 복원 처리자로 승인하지 않으며, 이 검사 때문에 개인정보 처리방침을 미리 변경하지 않는다.

공식 근거: [runner 사양·sudo](https://docs.github.com/en/actions/reference/runners/github-hosted-runners),
[Actions 과금](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[workflow·secret 보안](https://docs.github.com/en/actions/reference/security/secure-use),
[적용 계약 목록](https://github.com/customer-terms).
