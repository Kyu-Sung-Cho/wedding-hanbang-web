# 21문항 첫 공개와 후속 검증

## 이번 판의 계약

- 문항 `preferences21-20261010-r1`: 사용자가 첨부한 21문항·4상황·순서·척도를 그대로 보존한다.
- 해석 `preferences21-reading-alpha.1`: 문항별 실제 동의와 중립·비동의를 구분하고, 비동의로 반대 선호를 만들지 않는다.
- 표시 `preferences21-report-alpha.1`: 핵심 → 주제별 펼친 근거 → 조건·파트너 질문·부탁 → 한계 순서다.
- 진입 `/wedding-code/preferences21`; 기존 `/wedding-code`의 30문항·레터·16캐릭터·과거 링크는 원래 버전으로 유지한다.
- 응답에 생성형 AI를 호출하지 않는다. 입력이 같으면 문항별 읽기도 같다. 전문가·사용자 타당성 검증 참여 인원은 0명이다.

## 공개 범위와 데이터

이 판은 로그인 없이 브라우저에서 답한다. 자동 저장은 직접 허용한 경우에만 본인 답을 새 이름공간에 기록한다. 마지막 실제 답 저장부터 30일 보관하며 문항 이동만으로 기간을 늘리지 않는다. 잘못되거나 만료된 저장은 자동으로 새 답으로 덮지 않는다. 다른 탭의 변경을 발견하면 자동 저장을 멈춘다. 이는 localStorage의 사전 비교와 변경 이벤트를 이용한 충돌 방지이며, 서버 트랜잭션을 제공한다는 뜻이 아니다.

친구 링크의 기본값은 본인의 비가족 동의 요약이다. 원답은 미리보기와 별도 동의가 있는 파트너 초대에만 담는다. 링크 주소의 fragment는 암호화가 아니고 누구나 전달받아 읽을 수 있다. 반환 링크는 초대 원답과 최초 만료 시각을 보존한다. 즉시 회수나 기존 링크 수정은 지원하지 않는다. 당사자 신원·작성자·동의 여부를 인증하는 서비스는 아니다. 앱에서 만료 뒤 여는 것을 막아도 이미 복사된 내용까지 삭제할 수는 없다.

아모라는 사용자가 고른 본인 비가족 수치 응답 최대 5개를 출처·버전과 함께 편집 가능한 메모로 만든다. 본인이 복사하고 대화에 붙여 넣어 보내는 단계가 필요하다. 자동 프로필·예산·일정·결정 기록 반영은 없다.

## 네 글자·16캐릭터 연결의 다음 검토

네 주제는 네 개의 검증된 양극 축이 아니다. 기존 30문항의 네 글자와 동물을 이 판의 답에 재사용하지 않는다. 다음 설계는 미확정이며, 표시하려면 문항 근거와 반례 검토가 먼저 필요하다.

| 검토할 영역 | 현재 문항이 알려주는 것 | 지금 확정할 수 없는 것 |
| --- | --- | --- |
| 식과 예산 | Q01 이야기 시간, Q02 예산 집중, Q03 재배분, Q04 여유 사용 | 이야기 중심/실용 중심 같은 단일 양극, 예산 성격 |
| 함께 고르는 방식 | Q05~Q12 시작·탐색·선택·재논의 단계의 선호와 수용 | Q05/Q06 역채점, Q08 수용을 결정권·능력으로 확대 |
| 가족과 이야기 | Q13~Q16 시점·선택 기준·마지막 선택 | 가족 관계의 건강, 가족 비해당의 가치 판단 |
| 지친 뒤 도움 | Q17 경청, Q18 연락 대행, Q19 공동 진행, Q20/Q21 첫 휴식 | 같은 축의 양극, 휴식의 관계 회피 해석 |

각 글자 후보는 이름·문항·허용 해석·양쪽 동의/낮음·특수 응답·소수 응답·동점 처리·구판 차이를 추적해야 한다. 임의 가중치·절단점을 검증된 점수처럼 공개하지 않는다. 실제 이해도 자료 없이 문항 수를 늘려 깊이 있다고 주장하지 않는다.

## 팀 이해도 인터뷰 — 바로 사용할 질문지

테스트가 끝난 뒤 정답을 유도하지 말고 아래를 묻는다. 답의 내용보다 문항을 어떻게 이해했는지 기록한다. 이름·연락처·가족 사정은 수집하지 않고, 기록·공유 범위를 먼저 설명하고 동의를 받는다.

1. 이 문장을 본인 말로 다시 설명해 주세요.
2. 어떤 장면과 조건을 떠올렸나요? 안내에 적힌 조건과 다른 부분이 있었나요?
3. 어렵거나 두 가지 뜻으로 읽힌 표현이 있었나요?
4. 이 선택지를 고른 이유는 무엇인가요? ‘반반’과 ‘아직 모르겠어요’는 각각 어떤 뜻으로 이해했나요? 두 선택지를 구분하기 어려운 문항이 있었나요?
5. 결과의 어느 설명이 답을 잘 담았고, 어느 설명은 맞지 않았나요? 이 결과만으로 알 수 있는 것과 알 수 없는 것은 무엇인가요? 답보다 넓게 해석된 부분이 있었다면 알려 주세요. 파트너에게 그대로 말할 수 있는 부탁이 있었나요?
필요하면 아래 두 가지를 추가로 확인한다.

6. 지금 답은 원하는 방식, 현실적인 시간·역할 제약 때문에 가능한 방식 중 어디에 가까웠나요? 둘을 구분하기 어려운 문항이 있었나요? 구체적인 금액이나 가족 사정은 말하지 않아도 됩니다.
7. 비교 화면에서 어느 답이 본인 답이고 어느 답이 파트너 답인지 설명해 주세요. 같은 답과 다른 답은 무엇을 뜻한다고 읽었나요? 실제로 함께 본 경험이 있다면 도움이 되거나 부담스러웠던 부분이 있었나요? 경험이 없으면 미실행으로 기록합니다.

우선 관찰할 문항: Q02/Q03의 예산 집중과 재배분 구분, Q05/Q06의 시작 시점과 선행 탐색, Q07/Q08의 ‘편하다’와 실제 원하는 결정권 구분, Q13/Q14의 가족 의견 시점, Q18/Q19의 다른 도움 조건, Q20/Q21의 첫 휴식과 동시 동의. 실제 참여가 없으면 결과는 미실행으로 남긴다.

## 공개 후 개선 기록의 기준

첫 운영 확인에서 실제 문제를 기록하고, 수정 가설·전후·버전 영향·독립 검토·자동/화면 회귀·두 번째 배포 증거를 별도로 남긴다. 질문 의미를 바꾸는 후속 개편은 새 문항 버전을 발급하고 원답을 소급 해석하지 않는다. 사용자 검증이나 권한 때문에 기다리는 단계는 그것만 대기 상태로 남기며, 채팅이 멈춘 뒤 자동 실행한다고 약속하지 않는다.

## 롤백

작업 시작 시 실제 원격 main은 `7a4fb2ea0cc2003a48e9529b25bf1bb67629bf95`였다. 첫 공개 전에 최신 main·정상 운영 배포를 다시 확인한다. 이 변경에는 DB 변경이 없다. 문제가 생기면 이 판의 새 진입 링크를 제거하는 가역 커밋 또는 정상 GitHub/Vercel 절차로 이전 정상 배포를 복구한다. 새 이름공간의 기존 답을 삭제하거나 30문항에 재배치하지 않는다.

2026-10-10 14:13 UTC 직전 확인한 정상 운영 기준은 `6be93825a26815ef59a25f4fce867583ca796e6d`다. Vercel `dpl_6nmmgPwFqrtahfxKEwuZ39qXhmCn`은 Ready / Production / Current이고 `hanbang.ai`를 제공한다. 고정 배포 주소는 `https://wedding-hanbang-epver3qmv-hanbang.vercel.app`이다. 최신 main의 랜딩 변경 13파일을 정상 merge했으며, 웨딩코드 문항·저장·공유 계약과 겹치지 않는다. 복구 시 이 정상 배포를 Vercel의 기존 롤백 절차로 지정하거나 이 커밋에서 정상 GitHub 배포를 수행한다. 새 응답을 삭제하지 않는다.

## 이번 세션에서 실제 확인한 관문

- HEAD `585348db900d6bffa2d4ed170cd9fb799733fabd`에서 전체 웹 타입·린트·웹 테스트·저장소 테스트가 통과했다. 웹은 1,256파일 / 22,466검사, 이 중 새 21문항 검사는 94개다. 새 검사 보호 반례 7개도 실제로 실패시키고 원본을 복원했다. 린트는 오류 0개와 기존 경고 23개다.
- 같은 앱 소스의 별도 정상 production build가 13:46 UTC 완료됐다. 전체 코드 검사 스크립트에는 build가 포함되지 않아 두 증거를 구분한다.
- 실제 모바일 검수에서 21문항 반환 링크 → 기존 30문항 이동 시 URL에 fragment가 없어도 오류 화면이 남고, 새로고침 시 정상 intro가 나타났다. 새 21문항 화면의 기존판 링크만 native 문서 이동으로 바꾸며, 공용 Button·기존 저장 reader·문항 의미는 수정하지 않는다. 수정 뒤 새 build와 실제 이동 검수가 필요하다.
- 해당 최소 수정 뒤 정상 production build가 14:16 UTC 완료됐고, 영향 검사 8파일 / 99개·전체 웹 타입·린트가 통과했다. 실제 반환 링크에서 기존 intro로 이동해 추가 새로고침 없이 정상 화면을 확인했다. 역방향 기존 intro → 21문항, 유효한 30문항 초대 → 21문항 새 빈 답, 뒤로가기 → 원래 초대도 실제로 확인했다. 원래 링크 의미를 새 판으로 옮기지 않는다.
- 실제 SDK 검사는 일반 페이지에서 PostHog와 Sentry 두 POST 본문을 관찰하고 모두 전송 전에 abort했다. 다만 검수용 브라우저 context 종료 시 진행 중이던 같은 origin GET fetch가 오류를 내어 전체 검사는 실패했다. 이를 개인정보 검사 통과라고 보고하지 않으며, interception 오류 0개와 실제 abort 완료 조건을 유지한 채 검수 도구의 종료 순서를 수정하고 재실행한다.
- 팀/전문가 타당성 참여 인원은 여전히 0명이다. 운영 공개와 타당성 검증을 혼동하지 않는다.

## 검사 실행 환경 사고와 보호 수정

최종 workspace 관문을 실행할 때 Turbo strict 환경이 `PNPM_CONFIG_*` 보호 변수를 하위 pnpm에 전달하지 않았다. 하위 pnpm이 자동 설치를 시도했고 관문은 실패했다. 이후 담당자가 보호 환경 없이 실행한 도움말 명령도 설치를 시작해 즉시 중단했다. 이를 정상 검사나 통과로 집계하지 않는다.

사고 전 13:15 UTC의 AFTER-only 목록에 있던 전용 작업 폴더 junction 107개 중 실제 target이 존재하는 106개를 원래 위치·원래 target으로 복구했다. `async-limiter` 원래 target 1개는 없어 복구하지 않았으며, 삭제·다른 target 대체·공유 metadata 수정은 하지 않았다. 전체 사고 전 구조 및 과거 공유 50개 복구가 입증됐다는 뜻은 아니다. 이후 실제 bare Playwright resolver와 `pnpm exec`의 `CI=true`, package CI=false, dependency check=error, offline=true를 확인했다.

`turbo.json`에는 위 검사 보호 변수 7개와 전용 store·virtual store·cache·linker·global virtual store 설정 5개를 `globalEnv`로 명시한다. strict 필터를 유지하고 값도 task hash에 포함해 하위 명령에 동일한 보호 환경과 전용 경로를 전달한다. hook·검사·오류 조건을 생략하지 않는다. 실제 하위 명령의 오류 차단과 최종 전체 workspace 관문은 전용 실행 환경 복구 뒤 별도로 검증한다.

2026-10-10 14:54 UTC 전용 캐시 seed 복사는 종료 코드 0으로 끝났다. 공유 pnpm store의 117,090개 파일 / 7,661,912,834바이트와 SQLite index를 새 전용 폴더에 hardlink 없이 복사하고, 각 내용과 공유 원본의 metadata·전체 내용·DB/WAL/SHM을 재검증했다. 선택한 원 checkout 파일도 이 복사 작업 전후에 동일했다. `pnpm-owned-recovery-seed-effects.json`은 네 비교 항목을 모두 true로 기록하며, 전체 내용 journal SHA는 `c454e8f7320ed2c325bde2434f08a8a6227f21331cb39c9cc14318729eb3af64`다. 이는 복사 작업의 무변경 증거이며, 전체 과거 상태 복구나 설치 완료 증거가 아니다.

전용 node_modules 5개 폴더의 110,168파일 / 4,731연결 / 1,589,378,169바이트를 삭제 없이 백업하고 전체 내용·연결을 비교해 15:02 UTC 종료 코드 0으로 확인했다. 이후 정상 `corepack pnpm install`을 frozen lockfile·offline·ignore scripts·frozen store·integrity on·copy·isolated 설정으로 실행했다. store·virtual store·cache는 모두 전용 작업 폴더 안의 고정 경로다. 1,349패키지를 설치했고 다운로드는 0건, 종료 코드는 0이다. installer가 생성한 metadata는 isolated / global virtual store=false이며, 설치 뒤 공유 원본 117,090개 파일을 다시 전수 해시해 내용·metadata·DB와 선택한 원 checkout 파일의 동일성을 확인했다.

`owned-dependency-guard-probe-effects.json`의 실제 세 실행도 통과했다. 정상 corepack pnpm exec는 종료 코드 0이고, 의도적인 linker 불일치는 부모 명령과 Turbo strict의 실제 웹 하위 명령에서 모두 `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN`으로 설치 전에 종료했다. 세 실행에서 설치 출력은 없었고 전후 metadata는 동일했다. 직접 Turbo 실행은 하위 오류 차단을 시험한 진단이며, 정상 전체 코드 관문을 대신하지 않는다. 과거 공유 50개 연결의 완전 복구는 여전히 입증하지 못했다.

## 현재 증거의 한계

독립 문항·순서·상황·척도 대조, 결정적 모델과 저장·공유·비교·메모 검사, 실제 React 흐름 검사는 각각 별도의 영수증으로 남긴다. 이전 30문항의 SDK 전송 검사는 PostHog 정상 페이지 양성 대조가 관찰되지 않아 실패했다. 이 결과를 새 판의 통과로 가져오지 않는다. 실제 새 SDK·브라우저·전체 관문·운영 배포 결과는 이후 실제 실행 기록과 최종 manifest에 고정한다.

## 최종 후보 ac98 — 확인된 증거와 대기 관문

아래는 제품 소스 HEAD `ac98ba1b0fa412c4097daaca47a09cc383560418`에 대한 기록이다. 최초 HEAD의 전체 통과, 현재 소스의 좁은 재검사, 현재 완료한 전체 관문을 구분한다. 문서 갱신은 제품 의미·문항 버전·원답을 변경하지 않는다. 이 문서와 독립 검토 문서는 source manifest 대상이므로 실제 결과를 채워 적용한 뒤 manifest를 다시 고정해야 한다.

| 범위 | 직접 확인한 결과 | 영수증 또는 로그 |
| --- | --- | --- |
| 최초 HEAD `585348db900d6bffa2d4ed170cd9fb799733fabd` | 웹 typecheck·lint·test, test:repo PASS. 웹 1,256파일 / 22,466검사, 새 판 7파일 / 94검사 | `first-head-verification-receipt.json`; 현재 ac98의 전체 관문을 대체하지 않음 |
| 문서 갱신 전 ac98 바이트 | manifest 25파일의 SHA256·크기 대조, 불일치 0 | `independent-ac98-source-binding-audit.json`; 적용 후 최종 바이트는 별도 source manifest에서 확인 |
| 현재 production-mode build | 2026-10-10 15:10:55.763 UTC 종료 코드 0. build 산출물 4개 SHA 일치 | `real-sdk-owned-build-process-receipt.json`, `production-build-owned-recovery.log`; 로컬 합성 서버 환경이며 운영 배포 증거가 아님 |
| 현재 Client guard 재증명 | 정상 16검사 PASS → 저장 충돌 반례 1검사 AssertionError RED → 제품·검사 SHA 정확 복원 | `final-client-guard-ac98-ledger.json`; 실제 root session 26690 종료 코드 0. 표준 ledger의 다른 22항목과 원 7개 ledger는 불변 |
| 의존성 백업 위치 보존 | 110,168파일 / 4,731연결 / 1,589,378,169바이트 전체 내용·연결·동일성 보존, 원 위치 없음 | `dependency-archive-relocation-effects.json`; 전용 `node_modules` 아래로 보존 이동, 삭제·제품·검사 수정 없음 |
| 이전 전체 웹 검사 | **FAIL**: `categoryKeyMirrors.test.ts`가 백업의 옛 경로를 읽어 ENOENT. 1suite 실패 / 1,255파일 성공 / 22,463검사 성공 | `full-web-before-archive-failed.log`; 실패 원본을 유지하고 전체 PASS로 집계하지 않음 |
| 백업 보존 이동 뒤 영향 검사 | 해당 파일 1개 / 3검사 PASS | `category-mirror-after-archive.log`; 전체 workspace 통과를 대체하지 않음 |
| 현재 test:repo | 1,572검사 PASS / fail 0 / 680,297.864ms. root가 2026-10-10 16:03:23 UTC session 59718 종료 코드 0 확인 | `final-owned-test-repo.log`; 전체 Turbo 웹·모바일 검사의 결과와 구분 |
| 현재 정상 whole Turbo `typecheck lint test` | 종료 코드 0, 9/9 tasks 성공, 8 cached, 28m43.151s. 웹은 fresh 1,256파일 / 22,466검사 PASS, 모바일 1,397검사 PASS | root session 24285 / `final-owned-normal-gates-receipt.json`. cached 8개는 같은 소스의 직전 정상 실행이며 최초 HEAD의 cache를 새 실행으로 부르지 않음 |
| 현재 실제 SDK fresh full | 2026-10-10 16:28:22.043 UTC 종료 코드 0. 54/54 흐름·6/6 실제 SDK 양성 대조 PASS, 51개 전송 기록·32개 asset. 보호 데이터 없음, interception 오류 0, pending 0, abort/정리 완료, source/build/SDK 바이트 동일 | root session 72151; `official-chrome-ordinary-settled-bounded-outbound-full-2026-10-10T16-28-22.043Z-e338cdc9f009/result.json`, SHA `26fb83576cc8638e1c9d239b19a0e0f1fe139d0f62b0c8ac62a3f9e093e46e3d` |
| 필수 원격 CI·첫 운영 배포 | 이 기록 시점에는 미실행. 로컬 필수 관문 통과 뒤 정상 PR·필수 CI·Preview 확인·merge·Vercel 운영 배포로 진행 | 실제 PR/배포 영수증에서 후보·merge SHA·Ready·hanbang.ai·운영 흐름을 별도로 고정 |

파일명만 쓴 위 영수증은 `.verification/preferences21-20261010/`에 있다. 로컬 성공과 원격·운영 대기 상태를 구분한다. 확정 SHA256:

- 최초 HEAD 영수증: `5d038855a27d3a72e31172223ba81b5351fc29f94c7bb4dbe4113af45451f10e`.
- 검증한 ac98의 문서 갱신 전 manifest 파일: `e966852c0c17a0c59bf8da59e68bd11cbcfe055aeb6ed30749e3bd43e8c3be5c`; 25파일 canonical 내용: `a42eaa5d3f74b7f63b463804e1cd5e745e3fc2f31fb174a8cc1a898639d22983`. 이 문서 적용 후 마지막에 발급한 별도 `2026-10-10_preferences21_source_manifest.json`에서 최종 값을 확인한다. 자기 참조를 피하기 위해 그 hash를 이 문서에 다시 넣지 않는다.
- build 영수증: `033461aa060a82ed9df01f2b80dcdc133fa38a7bcc67cd6bce139a1ce8aaded5`; build 로그: `85400e2fe30455549909926cfb4d7527e08819adab246194ea6e60f1e3742fb8`.
- Client guard 영수증: `c03025972703bfc199ff49ab82a1c61dc7c63006fdcb5e04e8218c7a11f345c3`; 정상 로그: `8fa81f203bf8587a672770709c82ec018f1b2b6b643b4c4324e35768e951b4b4`; 반례 로그: `e347f41c87d6ed4f821bdc0fd489a76501bcb4ab9152ed2ae9b1cda123f059bd`.
- 현재 Client 소스: `a9c70f93485d67f0a48b722eb80fb917c8351b964bd6daf691497210c794e7cd`; Client 검사: `fa27193f3f17b96b80861cb002fbc373c9541f1ee5abd0c8c01c354d467e6cee`; 원 7개 guard ledger: `c5b882cd6804bb644457f72bddb437b4283efddbf44b10ae2ec50417897747c8`.
- 백업 이동 영수증: `0006662ba61cc91196793624d999f06dc111d2feb1d46b18398acb413a6e76ca`; 이전 전체 웹 실패 로그: `e6aa6acd5bc6d7c6ed113ad99116e904b2476a8ba2e14927043d2396844cbda6`; 이동 뒤 영향 검사 로그: `5c738378db73b559b462561a3055fa01501ac9b0f4abcad4b2b915ff753d8249`.
- 현재 test:repo 로그: `7766aef90e889feaf0e46f8a77f2c292bdb4af11ebf5f9196742255ece599cf4`.
- 현재 정상 전체 관문 영수증: `190b6ee114da1b26bd3c7b68c4c9e6bee42e7d3370f0204290ff738abde80de9`; 전체 로그: `1e0cff1dc6e4c783963cc11d36d34e8312baa4ec240a875869329a030e88bede`; 웹 snapshot: `6f1a98c00fb38f73cf28bd390d9b218d987ec05823ee5e1e41f0167282f3dda5`; 모바일 snapshot: `df24621d4639e063791968cf76af0914442fde745cc382464d16ee043ad95f0b`.

### 아직 확인하지 못한 항목과 보존한 실패

전문가·사람 이해도 검증 참여자는 0명이며 질문지는 미실행이다. 문항별 실제 답 → 허용 설명 → 결과 근거의 추적은 구현·자동 검사로 확인한 범위다. 사람의 이해도·타당도, 중요도·확신도, 검증된 네 글자·16캐릭터를 입증하지 않는다. 새 21문항의 가중치·절단점·레터·캐릭터 연결은 미확정이다.

실제 브라우저의 200% native zoom은 미검증이다. 320px reflow와 키보드 이동 기록은 서로 다른 조건의 증거다. 이전 PR의 Preview에서 인증 환경 제약을 관찰했다는 담당자 보고 이력이 있으나 정확한 관찰 영수증을 이번 판의 통과·실패로 재사용하지 않는다. 현재 21문항 Preview는 아직 생성되지 않았고 인증·화면 검수도 미실행이다. 필요할 때 보호 해제·개인 인증 쿠키 내보내기 없이 정상 기존 브라우저에서 검수할 예정이다. 공개 SDK 값으로 만든 로컬 production-mode 환경과 실제 운영 확인은 별도 증거로 남긴다.

SDK 원본 helper `.verification/production-wedding-code-outbound.mjs`의 SHA는 `00c02c38f05ff6ea17b23ae5179df6a4e81d2110af344082c484e0673c52b4e3`다. 원본의 실패를 보존하며 새 helper의 통과로 고쳐 적지 않는다. `official-chrome-current-landing-outbound-full-2026-10-10T14-47-15.635Z-0167c7542d8d/result.json`은 failed, SHA `0eb5fdfddb1498a1e01b04a51223c40c10b898f222781f30d70790555777c6cb`이고, `official-chrome-click-diagnostic-outbound-full-2026-10-10T15-21-16.589Z-1b1fe7d54f14/result.json`도 failed, SHA `7e6e8b32a432cff362a4f1ffb035247d647f61bdbe870d0a27fd54750ee3e501`다. 일반 양성 대조와 보호 경계 전체 조건을 실제로 충족한 새 영수증이 필요하며, provider ingestion이나 운영 서버·edge 로그 검증을 대신하지 않는다.

### 첫 운영 뒤 비교 접근 개선 — 준비만 완료

`cycle2-comparison-focus-prepared.patch`와 해당 manifest·검사·guard 반례 준비안은 ignored 파일에만 있다. 제품에 적용하지 않았고, 준비한 8개 DOM 검사·2개 guard 반례·native Enter 검수도 실행하지 않았다. 현재 로컬 관찰의 390px 비교 접근 불편은 첫 운영 배포에서 같은 흐름·위치로 재현한 뒤 판단한다. 필요할 때 공통 상단의 ‘두 사람 답 비교하기’ 버튼이 기존 비교 제목에 focus를 옮기도록 하는 최소안이다. 원답·공유 fragment/history·문항 의미·판·동의를 변경하지 않는다. 실제 운영 재현, 독립 검토, 회귀 검사, native Enter·제목 viewport·다음 Tab 확인과 두 번째 배포는 모두 별도 미완료 단계다.



### 실제 SDK 최종 관문과 주장 범위

최종 helper SHA는 `44fdf4dff918f10b42eb370e1c88f86e94f7bc0646f07ca7a8cca0ede3e55e38`다. 통합 담당자의 공식 Chrome 합성 profile 실행 결과를 독립 담당자가 51개 전송 기록과 각 case 조건으로 다시 계산했다. 독립 full 감사 SHA는 `2c18bb769b304fc77a21d58020b25f5a15fadfa018c52a907712ce28ecbd3430`다. 일반 페이지에서는 실제 PostHog·Sentry 양성 대조가 발생했고, 해당 앱 context에서 포착한 외부 전송·API·write 시도는 수신 전에 차단했다. 정상 같은 origin 문서·asset GET/HEAD만 읽었으며 redirect follow는 허용하지 않았다. provider ingestion이나 hosted 서버·edge 로그 검증의 증거가 아니다.

자연 재현 id53의 SDK start는 실제 일반 /landing 관측 이후였다. SDK의 trim된 end timestamp로 물리적 span 종료를 단정하지 않고, 이전 id317의 귀속은 미확정으로 보존한다. 기존 실패·원 hook의 false를 소급 변경하지 않는다. 새 검사는 일반 귀환 뒤 31초 passive 관찰, 2초 quiet/pending0, 최종 읽기까지 45초 제한과 변경 직전 동기 version 확인을 AND한다. 모든 미래 SDK 큐가 비었다는 보장이 아니며 이후 보호 Sentry 전송은 계속 실패 조건이다. SDK 설정·sampling·UA·인증·보호 조건을 바꾸지 않았다.
