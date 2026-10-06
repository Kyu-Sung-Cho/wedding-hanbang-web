# 기본 v3.1 안내 독립 릴리스 후보 — 2026-10-06

기준은 운영 main `c573b9035beac169a630dc849cbf2af02f93a99e`다. 날짜·기억 안내 후보와 별도이며 새 DB 관리 기능을 포함하지 않는다. 로컬 후보까지만 작성한다.

## 기능과 의존성

기존 질문·답·버전·점수·코덱·로컬 저장·서버 연결 계약을 유지한다. 결과 화면에 원본 여덟 문장에 근거한 개인 준비 안내와 두 사람 대화 안내를 추가한다. 명확한 네 축 응답에는 독립적인 16개 장식 별칭을 표시한다. 성격 진단이나 궁합 점수를 만들지 않는다. 혼합·양쪽 동의·양쪽 비동의·미응답·판단 유보·해당 없음·경계 상태에는 별칭을 강제하지 않고 실제 상황을 떠올리는 탐색 질문을 제시한다.

`CharacterPortrait.tsx`는 그림만 가진 독립 컴포넌트다. 기존 v4 캐릭터·가이드·공유 문구·publicSite 상수는 가져오지 않는다. v3.1 답을 v4 축으로 변환하지 않는다.

개인·받은 결과의 재시작은 확인 뒤에만 기존 처리기를 호출한다. 취소 기본 초점, Escape, 배경 클릭, Tab 경계와 취소 후 초점 복귀를 제공한다. 읽기 전용 결과의 돌아가기 동작은 유지한다. 받은 결과는 본인 저장 답을 지우지 않는다. 저장하지 않는 임베디드 경로도 삭제 범위를 정확히 설명한다. Client 변경은 기존 `storageActive`를 안내용 속성으로 전달하는 한 줄뿐이다. 질문·저장 알고리즘은 변경하지 않는다.

## 변경 파일

기능 6파일:
- `apps/web/src/app/wedding-code/WeddingCodeV31Results.tsx`
- `apps/web/src/app/wedding-code/WeddingCodeV31Client.tsx` — 표시용 속성 한 줄
- `apps/web/src/app/wedding-code/WeddingCodeV31Confirm.tsx`
- `apps/web/src/components/wedding-code/CharacterPortrait.tsx`
- `apps/web/src/components/wedding-code/V31CharacterGuide.tsx`
- `apps/web/src/lib/weddingCode/v31CharacterGuide.ts`

테스트 3파일:
- `apps/web/src/app/wedding-code/WeddingCodeV31Client.interaction.test.tsx`
- `apps/web/src/components/wedding-code/V31CharacterGuide.test.tsx`
- `apps/web/src/lib/weddingCode/__tests__/v31CharacterGuide.test.ts`

이 인수 문서 외 범위는 없다. package·lockfile·SQL·API·CI·보안 가드·공유 안전 분류·v4·날짜·기억 파일은 변경하지 않는다.

## 검증 근거

- 모든 16코드: 원본 코덱 왕복·응답 불변·4개의 서로 다른 개인 안내·실제 결과 렌더링과 원본 근거 8개.
- 모든 256커플: 실제 응답 비교·양쪽 코덱 불변·4개 대화 안내·실제 결과 렌더링과 원본 비교 근거 8개. 궁합 점수 없음.
- 불확실성 32조합: 모든 네 축의 혼합/양쪽 동의/양쪽 비동의/양방향 경계/판단 유보/해당 없음/미응답에서 별칭과 단정적 개인 안내를 생성하지 않음.
- 관련 결과·클라이언트·요약 회귀 6파일 670개 통과. 기존 링크·저장·재개·연결 계약 6파일 202개 통과. 기존 v4 소스 가드 41개, 보안·CI 신호·제어문자 가드 19개 통과. 오프라인 평가 계약 39시나리오 통과(실제 모델/strict240 실행 증거와 다름).
- 합성 브라우저: 16코드와 MB?N을 기본 `/wedding-code`에서 재개, 320/390px 넘침 없음, 취소 후 저장 유지. 받은 두 사람 결과·개인 탭·받은 결과 확인 후 본인 저장 유지, 본인 Escape 후 유지·확인 후 삭제. 브라우저 오류/API 호출 0건. 외부 요청 차단.
- 타입·변경 파일 lint 통과. 후보 첫 회귀에서 커플 labels 전달 누락을 발견해 수정했고, 기존 즉시 재시작 기대 두 곳을 확인 뒤 실행하도록 갱신했다.

로그·실행 스크립트·합성 시드·스크린샷은 `.verification/v31-standalone`에 있다. 고객 답·운영 계정·업로드·공유는 사용하지 않았다. 기존 strict240/CI/security 검증 기준은 완화하거나 수정하지 않는다. 통합 후보의 최종 가드는 통합 담당이 실제 배포 SHA에서 수행한다.

## 남은 배포 검증

로컬 `next build`의 컴파일과 TypeScript는 통과했다. 기존 `/price/vendor/[slug]` 정적 페이지의 `PUBLIC_VENDOR_STATIC_PARAMS_UNAVAILABLE` 때문에 전체 빌드는 완료하지 못했다. 합성 Supabase 설정으로 기존 업체 목록을 읽을 수 없기 때문이다. 해당 페이지·조회 함수는 변경하지 않았고 가드나 플래그로 우회하지 않았다. 통합 담당은 기존 승인된 읽기 환경에서 정확한 후보 SHA의 전체 빌드와 배포 가드를 완료해야 한다.

이 후보는 WeddingCode 부분 개선이다. 전체 제품 완료, 신규 DB 기능 완료, 운영 배포 완료를 의미하지 않는다. 별칭의 호감도·안내 이해도·실제 대화 효과는 고객 인터뷰 검증 사항이다.
