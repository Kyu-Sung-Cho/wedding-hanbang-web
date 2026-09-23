# 웨딩코드 함께 보기: 239 충돌 응답 수정

## 발견한 문제와 수정 범위

238 적용 후 운영의 합성 방에서 첫 참여·동일 요청 재전송·양쪽 조회는 약 0.3초에 끝났지만, 이미 참여한 사람과 다른 참여자 토큰으로 요청하면 20초 제한을 두 번 넘었다. 이 관찰은 배포 담당자가 수행한 합성 검증의 기록이며 실제 소비자 사례를 뜻하지 않는다. 같은 충돌 조건의 소비자 요청도 영향을 받을 수 있다.

배포 담당자는 해당 합성 방의 공유를 철회하여 반복을 해소했고, 실행 중인 대상 RPC 0개·양쪽 답 삭제·모든 토큰의 closed 응답을 확인했다. 비공개 토큰과 답은 이 문서에 기록하지 않는다.

사용자 정의 오류 `40001`은 업무상 충돌을 표현하기에 부적절하다. Supabase는 PostgREST 14에서 이 SQLSTATE가 서버 내부의 무한 트랜잭션 재시도를 유발할 수 있으며, HTTP 409를 의도하면 `PT409`를 쓰라고 설명한다. 기본 오류 매핑도 `40* → HTTP 500`이다. [Supabase 공식 설명](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b), [PostgREST 오류 매핑](https://docs.postgrest.org/en/v14/references/errors.html), [upstream 수정 코드](https://github.com/PostgREST/postgrest/pull/4222/files).

239 SQL은 `create_wedding_code_pair_session`과 `join_wedding_code_pair_session` 본문의 세 업무 충돌만 `40001 → PT409`로 바꾼다. 외부 API는 기존 `409 / CONFLICT` 응답을 유지한다. 238 SQL·계약·runtime·catalog·기대 fixture는 고정 원문을 보존한다. 테이블 구조·RLS·권한·동의·만료·철회·정리 함수·cron·기존 행은 변경하지 않는다.

## 고정된 적용 경로

- SQL: `supabase/migrations/20260923132503_wedding_code_pair_session_conflict_response.sql`.
- 명시 모드: `--wedding-code-pair-session-conflict`.
- release: `wedding-code-pair-session-conflict-20260923`.
- 계약: `supabase/release-contracts/wedding-code-pair-session-conflict-v1.json`.
- 목적지: 프로젝트 `slrtobkksjmxgzatjyqb`, PostgreSQL 17, system identifier `7581440907192989109`, `postgres` DB/role.

새 공개 loader는 239개 SQL 전부와 선행 핀을 검사한다. 238 공개 loader는 239 checkout을 계속 거절하며, 후속 체인을 위한 역사 loader만 고정된 238 원문을 검증한다. 역사 fixture는 고정된 선행 원문을 쌓으며 현재 디렉터리에서 임의로 파일을 제외하지 않는다. production build fence는 새 계약이 있으면 먼저 검증하고 실패 시 238로 되돌아가지 않는다. 기존 소유자 승인값 요구는 유지한다.

1. `node scripts/supabase-release-fence.mjs --wedding-code-pair-session-conflict`로 정적 계약을 확인한다. 통과는 운영 적용이나 운영 승인 증거가 아니다.
2. 새 외부 receipt 경로로 `--inspect`를 실행하여 238 ledger·기대 catalog·대상·권한을 확인한다.
3. `--rehearse`는 동일한 실제 SQL과 ledger 추가를 실행한 뒤 ROLLBACK하고 별도 조회로 원복을 확인한다. 기존 행이 있을 수 있으므로 빈 테이블 조건을 사용하지 않는다. 테이블 잠금 아래 적용 전후 행 동일성을 검사하며 답 원문을 영수증에 내보내지 않는다.
4. `--apply`는 새 관측과 자체 리허설·원복·소스 재검증을 거쳐 한 번 COMMIT하고 별도 조회로 검증한다. 이후 새로운 `--inspect` receipt에서 이미 적용된 상태를 확인한다.
5. API 변경을 배포한 뒤 새 합성 방에서 아래 HTTP 검증을 수행한다.

각 실행은 검토한 깨끗한 40자리 commit, 고정 프로젝트, 저장소 밖 새 절대 receipt 경로와 `--confirm-production=wedding-code-pair-session-conflict-20260923:<project>:<mode>:<commit>`을 요구한다. 범용 SQL 적용 인자나 직접 `db push` 우회는 제공하지 않는다. 적용 응답이 불명확하면 mutation을 재시도하지 않고 새 receipt로 읽기 전용 inspect부터 수행한다.

## 적용 후 확인할 결과

작성 시점에 아래 새 HTTP 검증은 미완료다. 성공한 실제 증거를 확인한 뒤 상태를 갱신한다.

- 첫 생성·첫 참여와 동일 요청 재전송은 정상 응답한다.
- 같은 방 생성 시 기존 답을 바꾸는 요청, 생성 요청의 소유자 키 변경, 같은 참여자의 답 변경, 다른 참여자의 추가 참여 요청 네 가지가 각각 15초 안에 HTTP 409 / CONFLICT로 끝난다.
- 정상 양쪽 조회는 자신의 답과 상대 답만 제공하며 초대 토큰에는 답이 노출되지 않는다.
- 합성 방 철회 후 양쪽 답이 지워지고 소유자·참여자·초대 토큰의 접근이 closed로 끝난다.
- 대상 RPC의 반복 실행이 남지 않았고 239 catalog·ACL·cron·기존 데이터·ledger가 계약과 일치한다.

로컬 PostgreSQL 검사는 DB 동작을 검증하지만 PostgREST의 재시도 계층을 재현하지 않는다. HTTP 경로의 빠른 충돌 응답은 운영 또는 동일 PostgREST 버전의 독립 환경에서 따로 확인해야 한다. 공식 문서상 이미 반복 중인 요청은 함수 수정만으로 종료되지 않을 수 있으므로, 해당 요청을 정확히 식별해 처리하고 사용자 요청 전체를 일괄 중단하지 않는다.

복구 시 신규 방 생성·참여 진입을 닫고 기존 철회·만료·정리 경로를 유지한다. 재시도 오류가 있는 238 본문으로 되돌리거나 이용자 데이터를 DROP하는 것을 복구 경로로 사용하지 않는다.
