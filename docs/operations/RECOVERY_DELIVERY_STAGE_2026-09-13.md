# W13 복구 실행기 — 현재 구현과 원본 반입의 남은 경계

최초 구현 기준 소스는 `17fd807a`이며 전용 `codex/recovery-delivery-20260913`에서 작업했다. **최신 재검토는 `d7f7599aba289066b246c19220ba55627331ab0c` 이후 `codex/launch-remaining-integrity-20260913`에서 수행했다. W13 전체 원본 복구는 여전히 미완료다.** 고객 원본 수집·원격 복원·서비스 정지·새 유료 리소스·OS 설정 변경은 없다. 기존 전체 복구 controller와 역사적인 capture 계약의 핀은 변경하지 않았다.

## 최신 재검토에서 닫은 코드 결함

검증된 archive Buffer는 수정 가능한 메모리였다. 반환 후 또는 pre-restore checkpoint를 기다리는 동안 내용이 바뀌어도 기존 실행기는 초기 검증 결과만 믿고 `pg_restore`에 전달할 수 있었다. `assertRecoveryArchiveBytes`로 대상 연결 전과 checkpoint 이후 native 실행 직전에 길이·PGDMP 헤더·SHA를 다시 확인한다. archive 메타데이터와 반환 묶음의 바깥 객체를 모두 동결하고 source/candidate binding은 독립 복사 후 동결해 속성 교체·외부 객체 수정이 검증된 결합을 바꾸지 못하게 했다. Buffer를 지우는 dispose는 그대로 동작하며 Base64 원문을 불필요하게 복사하지 않는다.

관련 artifact 검사 **9개 PASS**: 기존 6개에 반환 후 바이트 변조·binding 변경, dispose 이후 재사용 차단, checkpoint 대기 중 변조를 추가했다. 마지막 검사는 실제 stage 함수를 호출하고 DB client만 모의하여 checkpoint 도달 후 archive를 바꿨을 때 native 호출 0·restoreAttempted=false를 확인한다. 새 DB 주입 옵션을 제품 코드에 추가하지 않았다. 변경한 세 파일 ESLint와 `git diff --check`를 확인했다. 루트에는 ESLint 실행 파일이 없어 웹 패키지에 설치된 실행 파일과 실제 설정을 지정했으며, 모노레포 루트에서 React/pages 탐색 경고 2개가 발생했지만 lint 오류는 없었다. 새 PG cluster, VM 부팅 또는 기존 전체 합성 seed 시험은 재실행하지 않았다. 이것은 전체 복구 성공 증거가 아니다.

## 지금 가능한 일과 실제 환경 결정이 필요한 일

현재 읽기 재확인에서도 WSL/VirtualMachinePlatform/Hyper-V는 모두 `InstallState=2`, Docker/Podman 명령은 없었다. 공개 Management API 원문과 공식 문서를 다시 확인했으나, 기존 hosted `tvyblzioajnfsbkciubk`의 DB를 복원 가능하게 둔 채 Auth/Storage/API의 전체 외부 접근과 host 송신을 차단·관측하는 공개 계약은 찾지 못했다. DB IP 제한과 PrivateLink는 HTTPS Auth·Storage·API·Realtime을 포함하지 않는다. [Network Restrictions](https://supabase.com/docs/guides/platform/network-restrictions), [PrivateLink](https://supabase.com/docs/guides/platform/privatelink).

대상의 08:28/08:31 UTC 실제 postgres 권한·빈 상태 조회와 서비스 설정 GET은 기존 증거를 재사용했다. 이번에 대상의 현재 상태나 설정 변경 권한을 새로 관측한 것으로 표현하지 않는다. 기존 결과상 managed Auth/Storage owner로 SET할 수 없고, 별도 superuser 서비스 연결은 일반 CONNECT ACL만으로 중지할 수 없다. 공급자의 전체 서비스 차단 기능을 확인하지 않고 부분 설정을 여러 번 적용하는 것은 이 경계를 닫지 못한다. [상세 hosted 제어 계약](C:/Users/kcho1/.codex/visualizations/launch-closeout-20260913/W13_HOSTED_CONTROL_DECISION_2026-09-13.md).

따라서 현재 제약(새 유료 호스트·OS 설치·불안전한 원본 반입 없음) 아래에서는 **완료 가능한 것은 로컬 실행기의 구체적인 결함 수정까지**다. 다음 구현에 필요한 결정은 기존에 사용 가능한 복원 전용 호스트의 지정 또는 동등한 서비스·네트워크 제어 권한 확보다. Linux만 유일한 해법이라고 단정하지 않으며, 이미 준비된 Windows QEMU의 원본 없는 부팅 성공도 원본 보호 증거로 승격하지 않는다. 호스트가 지정되면 현재 231 SQL·실제 원장·수동 ACL을 설명하는 수집 successor, 암호화 전달, 관리 schema/globals 처리, Auth/Storage 원본 복원 및 실제 읽기 비교, 삭제 ledger 재적용을 순서대로 이어야 한다. 이 문서나 새 boolean으로 원본 admission을 열지 않는다.

## 이번에 실제 구현·실행한 부분

- `scripts/lib/recovery-artifact-set.mjs`: 기존 producer의 전체 manifest, 같은 backupSet/source/candidate, archive envelope, schema/globals, 각 관계와 Storage 원본의 길이·SHA·범위를 재검증한다. 누락·중복·경로 탈출·다른 backupSet·파일 변조를 거절한다. bigint가 반올림되지 않도록 관계 원문 Buffer의 SHA를 사용한다.
- `scripts/lib/recovery-database-stage.mjs`: 별도 system identifier의 빈 loopback 전용 DB에서 실제 `pg_restore --exit-on-error --single-transaction`을 실행한다. owner/ACL/trigger를 제외하지 않는다. 시작 전 대상 identity·빈 상태·필요 역할과 checkpoint를 확인하고 복원 뒤 모든 수집된 durable relation을 같은 producer SQL로 다시 읽어 원문 SHA를 대조한다. 실패 시 대상이 바뀌었을 가능성을 남기며 자동 삭제/재실행하지 않는다.
- 현재 executor는 고정 synthetic source만 받는다. 원본 입출력 transport·실제 서비스 격리가 준비되지 않은 상태에서 일반 고객을 처리하는 옵션은 없다. manifest의 `releaseAuthorized:true` 같은 값으로 활성화할 수 없다. `scripts/recovery-delivery.mjs --help`는 옛 baseline loader나 인증값에 접근하지 않고 구현 범위만 출력한다.

**실제 검증:** artifact/범위/CLI 검사 6개 PASS, 이번 executor 전용 native 통합 1개 PASS(약 16.3초). 통합 검사는 새 합성 PG17 source/target 두 cluster를 사용해 2개 관계의 bigint·numeric·sequence 원문을 복원·대조했다. 잘못된 대상, 이미 데이터가 있는 대상, 파괴 전 checkpoint 실패, native 실패의 부분 상태 보존도 확인했다. 두 소유 프로세스·임시 cluster는 종료/정리했다. 기존 native snapshot 5개나 VM seed 검사를 다시 실행한 결과가 아니다.

```powershell
corepack pnpm exec node --test scripts/tests/recovery-artifact-set.test.mjs
corepack pnpm exec node --test scripts/tests/recovery-database-stage-native.test.mjs
node scripts/recovery-delivery.mjs --help
```

이 결과는 DB 실행 단계의 합성 검증이다. Auth 로그인·refresh, Storage API/S3/CDN의 실제 파일 복원, 전체 schema/globals 비교, 삭제 ledger 재적용은 수행하지 않았다. 출력의 `fullRestoreVerified`와 `releaseAuthorized`는 계속 false다. 암호화 원본의 DPAPI 수신·복호화·실제 admission producer 역시 아직 연결하지 않았다.

## 현재 원본을 받을 대상이 없는 이유와 현실적인 다음 선택

오늘 읽기 확인에서도 Windows의 WSL/VirtualMachinePlatform/Hyper-V는 `InstallState=2`였고 Docker 명령은 발견하지 못했다. native PG17에는 기존 관측대로 운영 확장과 Auth/Storage 서비스가 부족하다. 따라서 native 합성 복원을 전체 Supabase 복구 성공으로 승격할 수 없다. QEMU의 원본 없는 부팅 성공은 승계하며 재실행하지 않았다. `dump-guest-core=off` 미지원과 host 메모리·덤프·암호화 경계 미검증은 원본 admission에 그대로 남는다.

가장 작은 현실적 선택은 **운영자의 기존 Linux 호스트 또는 설치 승인된 WSL2/Docker 환경** 하나를 복원 전용으로 고정하는 것이다. 현재 사용할 수 있는 그런 호스트를 확인한 사실은 없다. 기존 공식 image/compose pin을 재사용하되 원본을 넣기 전에 DB/Auth/Storage 서비스, 관리 schema·확장·역할 호환, ingress/egress·SMTP·서명키·원본 전송/메모리/디스크 보호를 실제 확인한다. 현재 Windows QEMU를 불가능하다고 일반화하지 않지만, 같은 부팅 검사를 반복해서 이 보호를 확인한 것으로 바꾸지 않는다. 기존 hosted 빈 대상은 HTTPS Auth/Storage와 송신 통제가 미검증이므로 원본 대상으로 자동 선택하지 않는다.

## 현재 capture successor와 전체 복구에서 남은 정확한 일

1. 옛 archive collector는 215/227 SQL로 고정된 계약을 인자 해석 전에 읽어 후속 SQL에서 도움말도 거절한다. 새 executor 도움말은 이 의존성이 없지만 **현재 원본 collector를 복구한 것은 아니다**. 향후 별도 successor는 신선한 전체 catalog/ledger와 검토한 추가 SQL·수동 ACL 변경을 정확하게 연결해야 한다. 임의 최신 파일 전체를 allowlist로 승인하거나 역사 계약의 count/hash를 덮지 않는다.
2. 원본과 대상의 실제 보호가 확인된 뒤 같은 snapshot/backupSet의 custom archive·schema/globals·모든 관계·Storage bytes를 기존 두 snapshot 비교와 DPAPI로 수집한다. 운영 쓰기/업로드 안정성은 실제 작업창과 기존 fence 경계로 다룬다. 이 문서로 고객 수집을 승인하지 않는다.
3. 새 DB stage를 승인된 private transport와 target admission에 연결하고, 호환 서비스용 globals/bootstrap 충돌 처리·Storage 원본 복원 및 읽기 대조·Auth 동작·삭제 replay를 추가한다. DB row hash와 Storage 객체 메타데이터만으로 실제 파일/서비스 복원을 완료 처리하지 않는다.

공식 근거: [PostgreSQL pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html)는 archive가 실행 코드도 포함하므로 단순 target URL 분리만으로 충분하지 않다고 설명한다. [Supabase Storage v1.74.0 FileBackend](https://github.com/supabase/storage/blob/v1.74.0/src/storage/backend/file.ts)는 버전별 물리 경로와 파일 메타데이터를 사용한다. 다운로드 원본을 임의 폴더에 쓰는 것을 Storage 복원으로 구현하지 않았다. [기존 W13 상태](C:/Users/kcho1/.codex/visualizations/launch-closeout-20260913/W13_BASIC_RECOVERY_STATUS.md)의 실제 백업 metadata 관측과 원본 미복구 판정을 유지한다.
