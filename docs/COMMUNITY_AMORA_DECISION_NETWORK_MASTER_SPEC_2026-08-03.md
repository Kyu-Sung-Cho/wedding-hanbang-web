# 웨딩한방 Amora × 사람 경험 결정 네트워크 마스터 설계

> 상태: **APPROVED DIRECTION + LOCAL RELEASE CANDIDATE — 운영 검증 전**
>
> 기준일: 2026-08-03
>
> 구현 상태: **P0 신뢰 경계와 DecisionThread 수직 루프가 로컬 코드·migration
> candidate로 반영됨. 운영 DB·Vercel production·앱 배포에는 반영하지 않음**
>
> 출시 상태: **NO-GO 유지**

이 문서는 “웨딩 커뮤니티를 더 활발하게 보이게 하는 방법”이 아니라, 실제 예비부부가
사람의 경험을 통해 결정을 내리고 Amora로 실행한 뒤 결과를 다음 커플에게 돌려주는 전체
시스템을 설계한다.

문서 권한은 PRINCIPLES.md, AGENTS.md, docs/MVP_PRODUCT_DIRECTION_2026-07-30.md,
docs/MOBILE_PRODUCT_COMPLETION_STANDARD_2026-08-03.md,
docs/operations/COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md와 실제 코드 아래에 있다.
6월의 커뮤니티·계약 스캔·시세 중심 문서는 역사적 아이디어로만 참고하며, 현재 모바일
Amora-first 제품 계약과 충돌하면 이 문서에서도 채택하지 않는다.

현재 세션에는 Lazyweb MCP의 화면 보고서 도구가 로드되지 않았다. 따라서 이 문서의
제품·정보구조·상태·카피는 현재 코드와 정본 문서에 근거한 설계 가설이며, 화면별
A/B 근거나 시각 완성도 검증 결과로 표현하지 않는다. 실제 화면 최적화는 Lazyweb
커넥터 복구 후 별도 게이트로 수행한다.

### 2026-08-04 구현 스냅샷

이 스냅샷은 현재 working tree의 코드 상태를 설명한다. 운영 적용이나 소비자 검증을
뜻하지 않으며, 최종 명령 결과와 다른 컴퓨터 재개 절차는
`docs/operations/AMORA_COMMUNITY_IMPLEMENTATION_HANDOFF_2026-08-04.md`를 정본으로 삼는다.

| 설계 영역 | 현재 로컬 candidate | 아직 닫히지 않은 출시 경계 |
|---|---|---|
| Phase 0 신뢰 봉합 | moderation 원자 처리, profile/guestbook hardening, runtime control, responder capacity, comment/post API-only 원자 쓰기, poll set-intent, viewer block, push session/outbox를 migration `20260804103000`~`20260804200000`에 분리 | hosted ledger·backup/restore·Storage·두 계정/두 기기·운영자 훈련 |
| DecisionThread 수직 루프 | feed/inbox/write/read/answer/applicability/resolve/withdraw/outcome/publication API와 웹 발견 카드, 모바일 write/detail/진입 경로의 로컬 candidate | 실제 사람 답변 공급, physical-device E2E, community→Amora 승인→예산/할 일/일정 영수증의 완전한 한 바퀴 |
| 모바일·계정 안전 | viewer-scoped cache, 로그아웃/계정 전환 purge, late response 폐기, text-only media gate, reply push opt-in·소유 세션·탭 재검증 | 서명된 EAS build, 알림 권한 설명 실기기 검증, Expo receipt canary |
| 검색·공개 기록 | 동의 철회 가능한 outcome publication review candidate와 public read projection | 운영 검수 SLA, 검색엔진 노출, canonical/soft-404 검증 |
| 한 대화의 연속성 | 사용자에게는 Amora 한 대화를 유지하고 내부적으로 segment·lane·source/reply pair로 복구·기억 경계를 분리 | 장기 실사용에서 대화 길이·요약 오해·주제 전환 만족도 검증 |

따라서 아래 20장의 “현재 구현” 표는 **2026-08-03 설계 당시의 gap 기록**으로 읽는다.
위 스냅샷과 실제 코드가 우선하며, 미완료 체크를 자동으로 완료 처리하지 않는다.

---

## 0. 최종 결정

### 0.1 제품 공식

웨딩한방의 전체 제품 위계는 다음과 같다.

| 층 | 중심 역할 | 사용자가 얻는 것 |
|---|---|---|
| 모바일 Home·Amora | 제품 중심 | 지금 할 한 가지와 승인 가능한 실행 |
| 결정형 커뮤니티 | 사람 경험 계층 | 내 조건과 가까운 경험, 답변, 결과 |
| 예산·할 일·일정 | 실행 계층 | 승인된 결정의 실제 반영과 영수증 |
| 웹 | 유입·검색·연속성 | 검수된 해결 기록 발견과 데스크톱 사용 |
| 동기방 | 제한적 관계 계층 | 답변 매칭, 작은 의식, 소속감 |

**제품은 Amora-first, 커뮤니티의 핵심 객체는 DecisionThread, 커뮤니티 사용감만
Threads처럼 빠르게 만든다.**

### 0.2 사용자에게 약속할 한 문장

> Amora에게 지금 상황을 말하면 다음 행동을 정리하고, 실제 경험이 필요한 순간에는 먼저
> 겪은 사람의 답을 가져와 내 준비에 반영할 수 있어요.

이 문장은 다음을 동시에 말해야 한다.

- AI가 사람의 경험을 대신하지 않는다.
- 커뮤니티 글은 자동으로 사실이 되지 않는다.
- Amora는 답변을 복사하는 것이 아니라 적용 조건을 비교한다.
- 예산·할 일·일정 변경은 사용자가 승인한 뒤에만 실행된다.

### 0.3 성공의 정의

커뮤니티가 성공했다는 기준은 게시글 수나 체류시간이 아니다.

> **한 커플의 실제 고민이 적합한 사람의 경험을 만나고, 확인된 다음 행동 또는 결정으로
> 남고, 가능한 경우 실제 결과가 다시 기록되는 것**

북극성 지표는 **주간 신뢰 해결 커플 수**다. 최소 조건은 다음과 같다.

1. member 또는 industry_professional 출처의 실제 사람 답변이 있다.
2. 질문자 또는 커플이 “우리에게 해당”, “다음에 확인할 행동”, “조건이 다름” 중 하나를
   명시한다.
3. 출처·광고·혜택 관계가 분류되어 있다.
4. 확정된 신고 위반이 없다.
5. 해결 또는 실제 다음 행동이 기록된다.
6. Amora로 옮긴 경우 승인·적용·실패 영수증이 존재한다.

### 0.4 명시적으로 하지 않을 것

- 앱 전체를 X·Threads 복제품으로 만들지 않는다.
- 전역 팔로워 그래프를 만들지 않는다.
- 글 수·좋아요·연속 출석·체류시간을 핵심 보상으로 사용하지 않는다.
- AI·운영자가 일반 회원인 척 글이나 답변을 만들지 않는다.
- 사람 답변이 없는 상태를 AI 답변으로 “해결” 처리하지 않는다.
- 개인 예산, 정확한 예식일, 파트너의 private 대화, 계약서 원문을 자동 공개하지 않는다.
- 업체 광고와 일반 추천 순위를 섞지 않는다.
- 예약·결제·계약·업체 메시지를 커뮤니티 답변만으로 자동 실행하지 않는다.
- 사람 답변 공급과 신고 운영이 검증되기 전에 유료 유입을 확대하지 않는다.

---

## 1. 확인된 사실, 추론, 미검증 가설

| 구분 | 내용 |
|---|---|
| 확인된 사실 | 모바일은 Home·Amora·Community·My 4탭을 갖고 있다. |
| 확인된 사실 | 현재 모바일 커뮤니티는 동기방·탐색·퀵액션·카테고리 뒤에 게시글이 나온다. |
| 확인된 사실 | 모바일 게시글 타입과 화면은 웹에 있는 content_origin, is_resolved, under_review, sponsorship_detail을 충분히 사용하지 않는다. |
| 확인된 사실 | 웹은 출처, 광고 표시, 답변 대기, 해결, 댓글 도움, 신고, 답변 알림의 기반을 이미 가진다. |
| 확인된 사실 | 현재 is_resolved 변경은 version 없는 직접 PATCH이고, 신규 DecisionThread lifecycle의 동시성 계약으로 재사용할 수 없다. |
| 확인된 사실 | 현재 poll vote toggle은 응답 유실 뒤 재시도 시 사용자의 최종 의도를 반전시킬 수 있다. |
| 확인된 사실 | 일부 커뮤니티 rate limit은 서버 process-local이라 multi-instance 운영 한도가 아니다. |
| 확인된 사실 | community_profiles에 XP·streak·rank 자산이 있으나, 이번 설계는 이를 참여 핵심 보상으로 사용하지 않는다. |
| 확인된 사실 | 현재 decision 기록 helper의 애플리케이션 중복 확인과 node·edge 기록은 하나의 DB transaction이 아니다. |
| 확인된 사실 | 운영 DB 반영, 사람 답변 공급, 실기기 모바일 E2E는 검증되지 않았고 프로덕션은 NO-GO다. |
| 제품 추론 | 전체 제품은 Amora-first이고 커뮤니티 안에서만 feed-first여야 첫 가치와 차별화를 모두 지킬 수 있다. |
| 제품 추론 | 일반 Post보다 질문·조건·사람 답변·선택·실행·결과를 묶는 DecisionThread가 더 가치 있는 핵심 객체다. |
| 미검증 가설 | 내용-first 글쓰기가 현재 카테고리·제목-first 글쓰기보다 완료율과 품질을 함께 높인다. |
| 미검증 가설 | “내 경험이 필요한 질문”의 제한적 요청이 일반 “글쓰기” CTA보다 좋은 답변을 늘린다. |
| 미검증 가설 | 실제 영향 영수증이 일반 좋아요 알림보다 반복 기여를 늘린다. |
| 미검증 가설 | 맞춤 결정 피드가 커뮤니티 소비 후 Amora 실행 전환을 높인다. |
| 미검증 가설 | 결과 업데이트가 검색 가치와 재방문을 동시에 높인다. |

현재 HEAD 감사 재현 경로:

- 모바일 피드·상세: `apps/mobile/app/(tabs)/community.tsx`,
  `apps/mobile/app/community/post/[id].tsx`
- 웹 post lifecycle: `apps/web/src/app/api/community/posts/[id]/route.ts`
- poll toggle·process-local limiter: `apps/web/src/app/api/community/polls/[pollId]/vote/route.ts`
- 일반 post·comment write limiter: `apps/web/src/app/api/community/posts/route.ts`,
  `apps/web/src/app/api/community/comments/route.ts`
- 애플리케이션 수준 decision 기록: `apps/web/src/lib/memory/record-decision.ts`
- 기존 gamification 자산: `supabase/migrations/20260325000001_gamification.sql`,
  `supabase/migrations/20260408000000_community_v2.sql`

미검증 가설은 카피나 마케팅 주장으로 사용하지 않고, 사전 등록된 실험으로만 판단한다.

---

## 2. 사용자와 핵심 순간

### 2.1 주요 사용자 역할

| 역할 | 현재 필요 | 제품이 해야 할 일 |
|---|---|---|
| 처음 온 예비부부 | 무엇부터 할지 모름 | Amora로 첫 행동을 만들고 관련 해결 기록 하나를 보여준다. |
| 질문자 | 내 조건에서 무엇이 맞는지 모름 | 답하기 쉬운 질문으로 정리하고 적합한 경험자에게 연결한다. |
| 최근 경험자 | 방금 겪은 일을 짧게 나눌 수 있음 | 15초 답변, 조건 표시, 실제 영향 확인을 제공한다. |
| 파트너 | 같은 근거를 보고 함께 결정해야 함 | private 적용성 반응과 동일 proposal version 승인을 제공한다. |
| 검색 방문자 | 특정 가격·계약·업체 대응을 검색함 | 검수된 완결 기록을 읽고 내 상황으로 가져오게 한다. |
| 업계 종사자 | 공식 조건을 설명할 필요가 있음 | 일반 회원과 분리된 검증 신원·공식 답변 레인을 제공한다. |
| 운영자 | 답변·신고·출처·공급을 관리함 | 미답변·신고·이의제기·출처·답변 부하를 한 큐에서 본다. |

### 2.2 웨딩 단계별 핵심 질문

| 단계 | 대표 고민 | 적합한 커뮤니티 가치 |
|---|---|---|
| 시작 전 | 무엇부터 해야 하나 | 같은 단계의 해결 기록과 Amora의 첫 제안 |
| 비교 중 | 이 가격·구성이 괜찮나 | 조건이 보이는 실제 경험과 확인 질문 |
| 계약 직전 | 추가금·취소·원본·보증인원 | 최근 같은 계약을 겪은 사람의 답변 |
| 진행 중 | 일정·역할·업체 대응 | 다음 행동과 커플 합의 |
| 본식 직전 | 빠뜨린 일·당일 변수 | 짧고 검증 가능한 체크와 사람 경험 |
| 본식 후 | 정산·파일 수령·감사·후기 | 결과 업데이트와 다음 커플에게 15초 도움 |

### 2.3 재미의 정의

웨딩한방은 중독을 재미로 정의하지 않는다.

| 재미 | 사용자 감정 | 제품 장치 |
|---|---|---|
| 공감 | 나만 그런 게 아니었다 | 같은 단계·조건의 실제 이야기 |
| 발견 | 이 항목도 확인해야 했다 | 조건이 구조화된 답변과 결과 |
| 표현 | 우리 커플은 이렇게 준비한다 | 선택형 질문, 작은 승리, 취향 공유 |
| 능력감 | 내 경험이 누군가에게 쓰였다 | 도움의 영수증, 결과 알림 |
| 진전 | 오늘 하나를 정했다 | Amora 승인과 준비 도구 반영 |
| 호기심 | 결국 어떻게 됐을까 | outcome follow-up |
| 소속감 | 같은 시기를 지나고 있다 | 선택형 동기방과 주간 작은 의식 |

사용 후 “더 명확해졌다”와 “마음이 가벼워졌다”를 함께 측정한다. 반대로 비교 불안,
압박감, 알림 피로가 늘면 추천량을 줄이는 것이 정상 동작이다.

---

## 3. 전체 시스템 흐름

**앱 첫 실행**

    현재 상황 입력 → Amora의 다음 행동 제안 → 사용자 수정·승인
    → 예산·할 일·일정 중 하나에 durable receipt
    → 실제 사람 경험이 필요한 순간에만 관련 DecisionThread 연결

첫 실행에서는 community가 Amora 실패의 대체 화면이 되지 않는다. 아래 흐름은 검색 방문자와
이미 준비 중인 사용자가 사람 경험을 필요로 할 때의 acquisition·resolution 흐름이다.

**검색·사람 경험 진입**

    외부 검색·공유
        ↓
    검수된 해결 기록
        ↓
    질문 또는 내 조건으로 보기
        ↓
    적합한 사람의 실제 경험 답변
        ↓
    질문자, P1에서는 grant된 파트너의 적용성 판단
        ↓
    Amora의 출처가 보이는 정리와 변경 제안
        ↓
    사용자 또는 커플 승인
        ↓
    예산·할 일·일정 반영 + decision_nodes + 실행 영수증
        ↓
    실제 결과 확인
        ↓
    동의받은 결과만 검색 가능한 해결 기록으로 환원

### 3.1 두 개의 핵심 루프

**도움받기 루프**

    막힘 → 질문 → 사람 답변 → 적용성 판단 → Amora 제안
    → 승인 → 실제 행동 → 결과 → 다음 커플의 검색 자산

**도움주기 루프**

    준비 단계 완료 → 비슷한 질문 요청 → 15초 경험 답변
    → 질문자의 실제 행동 알림 → 결과 확인 → 다음 답변

질문자는 준비가 진행되면서 다른 주제의 최근 경험자가 된다. 이 역할 전환이 웨딩이라는
유한한 여정에서 콘텐츠 공급을 재생산하는 핵심이다.

---

## 4. 채널별 정보구조

### 4.1 모바일 하단 탭

현재의 Home, Amora, Community, My를 유지한다.

| 탭 | 첫 질문 | 첫 화면 책임 |
|---|---|---|
| Home | 오늘 무엇을 하면 되나 | 지금 할 한 가지, 승인 대기, 기다리는 답, 준비 상태 |
| Amora | 내 상황에서 어떻게 정리하나 | 대화, 근거, 제안 diff, 승인, 영수증 |
| Community | 다른 사람은 어떻게 했나 | 맞춤 결정 피드, 답변 필요, 결과 기록 |
| My | 무엇을 통제하고 있나 | 프로필, 공개 범위, 알림, 기여·결과, 설정 |

커뮤니티의 존재감을 위해 Home 전체를 피드로 바꾸지 않는다. Home에는 현재 준비와
직접 연결된 커뮤니티 카드만 최대한 작게 노출한다.

### 4.2 웹

웹은 다음 역할을 우선한다.

1. 검색 가능한 검수·동의 완료 해결 기록
2. 서비스 설명과 앱 유입
3. 로그인 사용자의 데스크톱 연속성
4. 운영자 큐와 정책·고객지원

원시 UGC 전체를 검색 노출하지 않는다. 검색 색인 대상은 결과 공개 동의, 출처 분류,
PII 검사, 운영 검수를 통과한 완결 기록만 사용한다.

### 4.3 동기방

동기방은 별도 제품 중심이나 정보 저장소가 아니다.

- 질문을 적합한 같은 단계 사람에게 라우팅한다.
- 작은 승리와 주간 체크인을 나눈다.
- 미답변 질문을 함께 돕는다.
- 유용한 공개 정보는 사용자의 별도 동의 아래 DecisionThread에 연결한다.
- 같은 질문을 여러 방 안에 가두지 않는다.

---

## 5. 핵심 도메인: Community DecisionThread

### 5.1 정의

DecisionThread는 일반 게시글에 다음 의미를 더한 집합이다.

| 요소 | 설명 |
|---|---|
| 질문·경험 | 사용자가 실제로 묻거나 겪은 내용 |
| 적용 조건 | 시점, 지역 범위, 준비 단계, 계약 전후, 필요한 경험 |
| 사람 답변 | 출처와 직접 경험 범위가 보이는 답변 |
| 적용성 판단 | 우리에게 해당, 조건 다름, 더 물어보기 |
| 다음 행동 | 질문자가 실제로 확인하거나 선택할 행동 |
| Amora 제안 | 출처를 인용한 개인화된 변경안 |
| 승인·실행 | 예산·할 일·일정 반영과 영수증 |
| 결과 | 실제로 어떻게 되었는지와 적용 조건 |

### 5.2 글 형식

초기 P0는 범위를 좁힌다.

| 형식 | P0 여부 | 예 |
|---|---|---|
| 경험 질문 | 필수 | “원본 비용이 계약 뒤에 추가됐나요?” |
| 조건 확인 | 필수 | “이 취소 문구를 겪은 분이 있나요?” |
| 둘 중 골라줘 | 제한 지원 | “두 촬영 시간 중 무엇이 덜 힘들었나요?” |
| 결과 업데이트 | 필수 | “결국 원본 포함 여부를 다시 확인했어요.” |
| 15초 후기 | 기존 기능 유지 | “드레스 투어 때 먼저 물어볼 것 한 줄” |
| 작은 승리 | P1 | “하지 않기로 해서 마음이 편해진 것” |
| 자유 잡담 | P2 이후 검토 | 초기 핵심 피드에서는 우선하지 않음 |

`post_format`과 `topic_category`는 서로 다른 축이다. 질문·경험·선택·결과·작은 승리는
**어떻게 참여하는가**이고, 계약·추가금·업체 응대·예산 우선순위·일정·가족 예절 등은
**무엇에 관한 이야기인가**다. UI, ranking, 분석 이벤트에서 두 축을 합친 단일 카테고리를
만들지 않는다. P0 공개 베타는 `contract_extra_cost` 한 주제로 시작하고, 나머지 topic은
답변 공급과 안전 운영이 검증될 때 순차적으로 연다.

### 5.3 상태 축을 섞지 않는다

하나의 is_resolved boolean으로 모든 상태를 표현하지 않는다.

**thread 해결 진행 상태**

    open → answered → resolved → followup_scheduled → completed
      ↘ closed

- open: 실제 사람 답변을 기다린다.
- answered: 기준을 통과한 사람 답변이 하나 이상 있다.
- resolved: 질문자가 충분한 답을 얻었거나 다음에 확인할 행동을 명시했다.
- followup_scheduled: 미래 결과를 확인할 날짜가 있다. `is_due`는 현재 시각에서 계산한다.
- completed: 실제 outcome이 기록됐다.
- closed: 더 이상 답변이 필요 없지만 completed 조건은 충족하지 않았다.
- closed에서 다시 열면 같은 thread의 version을 올리고 open으로 돌아간다.
- completed 결과는 덮어쓰지 않고 새 outcome revision으로 정정한다.

`followup_scheduled`는 선택 상태다. 결과가 바로 생기면 resolved → completed로 갈 수 있고,
결과 업데이트 형식으로 시작한 글은 검증된 canonical outcome과 함께 completed로 생성할 수 있다.
open·answered·resolved에서 작성자가 closed로 닫을 수 있으나 운영자가 참여 지표를 좋게 보이게
하려고 대신 닫을 수는 없다.

`resolved`는 답변이 객관적으로 참이라는 뜻도, 커플의 결정이 확정됐다는 뜻도 아니다.
커플의 실제 결정은 승인 정책을 통과해 `decision_nodes`에 기록될 때만 확정된다. 이 구분을
카피·API·분석에서도 유지해 커뮤니티 해결 상태가 실행 성공처럼 보이지 않게 한다.

전환 권한도 고정한다.

- 첫 qualified human answer가 생길 때만 서버가 open → answered를 자동 전환한다.
- P0의 resolved·closed·followup_scheduled는 thread 작성자만 전환한다.
- completed는 권한 있는 사용자의 canonical outcome revision 생성과 같은 트랜잭션이다.
- 마지막 qualified answer가 숨김·철회되고 아직 resolved 이후가 아니면
  `qualified_answer_withdrawn` event와 함께 answered → open으로 돌아간다.
- resolved 이후 source가 사라지면 과거 상태는 보존하되 `source_unavailable` 경고와 신규 적용
  차단을 붙인다. moderation 상태를 lifecycle 값으로 덮어쓰지 않는다.

**실행 가능한 전환표**

| from | to | actor | event·guard |
|---|---|---|---|
| none | open | author service | 질문 발행 command가 published까지 확정 |
| none | completed | author service | 결과 형식과 canonical outcome revision 동시 생성 |
| open | answered | service | 첫 visible qualified answer, rubric_version 고정 |
| answered | open | service | 마지막 qualified answer 철회, 이후 상태 전환 없음 |
| open·answered | resolved | author | explicit next action 또는 외부 해결 경로와 reason |
| resolved | followup_scheduled | author | outcome_due_at과 timezone 검증 |
| resolved·followup_scheduled | completed | author service | canonical outcome revision 동시 생성 |
| open·answered·resolved·followup_scheduled | closed | author | closed_reason 필수 |
| closed | open | author service | reopen event, thread version 증가, 새 SLA version |

qualified answer 전환과 철회 재계산은 thread row lock 안에서 구조화 evidence와
`rubric_version`으로 수행한다. P1에서 파트너 전환을 열기 전에는 “연결된 파트너”라는 이유만으로
mutation 권한을 주지 않는다.

**모더레이션 상태**

    visible / under_review / hidden / author_removed

**발행 상태**

    draft / quarantined / review / published / failed / withdrawn

`publication_state`는 audience나 moderation이 아니다. media·사람 검수가 끝나기 전에는
published가 될 수 없고, 성공 receipt는 published 후에만 반환한다.

**독자 범위**

    public / members / cohort

`audience_scope=cohort`이면 cohort_id가 필수다. RLS read는 published, moderation visible,
audience membership을 모두 만족해야 한다.

**출처**

    member / industry_professional / vendor_official / operator / ai / legacy_unverified

해결 상태, 발행 상태, 모더레이션 상태, 독자 범위, 출처를 한 컬럼이나 한 배지에 섞지 않는다.

### 5.4 사람 답변의 기준

작성자가 질문자 자신이 아니고, `content_origin`이 member 또는 industry_professional이며,
`response_kind`가 answer 또는 experience인 답변 중 **직접 경험 여부와 경험 시점·단계**를
필수로 쓰고, 실제 행동·결과·다음 확인 항목 중 하나 이상을 포함한 것만 qualified human
answer 후보가 된다. 업체·혜택·업계 관계 disclosure도 비워 둘 수 없다.

- 직접 겪은 시점·지역·단계
- 실제 선택 또는 행동
- 결과
- 다음 커플이 확인할 문구나 항목
- 사실과 개인 의견의 구분
- 업체·혜택·업계 관계

업체 공식 답변, 운영자 안내, AI 정리는 유용할 수 있지만 peer 사람 답변 SLA와 answered
전환에 포함하지 않는다. 삭제·숨김·출처 재분류로 qualified 조건이 사라지면 read model을
재계산하되 과거 event를 지우지 않는다.

`qualified_peer_member_answer`와 `qualified_professional_answer`를 별도로 집계한다.
업계 종사자 답변만 있는 thread는 전체 human answered UI를 가질 수 있어도 peer-member 공급
Gate를 통과한 것으로 세지 않는다. 운영 dashboard는 전체 human SLA와 peer-member SLA를
항상 나란히 표시한다.

AI는 rubric 누락을 제안할 수 있지만 qualified 여부의 최종 판정자나 사람 답변 생성자가
아니다. P0 전환은 서버의 출처·작성자·response kind·visibility 검증과 구조화된 답변 항목으로
계산하며 운영자는 표본 품질을 감사한다.

---

## 6. 모바일 상세 설계

### 6.1 온보딩

목표는 긴 프로필 완성이 아니라 첫 가치다.

**P0 순서**

1. 로그인
2. 예식일 또는 “미정”
3. 현재 가장 막막한 준비 단계 하나
4. Home에서 Amora의 첫 제안 확인
5. 하나를 수정·승인해 예산·할 일·일정에 반영
6. 이후 필요한 순간에 파트너 연결, 역할, 예산, 선호를 요청

커뮤니티 개인화는 예식일의 정확한 날짜를 사용하지 않는다. 사용자가 허용한 경우에만
월·분기, 넓은 지역, 준비 단계의 coarse context를 사용한다.

첫 제안 생성이 실패하거나 지연되면 community 카드로 우회하지 않는다. 입력 draft를 보존하고
“제안을 만들지 못했어요. 입력은 저장됐어요. 다시 시도하거나 Amora에게 직접 말해보세요.”와
재시도·대화 진입을 보여준다.

### 6.2 Home

Home은 다음 순서를 사용한다.

1. **지금 결정할 한 가지**
2. **기다리는 것**
   - 사람 답변
   - 파트너 승인
   - Amora 변경 제안
3. **오늘의 준비 상태**
   - 지연·임박·완료
4. **관련 사람 경험 하나**
5. 예산·할 일·일정의 compact 진입

커뮤니티 카드는 다음 두 경우에만 Home에 나온다.

- 현재 Decision Packet과 직접 관련된 해결 기록
- 사용자가 최근 완료해 답할 자격이 있는 질문

일반 인기글이나 불안 자극 글을 Home에 노출하지 않는다.

첫 실행 사용자는 승인된 durable Amora receipt가 생길 때까지 Home 첫 슬롯을 Amora 제안과
복구 상태에 고정한다. 커뮤니티 콘텐츠가 더 새롭거나 반응이 높다는 이유로 이 슬롯을 대체하지
않는다.

### 6.3 Community Home

**상단**

- 제목
- 검색
- 커뮤니티 알림함
- 새 글 composer 진입

**개인 인박스 한 줄**

- 기다리는 답변
- 내 경험이 필요한 질문
- 돌아온 결과

**피드 탭**

1. 나에게
2. 답변 필요
3. 결과

동기방은 피드보다 앞에 두지 않고 필터·보조 진입으로 둔다.

**첫 화면 규칙**

- 첫 실제 사람 글이 첫 viewport 안에 보여야 한다.
- 카테고리 타일과 기능 소개가 글보다 앞서지 않는다.
- 조회수·멤버 수·팔로워 수보다 조건·출처·상태를 먼저 보여준다.
- 최초 10개 카드 구성은 실험 가설로 다음 다양성을 보장한다.
  - 나와 가까운 해결 기록
  - 내 경험이 필요한 미답변 질문
  - 긍정적 결과 또는 작은 승리
  - 계약·비용 공포 글이 연속으로 과도하게 나오지 않음

### 6.4 피드 카드

표시 순서는 다음과 같다.

1. 출처와 관계 배지
2. 시점·넓은 지역·준비 단계
3. 사람 답변·다음 행동·결과 상태
4. 본문 또는 질문
5. P0 투표·한 줄 결과, P1 승인된 이미지
6. 사람 답변 수
7. 문맥형 행동

행동 예:

- 나도 궁금해요
- 15초 답하기
- 우리에게 해당돼요
- Amora에서 검토하기
- 결과 보기

역할별로 가능한 행동만 보인다.

- 일반 독자: 나도 궁금해요, 저장, Amora에서 검토하기
- 해당 경험을 opt-in한 답변 가능자: 15초 답하기
- 질문자: 우리에게 해당돼요, 조건이 달라요, 다음 행동 정하기
- P1 grant가 유효한 파트너: 허용된 private 적용성·승인 행동만

상태 카피는 내부 enum보다 강하게 말하지 않는다.

| state | 사용자 카피 |
|---|---|
| open | 사람 답변 기다리는 중 |
| answered | 사람 답변 도착 |
| resolved | 질문자가 다음 행동을 정했어요 |
| followup_scheduled | 결과 확인 예정 |
| completed | 질문자가 결과를 남겼어요 |
| closed | 답변 요청 종료 |

공개 downvote는 사용하지 않는다. “조건이 달라요”, “추가 설명 필요”, 신고처럼
품질과 안전에 필요한 신호를 분리한다.

### 6.5 내용-first 글쓰기

첫 화면은 빈 제목·카테고리 폼이 아니라 대화 시작이어야 한다.

> 지금 무엇이 막막해요?

선택형 빠른 형식:

- 질문
- 둘 중 골라줘
- 경험 공유
- 결과 업데이트

**작성 순서**

1. 사용자가 본문부터 입력한다.
2. 로컬 draft를 즉시 저장한다.
3. 사용자가 “비슷한 해결 기록 찾기”를 누르면 PII를 제거한 최소 키워드로만 검색해
   “먼저 보기”를 제안하되 질문 작성을 막지 않는다. 원문 draft를 분석 event에 남기지 않는다.
4. Amora 사용을 선택한 경우 제목·카테고리·필요 조건을 제안한다.
5. 사용자가 제안 내용을 수정·승인한다.
6. 지역 범위, 준비 단계, 계약 전후, 원하는 답변을 한 블록씩 확인한다.
7. 광고·협찬·업계 관계와 출처를 확인한다.
8. 공개 범위와 개인정보 경고를 확인한다.
9. preview 후 멱등 request id로 발행한다.

중복 질문을 운영자가 임의로 합치거나 답변 소유권을 옮기지 않는다. 유사 thread는 link로
연결하고, 사용자가 해결 기록으로 충분하다고 표시하면 새 글을 발행하지 않은 채 private
적용성·Amora 브리지로 갈 수 있다.

**필수 안전**

- 24시간 로컬 draft와 명시적 삭제
- 앱 종료·키보드·화면 전환 후 복구
- 계정 변경 시 이전 계정 draft 자동 노출 금지
- 텍스트 PII 서버 검사
- 이미지 EXIF 제거
- OCR 자동 마스킹을 제공하지 않는 동안 사진 속 개인정보는 자동으로 가려지지 않는다는
  명확한 경고
- 경고만으로 사진 안전을 보장하지 않는다. **통제 베타 P0에서는 이미지 발행을 off로
  확정한다.** UI뿐 아니라 signed upload URL, finalize API, storage policy가 새 업로드를 거절한다.
- P1 전수 검수를 열 때만 `draft_submitted → media_under_review → published/rejected`를 사용한다.
  모든 이미지가 승인되기 전에는 글도 공개하지 않고, 작성자에게 “사진 제거 후 텍스트만 발행”과
  “제출 취소”를 제공한다.
- 검수 원본은 private quarantine의 시간 제한 1회용 URL로만 열고 reviewer·열람 시각·판정·hash를
  감사한다. 승인 시 재인코딩 derivative만 공개하고 raw는 24시간 안에 삭제한다. 거절·철회는
  즉시 원본과 파생물을 삭제한다.
- 검수되지 않은 OCR을 “개인정보 자동 제거”로 표시하지 않는다.
- 업로드·DB 발행의 부분 실패를 성공으로 표시하지 않음
- AI가 제안한 문구는 사용자가 승인하기 전 게시하지 않음
- 모든 AI 호출은 ai_interactions_log에 기록

모바일 제목은 AI 또는 규칙이 제안하고 사용자가 수정할 수 있게 하되, 본문 입력 전에
필수로 요구하지 않는다. 웹 SEO 공개 후보는 검수 단계에서 제목을 별도 다듬는다.

### 6.6 글 상세

상단부터 다음 흐름이 한 화면에서 읽혀야 한다.

1. 질문·경험과 출처
2. 적용 조건
3. 사람 답변
4. 질문자의 적용성 판단
5. 선택한 다음 행동
6. Amora로 가져오기
7. 결과 예정 또는 실제 결과

네트워크 오류, 삭제, 권한 없음, 실제 0답변 상태를 같은 빈 화면으로 처리하지 않는다.

질문·답변 수정은 “수정됨” 시각과 revision을 남긴다. 이미 답변이 달린 질문의 핵심 대상·조건을
바꾸려 하면 기존 답변의 문맥을 훼손하므로 새 thread 작성과 기존 thread 연결을 제안한다.
오탈자·PII 제거 같은 minor edit도 출처·광고·PII 검사를 다시 통과해야 한다.

| 상태 | 사용자 표시 | 행동 |
|---|---|---|
| 로드 실패 | “불러오지 못했어요” | 재시도 |
| 권한 없음 | 공개 범위 설명 | 이전 화면 |
| 삭제·숨김 | 이용 불가 이유 범주 | 이의제기 또는 이전 화면 |
| 답변 0개 | “아직 사람 답변을 기다리고 있어요” | 나도 궁금해요, 답변 요청 상태 |
| 답변 있음 | 출처별 답변 | 적용성 표시, 더 물어보기 |

### 6.7 답변

답변 시작은 전체 에디터가 아니라 15초 구조를 우선한다.

1. 직접 겪었나요?
2. 언제·어떤 단계였나요?
3. 실제로 무엇을 했나요?
4. 결과는 어땠나요?
5. 다음 커플이 확인할 것 한 가지
6. 업체·혜택·업계 관계

사용자는 긴 자유 답변으로 확장할 수 있다. 답변 작성자에게 공개되지 않아야 하는 질문자의
private 예산·파트너 대화·정확한 일정은 전달하지 않는다.

### 6.8 질문자의 적용성 판단

일반 “채택” 하나로 정답을 만들지 않는다. 여러 답변에 각각 다음을 표시할 수 있다.

- 우리에게 해당돼요
- 조건이 달라요
- 더 확인할게요
- 다음 행동으로 가져왔어요

이 반응은 질문자와 연결된 파트너만 결정 신호로 사용할 수 있다. 일반 사용자의 helpful은
품질 보조 신호일 뿐 질문자의 적용성을 대신하지 않는다.

### 6.9 파트너 결정 — P1

커뮤니티 글은 파트너에게 자동 공유하지 않는다.

1. 사용자가 특정 답변과 자신의 요약을 선택한다.
2. 공유 전 공개 글의 출처·조건과 private 메모 범위를 분리해 preview한다.
3. 파트너는 “우리에게 해당”, “조건 다름”, “대화 필요”를 private로 남긴다.
4. Amora는 승자를 판정하지 않고 같은 점·다른 점·확인할 한 가지를 정리한다.
5. 공동 예산·일정·전체 업체 선택처럼 영향이 큰 변경은 동일 proposal version을 양쪽이
   실제로 본 뒤 승인한다.
6. 한 사람만 승인했다면 공동 합의로 기록하지 않는다.

private Amora 상담과 파트너의 private 반응은 커뮤니티에 절대 환류하지 않는다.

### 6.10 Community → Amora → 실행

**Amora에서 검토하기** 흐름:

1. 사용자가 참고할 답변을 직접 선택한다.
2. 서버가 canonical 글·답변·출처·시점을 다시 읽는다.
3. Amora는 확인된 사실, 개인 경험, 조건 차이, 미확인을 구분한다.
4. Amora는 다음 행동을 최대 한두 개 제안한다.
5. 예산·할 일·일정 변경이 있으면 이전 값과 새 값을 보여준다.
6. 사용자가 수정·승인한다.
7. 공동 영향이면 기존 커플 승인 경계를 사용한다.
8. 서버가 기존 plan change·tool execution 경계에서 원자 적용한다.
9. decision_nodes와 실행 영수증을 기록한다.
10. read-after-write로 실제 반영 상태를 다시 보여준다.

AI는 사람 답변을 “검증된 사실”로 승격하지 않는다. 서로 충돌하는 답변은 합의처럼
요약하지 않고 조건 차이와 확인 질문을 보여준다.

**되돌리기**

- DB 과거 행을 삭제하거나 시간 롤백하지 않는다.
- 이전 before snapshot으로 새 보상 변경안을 만든다.
- 현재 상태가 당시 after snapshot과 같을 때만 즉시 제안한다.
- 중간 변경이 있으면 stale로 닫고 사용자가 다시 비교하게 한다.

### 6.11 결과 업데이트

결정 뒤 적절한 시점에 한 번만 묻는다.

> 그때 확인한 일이 실제로 어떻게 됐나요?

최소 입력:

- 실제로 한 행동
- 결과
- 다음 커플에게 적용될 조건
- 공개 범위
- 업체·혜택 관계 변화

질문자가 결과를 공개하지 않아도 private 결정과 실행 영수증은 유지된다. 공개 해결 기록
projection은 기여자별 동의, PII, 출처, 광고 검사를 통과해야 한다.

### 6.12 도움의 영수증

답변자에게는 실제 발생한 행동만 알려준다.

- 질문자가 이 답변을 “우리에게 해당”으로 표시했어요.
- 이 답변을 바탕으로 업체에 포함 범위를 확인했어요.
- 결과가 업데이트됐어요.

좋아요 수를 과장하거나 “몇 명의 결혼을 구했다” 같은 추정 문구를 만들지 않는다.
질문자의 행동·결과 문구와 수신자는 질문자가 preview하고 별도 동의한 경우에만 답변자에게
전송한다. 적용성 신호를 눌렀다는 이유만으로 private 행동을 자동 공개하지 않는다.

### 6.13 알림함

P0 알림:

1. 내 질문에 첫 사람 답변
2. 내 답변에 질문자의 후속 질문
3. 질문자가 내 답변을 적용성 신호로 표시
4. 내가 팔로우한 thread의 결과
5. 내가 승인해야 하는 커플 변경

P1 opt-in 알림:

- 내 최근 경험과 정확히 맞는 답변 요청
- 동기방 주간 요약
- 결과 확인 예정일

정책:

- 알림 종류별 on/off
- 조용한 시간
- topic mute
- 사용자 차단과 업체·주제 숨기기. 차단은 신고를 대신하지 않으며, 차단된 계정은 새 답글·태그·
  직접 알림을 만들 수 없다.
- 같은 thread 중복 억제
- 읽은 anchor로 정확한 deep link
- 로그아웃·커플 해제·계정 변경 후 이전 수신자 차단
- 푸시 거절 뒤 반복 권한 요청 금지
- 긴급·마감 표현은 실제 사용자 입력 또는 공식 근거가 있을 때만 사용
- OS 푸시 권한은 로그인 직후 요구하지 않는다. 첫 사람 답변을 기다리거나 사용자가 알림함에서
  직접 켠 시점처럼 가치가 설명되는 순간에 사전 안내 후 한 번 요청한다.
- 인앱 알림 종류 동의와 OS 외부 push 동의를 분리한다. 직접 답글도 인앱은 on일 수 있지만
  외부 push는 종류별 opt-in이며, responder request·주간 요약·outcome reminder 같은
  비거래성 push는 기본 off다.
- 잠금화면 기본 문구에는 본문, 업체명, 지역, 날짜, 금액을 넣지 않고 “새 답변이 도착했어요”처럼
  일반화한다. 상세 preview는 사용자가 별도로 opt-in한다.
- push token은 기기별로 저장하고 로그아웃·권한 철회·token rotation 때 폐기한다.
- 통제 베타 비거래성 push는 opt-in 뒤에도 사용자당 24시간 1개·7일 2개를 기본 상한으로 하고,
  outcome reminder는 1회만 보낸다. direct reply·partner approval은 thread별 coalescing한다.

### 6.14 동기방

동기방은 선택 가입이며 정확한 방을 보여주고 가입시켜야 한다.

P0:

- 같은 넓은 시기·단계
- 최신 활동과 운영 가능 여부
- 방 규칙과 알림 범위
- 정확한 join target
- 문자 채팅, 신고, 나가기

P1:

- 이번 주 정할 한 가지
- 답이 필요한 질문
- 이번 주 작은 승리
- 하지 않기로 해서 편해진 것
- 결과가 돌아온 기록

정보게시판·타임라인이 실제 기능이 아니면 placeholder 탭을 노출하지 않는다. 방 안의
질문을 공개 검색 자산으로 바꿀 때는 작성자와 답변자의 별도 동의를 받는다.

### 6.15 My와 기여 프로필

보여줄 것:

- 내가 기다리는 답
- 내가 남긴 사람 답변
- 돌아온 결과
- 저장한 해결 기록
- 내가 선택한 공개 범위
- 알림·topic mute·quiet hours
- 차단한 사용자·숨긴 업체와 주제

P2 신뢰 표식:

- 직접 경험 범위
- 결과까지 돌아온 답변
- 광고·혜택 투명 공개
- 정정 책임

보이지 않을 것:

- 전역 팔로워 수
- 활동량 순위
- 지출 순위
- 외모·예식 규모 순위
- 연속 출석 streak

### 6.16 시각 계층 계약

현재 `DESIGN.md`의 quiet editorial utility를 그대로 사용한다. 이 항목은 구현 토큰 계약이며
Lazyweb·실기기 화면 검증을 통과했다는 뜻은 아니다.

**한눈에 읽히는 순서**

1. 이 글이 내 조건과 왜 가까운지
2. 실제 사람인지, 어떤 관계인지
3. 질문·결과의 핵심 한 문장
4. 지금 가능한 행동 하나
5. 답변 수·저장·부가 정보

**기본 시각 규칙**

- Paperlogy 단일 family를 유지한다. 화면 제목 24~30, section 18~20, 본문 16,
  meta 12~14 범위에서 weight·간격으로 계층을 만든다.
- 배경은 Pearl Ivory `#FBF8F2`, 본문과 높은 신뢰 표시는 Eucalyptus Ink `#36534E`,
  선택·주요 행동 하나만 Dusty Mauve `#A77B74`, 해결·검증은 Sage `#6D806E`를 사용한다.
- danger red는 개인정보·신고·실패처럼 실제 위험에만 쓴다. 광고·업체·인기 표시를 화려한
  컬러 경쟁으로 만들지 않는다.
- screen padding 20, card/row 내부 16~20, section gap 20~24, row gap 8~12를 기준으로 한다.
- card 안에 card를 넣지 않는다. trust line, context, body, action을 border와 spacing으로
  나누고 그림자는 상단 인박스나 일시적 overlay처럼 계층이 필요한 곳에만 쓴다.
- 피드 본문은 기본 2~4줄에서 읽을 수 있게 하고 펼치기 전에도 질문·결과가 잘리지 않게 한다.
- 카드마다 filled primary action은 최대 하나다. 저장·신고·조건 다름은 quiet icon/text action이다.
- 새 글쓰기는 한 손으로 닿는 고정 `+ 글쓰기` 진입 하나만 유지하고 상단·FAB·빈 상태에 같은
  강도의 CTA를 중복하지 않는다.
- 상태는 색만으로 표현하지 않고 icon·짧은 text·접근성 label을 함께 쓴다.
- press feedback은 80ms, 화면·step 전환은 160~220ms를 기본으로 하며 decorative scroll
  motion을 넣지 않는다. reduced motion에서는 즉시 최종 상태를 보인다.

첫 viewport에는 상단 chrome, 개인 인박스 한 줄, 첫 실제 사람 글이 함께 보여야 한다. 320px와
최대 지원 Dynamic Type에서는 상단을 제목+검색/알림 icon 한 줄, 접힌 인박스 한 줄, tab 한
줄로 제한하고 첫 카드의 질문 문장과 주 행동이 viewport 안에 보여야 한다. 큰
마케팅 hero, category carousel, 동기방 홍보, 가짜 통계를 이 영역에 넣지 않는다.

---

## 7. 웹 설계

### 7.1 공개 검색

검색 결과는 다음 우선순위를 사용한다.

1. 조건이 비슷한 completed 해결 기록
2. 사람이 답한 resolved 기록
3. 답변이 필요한 최신 질문
4. 광고·협찬은 organic 결과와 분리된 별도 영역

필터:

- 준비 단계
- 넓은 지역
- 계약 전·후
- 결과 있음
- 사람 답변 있음
- 글 형식

### 7.2 공개 해결 기록

원시 thread를 그대로 SEO 페이지로 만들지 않는다. 공개 후보는 다음을 통과한다.

- 작성자·답변자 결과 공개 동의
- content_origin 분류
- sponsorship_detail 표시
- PII 제거
- 결과 또는 실제 다음 행동 존재
- 오래된 조건의 기준 시점 표시
- canonical과 soft-404 정책
- 운영자 검수

검색 공개는 `draft → review → approved → published_indexable → withdrawn`의 별도
`search_publication_status`를 사용한다. 커뮤니티의 원본 UGC와 private outcome은 기본
`noindex`이며, 승인된 공개 해결 기록 projection만 canonical URL을 가진다. 구조화 데이터는
출시 시점의 검색엔진 정책을 다시 확인하고 실제 화면에 보이는 작성자·질문·답변·선택 상태만
표현한다. 질문자가 실제로 선택하지 않은 답변을 accepted answer로 꾸미지 않는다.

`published_indexable`은 우리 서버의 의도이지 실제 검색엔진 색인을 뜻하지 않는다. 발견·색인은
Search Console 등 외부 관측값으로 별도 저장하고, 색인이 확인되지 않은 페이지를 “검색 노출됨”으로
보고하지 않는다. withdrawn은 sitemap·structured data·canonical projection·CDN을 제거하고
noindex와 404/410 정책을 실행한다. 검색엔진 cache 제거가 즉시 보장되지는 않음을 동의 화면과
사고 runbook에 명시한다.

업체명이 남는 공개 해결 기록은 추가 증빙·정책 검수와 별도의 공식 답변 경로를 제공하되 회원
경험을 업체 승인에 종속시키지 않는다. 사용자 외부 링크의 search attribute는 출시 시점의 공식
검색 정책을 다시 확인해 UGC·광고 관계에 맞게 적용한다.

페이지는 다음 순서로 보여준다.

1. 고민
2. 당시 조건
3. 사람 경험의 차이
4. 질문자가 확인한 행동
5. 결과
6. “내 조건으로 Amora와 정리하기”

### 7.3 웹에서의 Amora 브리지

로그인 전에는 글 링크와 공개 조건만 prefill한다. 로그인 후에도 private 준비 데이터는
사용자가 명시적으로 “내 상황으로 보기”를 선택한 경우에만 결합한다.

브리지 후에는 웹과 모바일 모두 같은 proposal, approval, receipt 의미를 사용한다.

### 7.4 웹 시각·반응형 구조

- 검색 화면은 넓은 desktop에서 filter rail, 680~760px reading column, optional Amora context
  rail을 사용한다. 결과 목록 자체는 가운데 읽기 축을 벗어나지 않는다.
- 해결 기록 상세는 본문을 한 reading column에 두고 당시 조건·출처·수정 시각을 바로 옆
  또는 상단에 고정한다. Amora CTA는 내용을 읽기 전 hero를 가리지 않고 선택·결과 뒤에 둔다.
- 1024px 아래에서는 rail을 filter sheet와 inline CTA로 접고, 640px 아래에서는 모바일의
  같은 trust line·상태·행동 순서를 사용한다.
- search result는 제목보다 조건·사람 답변·결과 유무가 먼저 scan되게 하며, 장식 thumbnail이
  없다는 이유로 빈 card처럼 보이지 않게 typography와 spacing으로 밀도를 만든다.
- sticky CTA는 키보드·cookie notice·safe area와 겹치지 않아야 하며 화면을 가리는 newsletter,
  앱 설치 interstitial, 자동 modal을 쓰지 않는다.

---

## 8. 피드와 참여 설계

### 8.1 Reader → Helper 단계

| 단계 | 허용 행동 | 다음 단계로 가는 계기 |
|---|---|---|
| Reader | 읽기, 검색, 저장 | 관련성 확인 |
| Reactor | 나도 궁금해요, 투표, 조건 다름 | 낮은 부담의 반응 |
| Contributor | 15초 답변, 짧은 후기 | 내 경험이 특별히 필요하다는 요청 |
| Collaborator | 후속 답변, 결과 확인 | 질문자의 실제 행동 |
| Guide | 취약 질문 지원, 정정 | 품질과 투명성이 반복 검증됨 |

신규 사용자를 바로 장문 작성자나 멘토로 만들지 않는다.

### 8.2 피드 ranking 계약

ranking은 다음 후보 신호를 사용하되 가중치는 실험 전 고정하지 않는다.

**가산 후보**

- 준비 단계·넓은 지역·시점 적합도
- 답변 필요도와 마감
- 사람 출처와 적용 조건의 완결성
- 결과 존재
- 최신성
- 사용자가 선택한 topic
- 같은 작성자·업체에 편중되지 않는 다양성

**감산·제외**

- 미분류 출처
- under_review·hidden
- organic 결과 안의 광고·협찬
- 반복 게시·도배
- 같은 업체·작성자 과다 노출
- 신고 위험과 개인정보 징후
- 자극적 반응만 높고 실제 도움 신호가 없는 글

ranking에서 조회수·좋아요는 보조 신호일 뿐이다. 갈등, 고가 소비, 외모 평가가 반응을
많이 받는다는 이유로 상단에 올리지 않는다.

### 8.3 투표

P0는 single-choice만 지원한다. 사용자가 먼저 선택한 뒤 전체 결과를 보여주는 방식을 기본
가설로 검증하며, 전체 다수 결과를 먼저 보여 판단을 대신하지 않는다.

- `(poll_id, user_id)` unique vote가 최종 option 하나를 가리킨다.
- poll은 version을 갖고 published 뒤 option·질문·mode를 동결한다.
- base poll·option table의 count 직접 SELECT 권한을 회수한다.
- viewer-aware read view/RPC만 count를 반환하며, 미투표·비허용 viewer에게는 count와 비율을
  `null`로 보낸다. UI 숨김만으로 계약을 구현하지 않는다.
- 다중 선택은 P1에서 `{desiredOptionIds[]}` 전체 set-intent, 최대 선택 수, 독립 migration과
  테스트가 있을 때만 연다.

### 8.4 게임화

P0에는 포인트·등급·리더보드를 도입하지 않는다.

P2에서 검토 가능한 보상은 실제 도움과 신뢰에만 연결한다.

- 결과까지 돌아온 경험
- 조건을 명확히 적은 답변
- 광고 관계를 투명하게 공개
- 잘못된 내용을 책임 있게 정정

배지를 도입해도 행동량이 아니라 품질을 설명하며, 획득 후 활동을 압박하지 않는다.

---

## 9. Amora 역할과 금지선

### 9.1 허용

- 사용자가 쓴 초안을 답하기 좋은 질문으로 정리
- 카테고리·제목·필요 조건 제안
- 텍스트 개인정보 경고
- 사람이 쓴 여러 답변의 공통점과 차이 정리
- 답변 출처와 시점을 인용
- 예산·할 일·일정 변경 제안
- outcome 질문 초안

### 9.2 금지

- 사용자 승인 없이 게시
- 사람인 척 글·답변·반응 생성
- AI 답변을 사람 답변 SLA에 포함
- 한 사람의 경험을 일반적 사실로 확정
- 업체 순위·가격·예약 가능성을 근거 없이 생성
- private 상담을 커뮤니티 초안이나 파트너 설득 근거로 재사용
- 승인 없이 예산·일정·할 일 변경
- 예약·결제·계약·취소·메시지 발송 자동 실행

### 9.3 로그와 결정

- 초안 정리, 답변 요약, 실행 제안 등 모든 AI 호출은 ai_interactions_log에 기록한다.
- 확정된 개인·커플 결정은 decision_nodes에 기록한다.
- 모델 문장이 아니라 서버가 확인한 tool receipt만 실행 성공의 증거다.
- community source는 post, answer, outcome의 stable id와 기준 시점을 가진다.

---

## 10. 데이터 아키텍처

### 10.1 기존 자산 재사용

| 기존 자산 | 재사용 범위 |
|---|---|
| community_posts | 공개 질문·경험 본문과 미디어 |
| community_comments | 사람 답변과 후속 답글 |
| content_origin·sponsorship_detail | 출처와 광고·혜택 |
| community_reply_notifications | 댓글·답글 원자 알림 |
| community_reports·moderation events/notices/appeals | 신고·조치·통지·이의제기 |
| cohort_rooms·members·messages | 제한적 동기방 |
| decision_nodes·decision_edges | 확정된 결정 정본 |
| couple_plan_change_requests·acceptances | 공동 변경 승인 |
| amora_tool_executions·mutation receipts | 원자 적용과 영수증 |
| ai_interactions_log | AI 호출 감사 |

기존 강한 승인·RLS·멱등 경계를 우회하는 커뮤니티 전용 실행기를 새로 만들지 않는다.

### 10.2 권장 신규 모델

#### community_decision_threads

- post_id와 1:1
- kind
- state
- version
- resolved_at
- outcome_due_at
- completed_at
- closed_reason
- 공개 가능한 coarse context만 저장

정확한 couple_id, 정확한 예식일, private 예산은 저장하지 않는다.

#### community_decision_thread_events

- thread 상태 변경의 append-only 원장
- actor, event type, before, after, reason, created_at
- 서비스 역할만 쓰기
- 상태 변경과 같은 트랜잭션

#### community_thread_evidence_selections

- P0는 질문자, P1은 유효한 grant를 가진 현재 파트너가 어떤 comment를 참고했는지
- applicability
- selected_at
- comment가 같은 post에 속하는지 DB에서 검증
- 여러 답변 선택 가능

#### community_decision_outcomes

- private canonical thread 결과 revision
- action taken
- result summary
- applicable conditions
- visibility와 공개 동의 버전
- supersedes_outcome_id
- 원문 덮어쓰기 금지

canonical outcome은 P0 작성자, P1 유효한 grant의 파트너만 읽는다. 공개에 동의한 경우에도
이 private 행을 직접 노출하지 않고, PII·출처·광고·운영 검수를 거친 별도 공개 해결 기록
projection을 만든다. 동의를 철회하면 projection을 withdrawn 처리하되 private 결정 이력은
해당 커플의 보존 정책에 따른다.

#### community_public_resolution_records

- search_publication_status
- 검수된 제목·요약·coarse context·기준 시점
- canonical path, published_at, withdrawn_at
- service-only base table과 public allowlist view 분리
- 원본이 숨김·철회되면 자동으로 신규 노출·새 Amora 적용을 차단
- 검색엔진 discovered·indexed 여부는 별도 observation source와 observed_at으로 기록

#### community_public_resolution_record_sources

- resolution_record_id, source_type, source_id, content_revision, disclosure_version, digest
- source 기여자별 subject consent version, consented_at, revoked_at
- source revision별 redaction diff와 발생 시점
- source FK는 hard cascade하지 않고 soft reference와 source_unavailable_at으로 보존

작성자·각 답변자·outcome 작성자의 동의를 하나의 thread consent로 뭉치지 않는다. 공개
projection은 원문에 없는 평가·순위·인과를 추가하지 않고, 동의가 철회된 source를 제거한 뒤에도
의미가 유지되지 않으면 전체 record를 withdrawn한다.

#### community_decision_applications

- private couple 영역
- thread와 선택 evidence에서 생성된 plan change 연결
- proposal digest와 version
- base journey revision
- tool execution 또는 mutation receipt id
- before·after 최소 영수증
- status
- reversal_of
- 실행 뒤 decision node 연결은 application row에 중복 저장하지 않고
  community_thread_decision_links에서 역참조

공개 thread와 private couple application 사이에 명확한 RLS 경계를 둔다.

#### community_thread_partner_grants — P1

- thread_id, couple_id, grantee_id
- `view_private_applicability`, `select_evidence`, `resolve`, `approve_application`의 명시적 scope
- roster_fingerprint, privacy_epoch, granted_by, granted_at, revoked_at
- 모든 read·mutation 때 현재 membership·roster·privacy epoch 재검증
- 커플 해제·멤버 변경·작성자 철회 시 즉시 revoke하고 cache·pending approval 무효화

P0에서는 이 table을 이유로 일정이 늦어지지 않게 lifecycle mutation을 작성자 전용으로 닫는다.
P1 partner flow를 열 때만 migration·RLS·두 기기 공격 테스트와 함께 활성화한다.

#### community_thread_decision_links

- thread·선택 evidence·outcome과 `decision_nodes`의 immutable 연결
- couple_id와 application_id는 private 영역에만 존재
- 누가, 어느 source revision을, 어떤 승인 아래 결정 근거로 사용했는지 기록
- source 철회 시 링크는 보존하되 `source_unavailable_at`을 기록하고 신규 재사용을 차단
- `(decision_node_id, couple_id)`와 `(application_id, couple_id)` composite FK
- source는 `(source_type, id, content_revision, disclosure_version, digest)`로 고정

`decision_nodes`를 만든 뒤 애플리케이션 코드에서 별도 INSERT해 느슨하게 연결하지 않는다.
결정 생성과 link 생성은 같은 승인된 DB 트랜잭션 안에서 성공하거나 함께 실패한다.
application과 node의 연결 정본은 이 link 하나이며 양쪽 table에 독립 mutable id를 중복 저장하지
않는다. community가 만든 decision edge의 from/to도 `(node_id, couple_id)` composite FK로
강제하고 일반 클라이언트 update·delete를 허용하지 않는다.

#### community_decision_notifications

- 첫 사람 답변, 적용성, 결과, follow-up 이벤트
- 고정 recipient
- dedupe key
- read_at
- delivery outbox reference

기존 reply notification은 유지하고, 클라이언트에는 두 저장소를 하나의 알림 read model로
제공한다. 초기 릴리스에서 안정된 기존 reply 원자 경로를 불필요하게 다시 작성하지 않는다.

#### notification_delivery_outbox · user_push_devices

- 알림 row 생성과 전달 요청을 같은 트랜잭션의 outbox event로 기록
- 기존 reply와 신규 decision notification을 받는 통합 delivery envelope
- `(notification_id, device_id)` delivery row, worker lease, attempt, next_attempt_at, terminal 상태
- 기기별 token, platform, last_seen_at, revoked_at, user binding epoch
- worker는 발송 직전 recipient·device binding epoch, preference, block·mute, visibility, thread state,
  source state, request expiry를 재검증
- inbox unique row는 exactly-once로 만들고, 외부 push는 provider collapse key를 쓰는
  at-least-once/best-effort로 정확히 표현
- push 전송 성공을 알림 읽음이나 사용자의 실제 수신으로 간주하지 않음
- logout·계정 변경·권한 철회 때 token binding을 즉시 폐기
- 닫힘·숨김·답변 완료·token revoke 뒤 stale delivery는 terminal-cancel

#### community_commands

- 모든 복합 mutation의 durable idempotency 원장
- `UNIQUE(actor_id, operation, idempotency_key)`
- versioned canonical payload hash와 hash schema version
- pending, leased, succeeded, failed, state_unconfirmed, terminal
- lease owner·expiry, attempt, next_attempt_at, recovery policy, retention
- result reference와 안전한 오류 범주
- 같은 key·같은 payload 재시도는 기존 결과, 다른 payload는 409

서버 프로세스 메모리나 앱 내부 중복 확인만으로 멱등성을 보장하지 않는다. 결과 미확인 상태에서도
새 실행을 만들지 않고 command receipt를 조회한다.

#### 기존 rate_limit_buckets 재사용

- user·device·위험도가 제한된 IP hash scope별 durable write budget
- thread, answer, vote, report, responder request를 서로 다른 bucket으로 분리
- 여러 서버 인스턴스에서 동일하게 적용
- 저장소 장애 시 공개 쓰기는 fail-closed하고 읽기는 유지

이미 있는 persistent weighted limiter와 pseudonymous retention 경계를 확장한다. 커뮤니티만의
평행 rate-limit table을 새로 만들지 않고 현재 process-local endpoint를 순차적으로 교체한다.

#### community_funnel_events

- 원문 없이 최소화한 product event와 schema version
- actor pseudonymous id, coarse surface, thread stable id, event_at
- private 예산·정확한 날짜·계약 문구·검색어·AI 대화 저장 금지
- 운영 감사 원장과 분석 event를 같은 용도로 재사용하지 않음
- retention·삭제 job과 접근 권한을 출시 전에 확정하고 무기한 보존하지 않음

#### community_content_disclosure_events

- post·comment별 content_origin, commercial relationship, verification level의 append-only revision
- actor, reason, subject vendor, experience occurred_at, effective_at, created_at
- 현재 표시값은 projection으로 읽고 과거 표시·정정 이력은 감사 가능
- 업체 관계 사후 확인, 검증 만료·취소, 작성자 정정을 원문 덮어쓰기 없이 반영

#### community_content_revisions

- post·comment id, monotonic version, actor, edit class, content digest, created_at
- 현재 본문과 제한된 감사 revision을 분리하고 삭제된 민감 원문을 분석 event에 복제하지 않음
- expected version 없는 edit 금지
- 답변이 달린 뒤 subject·핵심 조건을 바꾸는 major edit는 거절하고 linked thread를 새로 생성
- 모든 edit가 PII·출처·광고·moderation eligibility를 다시 계산

#### community_viewer_controls

- blocker_user_id와 blocked_user_id의 unique pair
- viewer별 muted topic과 hidden vendor subject
- created_at, revoked_at, reason category는 선택적이며 상대에게 공개하지 않음
- feed·search·reply·tag·responder request·notification eligibility가 같은 server view를 사용

#### community_responder_requests · responder_capacity_slots — P0

- 특정 경험자에게 보낸 opt-in 답변 요청
- 직접 경험 범위·시점, opt-in topic, 사용 가능 기간
- 업체·업계 conflict와 commercial relationship
- requested, accepted, declined, expired
- cooldown과 주간 요청 한도
- 동시 open request 수와 이미 소비된 slot

confirmed slot은 해당 기간에 opt-in했고 conflict가 없으며 다른 동시 질문에 소비되지 않은
명시적 accepted 1건만 센다. 후보 사용자 수, 발송 수, 수락 수, 실제 답변 수를 같은 숫자로
취급하지 않는다.

### 10.3 기존 컬럼 확장 후보

- community_posts.post_format
- community_posts.topic_category
- community_posts.publication_state
- community_posts.audience_scope와 cohort_id
- community_comments.response_kind
- community_comments.evidence_basis
- community_polls.version과 mode
- community_posts·comments.commercial_relationship
- community_posts·comments.identity_verification_level
- community_posts·comments.subject_vendor_id
- community_posts·comments.experience_occurred_at
- community_posts·comments.disclosure_version

새 enum은 과거 클라이언트와 mixed-version 호환을 고려해 additive migration으로 추가한다.

`content_origin`은 **누가 말하는가**, `commercial_relationship`은 **어떤 경제적 관계가
있는가**, `identity_verification_level`은 **얼마나 확인됐는가**를 각각 표현한다. 세 축을
하나의 “인증됨” 배지로 합치지 않는다. 경제적 관계는 최소 none, gift, discount, refund,
affiliate, paid, employee, owner_or_family, platform_research_compensation을 구분하고
`commercial_counterparty_type/id`, benefit_occurred_at를 함께 기록한다. 검증은 self_declared,
manually_verified, document_verified, expired, revoked를 구분한다. 공개 카피는 내부 enum을
그대로 노출하지 않고 사용자가 이해할 수 있는 관계 문장으로 변환한다.

founding cohort 보상은 시간·연구 참여의 대가이며 긍정 콘텐츠 대가가 아니다. 보상받은 사용자의
공개 글에는 platform research compensation을 별도 표시하고, 특정 업체나 긍정 결과를 요구하지
않는다. 업계 종사자는 답변마다 현재 소속·소유·대행·추천 수수료 관계를 다시 확인한다.

### 10.4 핵심 불변조건

1. thread 작성자와 post 작성자는 같다.
2. 선택 evidence comment는 같은 post에 속한다.
3. 사람 답변 집계는 질문자 본인을 제외하고 필수 경험 rubric을 통과한 member 또는
   industry_professional의 answer·experience만 포함한다. peer-member와 professional view를
   분리하고 vendor official·operator·AI는 peer SLA에서 제외한다.
4. 상태 변경, event, 필요한 알림은 한 트랜잭션이다.
5. 자기 자신에게 생긴 알림은 0건이다.
6. 같은 idempotency key가 다른 payload로 재사용되면 409다.
7. public thread에 couple_id, 정확한 예식일, private 예산이 들어가지 않는다.
8. application은 현재 couple membership, roster, proposal digest, base revision, 승인 정책을
   모두 검증한다.
9. AI 출력은 사람 답변이나 사용자 결과가 아니다.
10. public resolution projection은 기여자별 동의·PII·광고·출처 검사를 통과한다.
11. 삭제된 다른 사용자의 원문을 private decision에 복제하지 않는다.
12. source가 철회되면 이미 확정된 사용자의 결정은 남되 “원문 이용 불가”를 표시하고
    새 적용은 차단한다.
13. `resolved`는 커뮤니티 해결 상태이며 `decision_nodes` 생성이나 도구 실행 성공을 뜻하지 않는다.
14. community가 만든 `decision_edges`의 양 끝 node는 같은 couple scope에 속하며 DB에서
    검증한다. cross-couple edge는 애플리케이션 코드 관례만으로 막지 않는다.
15. P0 poll vote는 toggle이 아니라 최종 option set이며 `(poll_id, voter_id)`당 하나다.
    base count는 viewer-aware read 경계 밖에서 읽을 수 없다.
16. 공개 해결 기록은 private canonical outcome을 직접 조회하지 않는다.
17. Amora proposal과 evidence selection은 source stable id뿐 아니라 content revision을 고정한다.
18. outcome supersedes는 같은 thread 안의 이전 revision만 가리키고 cycle을 허용하지 않는다.

---

## 11. API 계약

모든 mutation은 인증된 same-origin 또는 검증된 Bearer 요청을 받는 서버 API를 거친다.
클라이언트가 service-only 필드, content_origin, moderation 상태, 집계값을 직접 쓰지 못한다.

### 11.1 읽기

| 목적 | 계약 |
|---|---|
| 피드 | cursor 기반, mode는 for_you / needs_help / outcomes, eligibility 서버 적용 |
| 상세 | post, thread, qualified answer state, outcome, viewer permissions |
| 알림 | recipient 고정, cursor, unread count |
| 운영 health | service role, 사람 답변·신고·출처·공급·부하 지표 |

### 11.2 쓰기

| 목적 | 필수 검증 |
|---|---|
| thread 발행 | PII, 공개범위, 출처, 광고관계, idempotency, upload finalize |
| 답변 | PII, 정지 상태, thread visibility, idempotency |
| 글·답변 수정 | 작성자, expected content version, major edit 금지, PII·출처·광고 재검사 |
| 투표 | toggle 금지, desired option 또는 remove 의도, 현재 poll version, idempotency |
| 적용성 | P0 작성자, P1 유효한 partner grant, 같은 thread·source revision evidence |
| 상태 전환 | actor 권한, expected version, event 원자 기록 |
| Amora 정리 | canonical source 재조회, ai_interactions_log |
| plan 적용 | 기존 approval policy, proposal digest, base revision |
| outcome | 작성자 권한, consent, PII, provenance, version |
| 공개 해결 기록 | service-only, source별 consent·revision·redaction·disclosure, publication state |
| 공개 동의 철회 | 각 source 기여자, consent version, projection 재작성 또는 withdrawn |
| mute·block | viewer 본인 권한, target 존재, 신고와 독립된 viewer policy |
| push device | 현재 세션·기기 binding, token rotation·revoke |
| 신고·이의제기 | 중복·자기 신고 방지, append-only audit |

### 11.3 오류 의미

| 코드 | 의미 |
|---:|---|
| 400 | 형식이 잘못됨 |
| 401 | 로그인 필요 |
| 403 | 권한·공개범위·정지 상태 위반 |
| 404 | 존재하지 않거나 읽을 수 없음 |
| 409 | stale version, 중복, idempotency payload mismatch |
| 422 | 개인정보·광고표시·콘텐츠 안전 검사 실패 |
| 429 | 작성·답변·알림 요청 제한 |
| 503 state_unconfirmed | 결과 미확인; operation id로 command 상태를 조회하고 같은 key 외 재실행 금지 |
| 5xx | 서버 실패; 클라이언트는 성공으로 표시하지 않음 |

성공 응답도 의미를 구분한다. `201`은 durable receipt까지 확인된 생성, `200`은 기존 command
재생 또는 확정된 변경, `202 pending_partner_approval`은 아직 plan에 반영되지 않은 승인 대기다.
클라이언트는 202를 완료 toast나 완료 상태로 표시하지 않는다.

- 202: “파트너 확인 전이며 아직 반영되지 않았어요.”
- 409 stale: “준비 상태가 바뀌어 다시 확인해야 해요.”와 최신 diff
- 503 state_unconfirmed: “반영 여부를 확인 중이에요. 다시 실행하지 마세요.”와 상태 조회
- confirmed failure: 입력과 source 선택을 보존하고 안전한 재시도 시점 표시

댓글 원자 RPC가 authenticated 클라이언트에 직접 노출되어 API의 PII 검사를 우회할 수 있는
현재 경로는 P0에서 닫는다. 클라이언트는 API만 호출하고 RPC 실행은 서비스 경계 안에서
수행한다.

---

## 12. 원자성·멱등성·복구

### 12.1 thread 발행

한 번의 logical operation에 다음이 모두 포함된다.

- post
- decision thread
- poll 또는 format metadata
- media attachment finalize
- event

부분 실패 시 공개 post만 남거나 poll만 빠지는 상태를 성공으로 반환하지 않는다. 하나의
서버 orchestration과 operation receipt를 사용한다.

현재 경로처럼 post 생성 뒤 poll·attachment를 별도 요청으로 이어 붙이는 방식은 신규
DecisionThread에 사용하지 않는다. `community_commands`의 payload hash를 먼저 고정하고,
DB transaction 또는 transaction을 소유한 RPC 한 번으로 canonical row와 event를 만든 뒤
외부 파일 finalize는 outbox·보상 상태를 통해 확정한다.

P1 media review를 열어도 파일은 처음부터 public bucket에 올리지 않는다. 사용자별 quarantine
key로 업로드하고,
소유권·MIME·크기·디코딩·재인코딩·메타데이터 제거와 필요한 사람 검수를 통과한 뒤에만
attachment를 publishable로 승격한다. DB 발행이 실패한 파일과 만료된 draft는 idempotent
garbage collector가 제거하며, `under_review` 파일에는 공개 CDN URL을 발급하지 않는다.
command는 이 전체 과정에서 pending이고, 모든 derivative와 post의 publication_state가
published로 확정된 뒤에만 성공 receipt를 반환한다.

공개 이미지 PII 사고 runbook은 post hide → signed URL revoke → derivative·CDN purge → 검색
긴급 제거 → 최소 incident receipt 보존 순서로 drill한다. raw TTL·purge 증거가 없으면 media
feature는 계속 off다.

### 12.2 답변

기존 댓글 원자 경계를 확장해 다음을 한 번만 만든다.

- comment
- counter
- reply notification
- qualified answer 판정이 새로 생긴 경우 thread event

응답 유실 뒤 동일 idempotency key로 재시도하면 기존 결과를 반환한다.

### 12.3 투표

투표 API는 “현재 값을 반전”하지 않고 최종 의도를 set한다.

    PUT /community/polls/{pollId}/vote
    { desiredOptionId: string | null, pollVersion, idempotencyKey }

같은 요청이 재시도돼도 선택이 다시 취소되지 않는다. poll option 변경과 stale version은
409로 돌려주고 최신 선택 상태를 함께 제공한다.

### 12.4 상태와 결과

- expected thread version을 요구한다.
- completed outcome은 수정이 아니라 superseding revision으로 남긴다.
- moderation 상태는 결정 상태를 몰래 바꾸지 않는다.
- 숨김·삭제된 thread는 새 Amora 적용을 막는다.

### 12.5 실행

Amora 적용은 다음 순서를 지킨다.

    proposal 생성 → 사용자가 본 digest 고정 → 승인
    → membership·roster·revision 재검증 → 원자 적용
    → decision_nodes → read-after-write receipt

결과가 unknown이면 자동 재실행하지 않는다. 같은 operation receipt를 조회한다.

현재 의사결정 helper의 애플리케이션 레벨 중복 확인과 node·edge 후속 기록은 신규 community
경로의 원자성 근거로 사용하지 않는다. proposal 승인, decision node·edge·source link,
tool receipt는 트랜잭션을 소유한 서버 경계를 통해 기록한다.

### 12.6 Realtime과 재동기화

- public·members 공개 범위에서 안전하게 투영된 post·answer·thread version event만 realtime로
  전달한다.
- private applicability, partner approval, application, decision node, AI 대화 원문은 공개
  channel에 실지 않는다. push/deep link 뒤 인증된 read API로 다시 가져온다.
- event는 entity id, version, event id만 최소 전달한다. 클라이언트가 version gap, 역순,
  권한 변경을 감지하면 로컬 patch를 이어 붙이지 않고 canonical read를 refetch한다.
- 로그아웃·커플 해제·block·visibility 변경 때 subscription과 cache를 폐기한다.
- realtime은 정본이 아니라 invalidation hint다. 앱 foreground·deep link 진입 때 canonical read를
  다시 가져오며 audience·block·privacy epoch 변경은 revocation tombstone 또는 강제 cache purge를
  전달한다. revoke hint가 유실돼도 foreground refetch가 stale private data를 제거해야 한다.

---

## 13. RLS와 개인정보

### 13.1 공개와 private 경계

| 데이터 | 공개 커뮤니티 | 연결된 파트너 | 본인만 | 운영자 |
|---|---:|---:|---:|---:|
| public post·answer | 조건 충족 시 | 예 | 예 | 예 |
| cohort post·message | 방 회원만 | 자동 아님 | 방 회원이면 | 필요 범위 |
| evidence selection | 요약 상태만 선택 가능 | 정책에 따라 | 예 | 감사 필요 시 |
| private applicability note | 아니오 | 사용자 선택 시 | 예 | 기본 아니오 |
| plan application | 아니오 | couple policy | 예 | 운영 복구 범위 |
| private budget·schedule | 아니오 | couple policy | 예 | 최소 권한 |
| AI 원문·private 상담 | 아니오 | 자동 공유 금지 | 예 | 승인된 지원 절차 |

### 13.2 공개 컨텍스트

허용 가능한 기본값:

- 넓은 지역
- 예식 월·분기 또는 준비 단계
- 계약 전·후
- 금액 범위 또는 사용자가 직접 허용한 값

기본 금지:

- 정확한 예식일
- 정확한 주소
- 전화·이메일·계좌·주민번호
- 서명
- 계약서 원본
- 파트너의 이름·의견·private 대화

일반 회원은 공개 화면에서 pseudonymous nickname을 사용하고 법적 실명을 요구하지 않는다.
다만 플랫폼 운영상 계정과 연결될 수 있으므로 “완전 익명”이라고 약속하지 않는다. 업체 공식
신원 검증 문서는 일반 회원 콘텐츠와 분리된 최소 권한 저장소에 두고 공개 화면에는 필요한
badge·관계·검증 유효기간만 보여준다.

### 13.3 계정 삭제와 콘텐츠 철회

- 작성자는 자기 공개 콘텐츠를 철회할 수 있다.
- moderation·신고 감사 원장은 법률·정책 검토 범위에서 최소 정보만 보존한다.
- 다른 커플의 decision_nodes에는 삭제된 원문을 복사해 남기지 않는다.
- 이미 내린 커플 결정은 사용자의 결정 기록으로 남되 source unavailable 상태가 된다.
- 검색 페이지는 삭제·숨김 후 canonical 제거와 soft-404 절차를 따른다.
- 캐시·푸시·deep link가 이전 계정·커플 정보를 다시 노출하지 않아야 한다.

### 13.4 차단·숨기기·신고

- 사용자 차단은 viewer별 feed·검색·알림 read model에 즉시 반영한다.
- 차단된 사용자는 차단자에게 답글·태그·직접 responder request를 만들 수 없다.
- 업체·주제 숨기기는 해당 subject의 추천을 제외하지만, 법적·안전 공지를 가리지는 않는다.
- 차단은 상대 콘텐츠의 원본 삭제나 moderation 판정이 아니며 상대에게 차단자 신원을 알리지 않는다.
- 신고는 별도의 safety 경로다. 차단했어도 신고 증거와 appeal 원장은 유지된다.
- 파트너가 연결돼 있다는 이유만으로 한 사람의 차단 목록·신고 내역을 다른 파트너에게 공개하지 않는다.

| 표면 | 차단 후 동작 |
|---|---|
| 로그인 앱 feed·search | 서로의 새 콘텐츠와 추천을 제외 |
| 기존 공동 thread | 기존 답변은 “차단한 사용자의 답변”으로 접고 새 reply·tag·요청 금지 |
| 같은 cohort room | 메시지 접기, 직접 mention·notification 금지, 나가기·신고 제공 |
| 로그인 웹 | 같은 viewer control 적용 |
| 로그아웃 공개 URL | 공개 콘텐츠 자체의 삭제를 보장하지 않음을 차단 전 설명 |

공개 URL까지 제거해야 하는 안전 문제는 차단이 아니라 신고·moderation으로 처리한다.

---

## 14. 출처·광고·업체 경계

### 14.1 영구 표시

모든 공개 글과 답변은 다음 중 하나를 가진다.

- 일반 회원 경험
- 업계 종사자 경험
- 업체 공식 답변
- 웨딩한방 운영자
- AI 정리
- 검증되지 않은 과거 콘텐츠

혜택이 있다면 광고, 협찬, 제공, 할인, 임직원·관계자 여부와 대가 상세를 첫 화면에서
확인할 수 있어야 한다.

### 14.2 업체 공식 답변

현재 industry_professional 수동 분류만으로 “업체 공식”을 표현하지 않는다.

업체 공식 답변을 열기 위한 선행 조건:

- 검증된 vendor identity와 사용자 연결
- 답변 가능한 vendor 범위
- 업체 공식 배지
- 자사 조건 설명 전용 레인
- 자기 글·경쟁사 글의 투표·집단 신고 제한
- 회원 경험 삭제 권한 없음
- 모든 수정 이력

검증 객체는 canonical vendor·지점·법인·대행사 관계, representative role, verified_at,
expires_at, revoked_at를 가진다. 만료·퇴사·대행 종료 즉시 공식 작성 권한과 badge를 회수한다.
업체는 자기 subject의 사실 설명 레인 밖에서 경쟁사 평가, 회원 DM, private profile 조회,
신고 수 확인, 삭제·ranking 권한을 갖지 않는다. 공식 답변은 회원 경험 뒤 별도 레인에 표시하고
peer SLA·합의·도움 지표에서 제외한다.

이 조건 전에는 업계 종사자 답변만 허용하고 공식 업체 답변이라는 표현을 쓰지 않는다.

### 14.3 organic ranking

- 광고·협찬은 organic 인기·추천·검색 결과에서 제외한다.
- 별도 sponsored 영역도 MVP에서는 열지 않는다.
- 업체 관계가 사후 확인되면 origin·disclosure 재분류 이벤트를 남긴다.

---

## 15. 모더레이션과 운영자 제품

### 15.1 운영자 큐

운영자 홈은 다음 순서를 사용한다.

1. 신체 안전 위협, 자해·폭력·스토킹·doxxing 의심
2. 개인정보 의심
3. 24시간 임박 신고·이의제기
4. 미답변·마감 임박 질문
5. 출처 미분류
6. 업체·협찬 관계 의심
7. 답변자 공급 부족
8. outcome 공개 검수
9. 검색 색인 후보

### 15.2 필요한 운영 기능

- 신고 접수·증거·대상·중복 확인
- 숨김·복원·통지
- 작성자 이의제기 검토와 결정
- append-only event
- 출처 재분류
- responder request 생성·거절·만료
- 질문별 답변 슬롯
- read-only·write fence
- 운영 health와 주간 투명성 보고

주간 투명성 보고는 작은 cohort가 재식별되지 않도록 small-cell suppression과 범주 합산을 적용하고
개별 reporter·질문자·업체 관계를 역추론할 수 있는 조합을 공개하지 않는다.

현재 이의제기 개수는 볼 수 있지만 검토·결정 API와 UI가 완결되지 않은 공백을 P0에서
닫는다.

Gate 0 전에 primary operator와 backup, staffed hours, handoff, 사고 연락 경로를 역할 단위로
지정한다. 질문·신고·appeal·출처·이미지 queue별 예상 arrival × dry-run p90 처리시간에 고정
점검시간을 더해 forecast workload를 계산한다. staffed minutes의 70% 이하에서만 쓰기를 열고,
due_at 초과나 70% 초과는 신규 질문·유입 freeze, 100% 초과나 backup 부재는 read-only다.
하루 2시간·주 15시간 cap은 이 peak·WIP gate와 함께 적용한다.

**moderation case lifecycle**

    received → triaged → contained → decided → author_notified
      → appealed → appeal_decided → restored_or_final

case마다 case_id, severity, policy_code, evidence reference, assignee, due_at, conflict,
before·after, reporter receipt, author notice, reviewer를 append-only로 남긴다. 개인정보·계정정보
의심은 즉시 contained 처리하고 통제 베타의 일반 신고와 appeal은 24시간 안에 결정한다.
appeal은 가능한 한 원심과 다른 reviewer가 맡는다. overturn은 콘텐츠 visibility, notice,
source availability, 검색 projection, 관련 알림을 한 원자 command로 복구한다.

### 15.3 모더레이션 원칙

- 신고 수만으로 자동 숨김하지 않는다.
- 업체·광고주 여부와 무관하게 같은 기준을 적용한다.
- hard delete보다 숨김·복원 가능한 조치를 우선한다.
- 작성자에게 범주, 이유, 이의제기 경로를 알린다.
- 운영자 판단도 출처와 시각을 가진다.
- 환불·계약·분쟁 경험을 법률 판단처럼 승격하지 않는다. 긴급 안전·법률·소비자 분쟁은
  검증된 공식 도움 경로를 함께 제공하고 일반 사람 답변 SLA와 별도로 처리한다.
- 위기 콘텐츠를 engagement·검색 자산으로 추천하지 않고 필요한 최소 담당자만 접근한다.
- raw 신고 수를 진실 점수처럼 보여주지 않는다. reporter cluster·계정 나이·동시성은 coordinated
  abuse 위험 신호로만 사용하고 moderator, appeal reviewer, vendor verifier, SEO publisher 권한을
  분리한다. 겸임 시 conflict를 기록한다.

---

## 16. 콜드스타트와 답변 공급

### 16.1 시작 범위

- 20명 이하 founding cohort
- 공개 topic은 `contract_extra_cost` 하나. 계약 조건·업체 대응은 이 topic의 보조 tag
- 한 질문마다 primary 1명·backup 1명의 실제 경험자가 요청을 명시적으로 수락
- 질문 유입보다 답변 슬롯을 먼저 확보
- 첫 4주는 유료 유입 없음
- 읽기는 공개 규칙에 따르되 통제 베타 쓰기는 초대 allowlist와 검증된 로그인으로 제한
- 계정 수를 실제 사람 수라고 주장하지 않고 다계정·기기 위험 신호를 투표·도배 방지에만 사용

두 responder 수락 전 질문은 private waitlist에 남고 공개 feed와 SLA 분모에 들어가지 않는다.
통제 베타는 동시 planned question의 2.0배 confirmed slot을 확보한다. 확대 후 rolling capacity
1.5배는 최저 중단선이며 이 아래로 내려가면 신규 질문 공개와 acquisition을 자동 정지한다.

### 16.2 콘텐츠 원칙

허용:

- 실제 회원의 동의받은 질문
- 실제 경험자의 답변
- 운영자임을 밝힌 운영 안내
- AI임을 밝힌 질문 정리와 출처 요약
- 개인정보를 제거한 동의 완료 해결 기록

금지:

- 가짜 회원
- 합성 후기
- AI 인간 답변
- 가짜 조회수·멤버 수
- 실제 활동처럼 보이는 prototype stub

### 16.3 공급 알고리즘

답변 요청 후보는 다음을 사용한다.

- 최근 직접 경험 분야
- 준비 단계
- 넓은 지역
- 업체 관계
- 최근 답변 부담
- topic opt-in
- quiet hours

한 사람에게 무차별 알림을 보내지 않는다. decline과 “이 주제 그만 받기”를 제공한다.
요청에는 사용자가 직접 opt-in한 매칭 이유, “이번에는 건너뛰기”, “이 주제 그만 받기”,
“응답하지 않아도 불이익 없음”을 함께 표시한다. private Amora 상담, 파트너 대화, 정확한 예산,
정확한 일정은 responder matching에 사용하지 않는다.

### 16.4 사람 답변이 없을 때

1. 12시간 후 경험자 추가 요청
2. 질문 조건 보완 요청
3. 24시간 후 공식 확인 경로와 다음 행동 안내
4. 사람 답변 없음 상태 유지
5. AI 답변으로 answered·resolved 전환 금지

---

## 17. 측정

### 17.1 제품 활성화

전체 모바일 제품의 1차 활성화는 기존 정본을 유지한다.

> 한 세션 안에 예식일을 입력하고 Amora 제안 하나를 승인해 예산·할 일·일정 중 하나에 남김

커뮤니티는 이 활성화를 대체하지 않는다.

### 17.2 커뮤니티 퍼널

    관련 글 노출
      → 의미 있는 읽기
      → 나도 궁금해요 / 저장 / 15초 답변
      → 첫 사람 답변
      → 적용성 판단
      → Amora 브리지
      → 승인된 다음 행동
      → 결과 업데이트
      → 다음 기여

### 17.3 지표

**공급**

- 1시간·24시간 사람 답변률
- 첫 사람 답변 중앙값
- 24시간 이상 미답변 수
- 주간 고유 실제 답변자
- 비운영진 답변 비중
- 답변자 집중도와 요청 거절률

**품질**

- qualified answer 비율
- qualified peer-member·professional 답변률 각각
- professional-only thread 비율
- 질문자의 적용성 표시 비율
- resolved·completed 비율
- 결과 회수율
- 정정·source unavailable 비율

**Amora 연결**

- thread → Amora 시작
- source가 유지된 제안 생성
- 제안 승인
- 실제 도구 반영
- 실패·stale·되돌리기
- 커뮤니티 근거가 연결된 decision_nodes

**행복과 부담**

- 더 명확해졌는가
- 마음이 가벼워졌는가
- 다음 행동 하나가 보이는가
- 비교 때문에 더 불안해졌는가
- 알림을 쉬고 싶은데 압박받았는가
- topic mute·quiet hours·삭제 후회

**신뢰**

- 출처 분류율
- 광고·혜택 표시율
- AI 오표시
- PII 차단·사고
- 신고·이의제기 처리시간
- 판정 번복률

### 17.4 이벤트 최소화

수집 가능한 이벤트:

- feed mode view
- thread open
- composer start
- local draft restore
- publish success 또는 오류 범주
- human answer received
- evidence selected
- Amora bridge start
- proposal approved
- plan applied
- outcome requested·published
- impact receipt viewed

분석 이벤트에 원문 글, 검색어, 계약 문구, 전화번호, 정확한 예산, AI private 대화를 넣지 않는다.
사람 답변 SLA 분모·분자는 질문자 자기 답변, 업체 공식 답변, 운영자, AI, 숨김·삭제 답변을
제외한 고정 SQL view로 정의하고 대시보드마다 다시 구현하지 않는다.

### 17.5 사람 답변 SLA 정본

- 측정 단위는 `eligible_thread_version`이다.
- clock은 PII·출처·공급 검사를 통과해 대상 audience에서 처음 읽기 가능해진 `published_at`부터
  wall-clock으로 시작하며 야간·quiet hours에 멈추지 않는다.
- 24시간 cutoff 시점까지 visible인 qualified answer만 분자에 포함한다. cutoff 전에 숨김·삭제·
  출처 재분류된 답변은 제외한다.
- 작성자 조기 close는 분모에서 빼지 않는다. 정책 위반, 내부 test, 5분 이내 publish rollback만
  사전 등록된 reason으로 제외한다.
- reopen은 새 thread version과 새 SLA를 만들고 과거 version 결과는 보존한다.
- 전체 human과 peer-member SLA를 같은 cutoff로 따로 계산한다.
- SQL view, rubric_version, metric_schema_version을 한 정본으로 고정하고 변경 시 과거 지표를
  몰래 재작성하지 않는다.

---

## 18. 실험 계획

모든 실험은 한 번에 한 핵심 변수만 바꾸고, 기준선과 최소 개선폭을 사전에 기록한다.
현재 기준선이 없으므로 임의의 전환율 목표를 성과처럼 만들지 않는다.

각 실험은 시작 전에 hypothesis, eligibility, assignment unit, arm, 실제 render exposure,
primary metric·관찰창, guardrail·중단선, 최소 표본·최소 기간, SRM 확인, 분석 방법, owner,
rollback flag를 등록한다. assignment는 couple-stable·server-persistent이며 두 파트너는 같은 arm을
받는다. 20명 cohort의 E0는 운영 가능성 검증이지 통계적 우월성 A/B가 아니다. disclosure,
PII, moderation, AI 사람표시는 실험 대상이 아니다.

### E0. 답변 공급 선행 검증

- 질문마다 실제 경험자 2명 매칭
- 사람 답변 SLA와 운영 부하 확인
- 공급이 실패하면 UI 확대를 중단

### E1. Community feed-first

- 대조: 현재 동기방·퀵액션 우선
- 실험: inbox + 맞춤 실제 글 우선
- 1차 신호: 첫 의미 행동
- 가드레일: bounce, 신고, 불안 응답

### E2. 내용-first composer

- 대조: 카테고리·제목·본문
- 실험: 본문 → AI 선택 제안 → 조건 → privacy
- 1차 신호: 게시 완료와 qualified question
- 가드레일: PII 차단, 삭제, 저품질

### E3. 맞춤 답변 요청

- 대조: 일반 글쓰기 CTA
- 실험: “최근 이 단계를 끝낸 당신의 경험이 필요해요”
- 1차 신호: qualified answer
- 가드레일: 거절, 알림 해지, 답변자 집중

### E4. 도움의 영수증

- 대조: 일반 좋아요 알림
- 실험: 실제 적용성·행동 이벤트
- 1차 신호: 반복 기여
- 가드레일: 알림 피로, 과장 오표시

### E5. 결과 회수

- 대조: 해결 boolean
- 실험: outcome_due + 한 번의 결과 질문
- 1차 신호: completed thread
- 가드레일: 삭제·mute·부담 응답

### E6. Amora 브리지

- 대조: 일반 “아모라에게 묻기”
- 실험: 선택 evidence + cited proposal + diff
- 1차 신호: 승인된 실제 행동
- 가드레일: source 오류, 거짓 완료, stale

### E7. 동기방 의식

- 답변 공급과 핵심 루프가 Gate 1을 통과한 뒤에만 진행
- 개인 순위가 아니라 공동 미답변 해결과 작은 승리를 시험

이벤트 의미도 사전 고정한다. E3 primary는 eligible request 뒤 24시간 안의 visible qualified
peer-member answer, E4 반복 기여는 impact receipt를 실제로 연 뒤 14일 안의 두 번째 qualified
peer answer, E5 결과 회수는 요청 뒤 30일 안의 canonical outcome revision을 기본 관찰창으로
사용한다. 이 값은 첫 실험 계약의 working default이며 시작 전 registry에 잠근다. guardrail 하나가
중단선을 넘으면 primary metric이 좋아도 실험을 중지한다.

---

## 19. 접근성·오류·오프라인

### 19.1 접근성

- 모든 주요 tap target 최소 44×44
- 색만으로 출처·상태를 표현하지 않음
- screen reader가 출처, 광고, 답변 상태, 버튼 결과를 읽음
- dynamic type에서 본문·버튼·composer가 잘리지 않음
- reduced motion 존중
- poll 결과를 숫자와 텍스트로 제공
- keyboard와 VoiceOver/TalkBack으로 작성·답변·신고·승인 가능
- focus가 deep link의 정확한 답변 anchor로 이동

### 19.2 오류

- 로드 실패와 빈 상태 분리
- 작성·답변 실패 시 draft 유지
- upload finalize 실패 시 발행 성공 표시 금지
- server persistence unknown에서 자동 중복 실행 금지
- stale version은 현재 상태를 새로 보여주고 다시 확인
- 신고·승인 실패는 사용자에게 현재 상태와 재시도 경로 제공

### 19.3 오프라인·계정 전환

- draft는 계정·device scope로 저장
- 오프라인에서는 읽기 캐시와 작성 draft만 허용
- 온라인 복귀 후 명시적 발행
- 계정 전환 중 이전 요청의 late response 폐기
- 로그아웃 후 알림 token·deep link·cache가 이전 계정 정보를 노출하지 않음
- 커플 변경 시 pending partner approval 재검증

---

## 20. 현재 구현과 목표의 차이

| 영역 | 현재 상태 | 목표 | 우선순위 |
|---|---|---|---|
| 제품 탭 | Home·Amora·Community·My 존재 | 유지 | 유지 |
| 모바일 Home | TodayOne 뒤 서비스 그리드 중심 | 결정 인박스와 관련 사람 경험 | P1, 단 Amora 첫 가치 뒤 |
| 모바일 Community | 동기방·탐색·퀵액션이 글보다 앞 | inbox + 실제 결정 피드 | P0 |
| 모바일 trust | 출처·광고·해결·검토 상태 누락 | 웹과 trust parity | P0 |
| 모바일 쓰기 | 카테고리·제목·본문 선필수 | 내용-first, draft-safe, privacy | P0 |
| 모바일 상세 | flat 댓글, 오류와 빈 상태 혼합 | 답글·도움·신고·상태·재시도 | P0 |
| 댓글 보안 | authenticated RPC로 API PII 우회 가능 | API-only service execution | P0 |
| 해결 | is_resolved boolean | answered·resolved·결정·결과를 분리한 event model | P0/P1 |
| 알림 | 웹 reply loop, 모바일 inbox 없음 | 모바일 통합 알림과 deep link | P0 |
| Amora bridge | 웹 CTA·prefill 일부 | cited proposal → 승인 → receipt | P0/P1 |
| 파트너 | 커뮤니티 결정 연결 없음 | private 적용성·공동 승인 | P1 |
| outcome | 구조 없음 | revisioned outcome·impact receipt | P1 |
| 투표 retry | toggle mutation은 응답 유실 재시도 때 반전 가능 | 최종 의도 set + unique vote | P0 |
| 결정 기록 | 앱 중복 확인과 node·edge 후속 기록이 단일 DB transaction이 아님 | command ledger + 원자 RPC | P0 |
| rate limit | 일부 쓰기 제한이 서버 process-local | durable multi-instance limiter | P0 |
| block | 사용자·업체 차단 read model 부재 | feed·답글·알림에 일관된 viewer policy | P0 |
| 모더레이션 | 강한 감사·통지 기반 | appeal review E2E 완결 | P0 |
| 업체 공식답변 | 검증 객체 없음 | 검증 신원 전에는 열지 않음 | P2 |
| 이미지 privacy | EXIF 제거, OCR 마스킹 없음 | 베타 server-off; P1 전수검수·raw TTL·purge 증거 후 재검토 | P0 |
| SEO | raw UGC noindex | 동의·검수된 completed 기록만 index | Gate 2 이후 |
| 답변 공급 | 운영 계획만 존재 | 수락 기반 capacity ledger·private waitlist·2.0배 슬롯 | 출시 선행 |
| 시각 품질 | 실기기·Lazyweb 미검증 | 캡처·시각·접근성 검증 | 출시 선행 |

---

## 21. 구현 순서

모든 구현은 feature flag 아래에서 진행하며 현재 모바일 첫 10분, runtime contract,
hosted migration, 두 기기 E2E를 더 늦추지 않는 범위로 쪼갠다.

### Phase 0 — 출시 전 신뢰 봉합

1. 모바일 content_origin·sponsorship_detail·is_resolved·under_review parity
2. 로드 실패와 실제 빈 상태 분리
3. 댓글 PII 우회 경로 차단
4. appeal 검토·결정 E2E
5. 알림 중복·유실·로그아웃 차단
6. 투표 set-intent, durable rate limit, 사용자 차단 경계
7. 통제 베타 이미지 UI·API·storage server-off
8. push 가치 설명·일반 잠금화면·기기 token 폐기
9. responder request·confirmed capacity ledger와 private waitlist
10. 운영 health와 tiered kill switch 검증

### Phase 1 — 한 개의 수직 루프

범위는 추가금·계약 조건 질문 하나다.

1. community_commands, community_decision_threads와 event 원장
2. 내용-first composer
3. 사람 답변·적용성
4. 모바일 reply inbox와 deep link
5. Amora cited proposal
6. 기존 승인 경계로 할 일 하나 반영
7. decision_nodes와 receipt
8. 결과 예정과 outcome 하나

이 한 바퀴가 실제 두 계정·두 기기에서 닫히기 전 다른 format을 확장하지 않는다.

### Phase 2 — 커플과 반복 기여

1. 파트너 private 적용성
2. 공동 proposal version 승인
3. 도움의 영수증
4. 최근 경험 기반 15초 답변 요청
5. topic mute·quiet hours

### Phase 3 — 동기방과 검색 자산

1. 실제 동기방 의식
2. 결과 공개 동의
3. 해결 기록 검수 파이프
4. canonical·soft-404·SEO
5. 주간 투명성 보고

### Phase 4 — 조건부 확장

- 품질 기반 신뢰 표식
- 검증된 업체 공식 답변
- 전수 검수·TTL·purge가 검증된 이미지
- 더 넓은 글 형식
- responder matching 자동화

Gate 2와 trust 조건 없이 진행하지 않는다.

### 공통 DB 마이그레이션 절차

1. **Expand**: nullable column, 새 table, enum value, index, RLS를 additive로 추가한다.
2. **Backfill**: 과거 출처를 추측해 member로 승격하지 않고 `legacy_unverified`로 명시한다.
   기존 `visibility=draft`는 publication_state로 옮기고 audience와 분리한다. cohort audience에는
   cohort_id가 없는 행을 만들지 않는다.
3. **Shadow read**: 기존 read와 신규 read model을 같은 fixture·운영 표본으로 비교한다.
4. **Cutover write**: feature flag 아래 server API만 신규 command/RPC에 쓰게 하고 direct client
   write를 차단한다. `is_resolved`는 신규 thread state의 read-only legacy projection으로만 남기고
   구버전 direct PATCH/RPC는 최소 지원 버전·kill switch와 함께 차단한다.
5. **Stabilize**: mixed-version 모바일, 두 계정·두 기기, retry, rollback이 아니라 forward-fix,
   backup·restore·postcheck를 검증한다.
6. **Contract**: 정의된 호환 기간과 최소 지원 앱 버전이 지난 뒤에만 과거 column·policy를
   별도 승인된 migration으로 제거한다.

각 단계는 migration manifest, 예상 row count·hash, dry-run 또는 staging 증거, 적용 receipt,
read-only postcondition을 남긴다. 일반 `supabase db push --include-all`이나 운영 SQL 수동 수정으로
단계를 건너뛰지 않는다.

---

## 22. 테스트 결정

좋은 테스트는 내부 함수 모양이 아니라 외부 행동과 불변조건을 검증한다.

### 22.1 단위

- state transition
- transition actor·guard 표와 followup is_due 파생
- qualified human answer
- feed eligibility·diversity
- disclosure·PII validation
- impact receipt copy가 실제 event만 사용
- notification preference와 dedupe
- source unavailable 처리
- post_format과 topic_category가 서로 독립인지
- 질문자 자기 답변·vendor official·operator·AI가 peer answered를 만들지 않는지

### 22.2 API 계약

- 인증·권한
- same-origin 또는 Bearer 검증
- idempotency replay
- payload mismatch 409
- stale version 409
- poll set-intent 재시도 시 선택이 반전되지 않는지
- 미투표 viewer가 base table·API·Realtime에서 poll count를 볼 수 없는지
- PII 422
- suspended user write 차단과 자기 삭제 허용
- 광고·출처 service-only 필드 위조 차단

### 22.3 DB와 RLS

- 다른 커플의 application 읽기·쓰기 차단
- P0 partner lifecycle mutation 차단과 P1 grant revoke·privacy epoch
- public thread에 private field 유입 차단
- publication_state·moderation·audience 세 조건과 cohort_id RLS
- 상태+event+notification 원자성
- self notification 0
- evidence가 같은 thread인지 검증
- moderation append-only
- outcome revision과 supersede
- source 삭제 뒤 적용 차단
- decision edge의 same-couple DB 불변조건
- command pending·replay·state_unconfirmed 복구
- durable rate limit의 multi-instance 경쟁
- private outcome과 public resolution projection RLS 분리
- source 기여자별 consent revoke와 projection 의미 보존

### 22.4 통합

- publish + poll + media finalize
- answer + counter + reply notification
- selected evidence + Amora log
- proposal + partner approval + plan apply + decision node + receipt
- outcome + impact receipt + optional SEO candidate
- outbox + worker retry + token revoke + notification dedupe
- block 후 feed·답글·tag·push가 모두 차단되는지
- moderation appeal overturn이 visibility·notice·SEO·source를 함께 복구하는지

### 22.5 모바일 실제 기기

- 320px·375px와 지원 기기
- 320px·최대 Dynamic Type에서 첫 카드 질문과 역할별 주 행동이 첫 viewport에 보임
- 키보드·Safe Area·큰 글자
- 느린 네트워크·오프라인·강제 종료
- 계정 전환·토큰 만료
- push 허용·거절·갱신
- 로그인 직후 권한 prompt가 뜨지 않고 잠금화면 문구에 민감 정보가 없는지
- deep link exact answer
- VoiceOver·TalkBack

### 22.6 적대적 시나리오

- 업체 직원이 일반 회원으로 위장
- 경쟁사 집단 신고
- 같은 사람이 여러 계정으로 투표
- 답변 삭제 뒤 이미 생성된 proposal
- partner 변경 중 승인
- outcome 공개 뒤 원문 철회
- AI 요약의 출처 누락
- 앱 재시도로 글·답변·적용 중복
- 이미지 안 전화번호·계좌
- 검수 대기 이미지가 CDN·feed·검색에서 공개되지 않는지
- image off에서 upload URL·finalize·storage write가 모두 거절되는지
- emergency read-only에서 철회·신고·appeal·동의 철회는 가능한지
- 운영자가 SLA를 유지하지 못함

---

## 23. 출시 게이트와 즉시 중단

기존 COMMUNITY_PRODUCTION_RELEASE_GATE_2026-07-31.md를 약화하지 않는다.

### Gate 0 — 신뢰

- 미표시 AI·운영·협찬 0
- 출처 분류 100%
- 모바일 trust parity
- PII API bypass 봉합
- 이미지 UI·upload URL·finalize API·storage policy off 증거
- durable rate limit·poll set-intent·차단 경계
- push 잠금화면 비식별·기기 token 폐기
- 신고·통지·복원·이의제기 E2E
- hosted migration·RLS·backup·restore 증거
- primary operator, backup, staffed hours, handoff, PII incident 연락 경로
- queue별 dry-run p90 workload가 staffed minutes의 70% 이하
- tiered kill switch와 emergency 안전행동 drill

### Gate 1 — 4주 통제 베타

- 24시간 qualified human 답변률과 peer-member 답변률 각각 80% 이상
- 첫 사람 답변 중앙값 6시간 이내
- 해결 thread 20개 이상
- 고유 질문자 8명 이상, 고유 qualified peer-member 답변자 8명 이상
- 한 계정의 qualified peer answer 점유율 30% 이하
- 질문별 primary+backup confirmed coverage 100%
- 24시간 초과 신고 0
- 24시간 초과 appeal 0
- 사람 답변 품질 rubric 표본 검수
- 사용 후 비교 불안 악화 여부 확인

### Gate 2 — 확대

- 기존 문서의 85% 답변률, 질문자 재방문 50%, 주간 실제 답변자 10명,
  비운영진 답변 50% 조건
- human과 peer-member 답변률을 별도 보고하고 둘 중 낮은 값으로 답변 Gate 판정
- community → Amora → 승인된 실제 행동의 기준선 대비 개선
- 운영 부하가 하루 2시간·주 15시간 안
- 출처·광고·PII 무관용 유지
- analytics·notification·responder·moderation evidence별 retention matrix와 삭제 job E2E

### Gate 3 — 유료 유입

- Gate 2 지표가 추가 관찰 기간에도 유지
- rolling planned 질문 대비 confirmed 사람 답변 슬롯 1.5배 이상
- 7일 질문자 재방문 25% 이상
- 출처·보상·경제적 관계 표시 100%
- responder 집중도, 거절률, 비교 불안, 알림 피로가 사전 정의한 중단선 이내

이 수치는 현재 성과가 아니라 기존 release gate의 **진입 조건**이다. 실제 cohort 데이터와
분모·관찰 기간이 없는 상태에서 마케팅 문구로 사용하지 않는다.

### 단계별 kill과 즉시 read-only

이 분류는 기존 release gate를 약화하지 않는다. 기존 문서가 global read-only를 요구하면 더
강한 조건이 우선한다.

**A. global read-only**

- 실제 공개 PII 사고 1건. detector가 노출 전에 차단한 입력은 incident near-miss로 별도 집계
- 미표시 AI·운영·협찬 1건
- 24시간 초과 신고 1건
- 24시간 qualified human 또는 peer-member 답변률이 이틀 연속 80% 미만
- 미답변 질문 5건 초과
- 감사 원장 단절 또는 복구 불가 알림 유실
- cross-couple·private/shared 누출
- 운영 100% 초과 또는 backup 부재
- Amora가 source 없이 사실·완료를 확정

**B. feature kill**

- push 중복·stale delivery: 외부 push off, inbox 유지
- AI source·완료 표현 실패: community Amora bridge off
- vendor verification 실패: vendor official write off
- media purge·TTL 실패: media off

**C. acquisition·new-question freeze**

- rolling confirmed capacity가 planned demand 1.5배 미만
- queue forecast가 staffed minutes 70% 초과
- safety case·appeal due_at 임박 또는 responder WIP 초과

emergency read-only에서도 자기 콘텐츠 철회·삭제 요청, 신고, appeal, 공개 동의 철회는 허용한다.
신규 thread·answer·vote·responder request·Amora 적용은 차단한다. pending notification·media·SEO
outbox는 kill mode와 현재 권한을 재검증해 안전·철회 이벤트 외에는 취소한다.

복구는 owner와 backup의 2인 승인, 원인 수정, audit replay, postcheck, 최소 24시간 soak 뒤에만
가능하다. migration을 임의 롤백하지 않고 감사 데이터를 보존한 채 forward-fix한다.

---

## 24. 실패 모드와 대응

| 실패 | 조기 신호 | 대응 |
|---|---|---|
| 빈 피드 | 첫 질문 무응답, 같은 운영자만 답함 | 유입 중지, responder 슬롯 보강 |
| 불안 커뮤니티 | 비용·갈등 글만 소비, “더 불안” 증가 | 긍정 결과·작은 승리, topic mute, ranking 감산 |
| 저품질 답변 | 일반론·근거 없는 업체 순위 | 구조화 답변, qualified rubric, 적용성 분리 |
| Amora 장식화 | CTA 클릭은 있으나 실행 없음 | cited proposal 수직 흐름 외 기능 중단 |
| 커뮤니티가 제품을 삼킴 | Amora 첫 활성화 악화 | Home feed 축소, 관련 카드만 유지 |
| 업체 조작 | 특정 업체 집중·미표시 관계 | 공식 레인 분리, 투표 제한, 감사 |
| 운영자 번아웃 | SLA·신고 지연, 소수 답변자 집중 | read-only, cohort 축소, 자동 유입 차단 |
| 가짜 재미 | 포인트·streak만 상승 | 해당 보상 제거, 실제 도움 지표로 복귀 |
| privacy 누출 | 정확 날짜·예산·문서 식별자 | 즉시 숨김·사고 대응·write fence |
| source 철회 | 적용 proposal이 삭제 원문에 의존 | 새 적용 차단, source unavailable, 재확인 |

---

## 25. 범위 밖

이 설계의 초기 구현 범위가 아니다.

- 전면 업체 marketplace
- 예약·결제·전자계약
- 계약서 AI 법률 판단
- 자동 OCR 마스킹을 안전하다고 약속하는 기능
- 전역 팔로워·인플루언서 경제
- 포인트 환전·리워드
- 공개 커플 갈등 콘텐츠화
- 모든 과거 UGC의 자동 SEO 색인
- AI 자동 게시·자동 댓글
- 결혼 후 무기한 소셜 네트워크 확장

---

## 26. 아직 결정하지 않은 것

다음은 구현 전에 소규모 prototype 또는 운영 검증으로 결정한다.

1. Community 피드 탭 이름의 최종 카피
2. 모바일 title을 완전히 선택값으로 둘지 publish 직전에 요구할지
3. coarse region의 최소 공개 단위
4. 정확 금액 대신 범위를 기본값으로 할 범주
5. outcome follow-up 기본 시점
6. partner applicability를 항상 공유할지 사용자 선택으로 둘지
7. 한 responder에게 허용할 주간 요청 수
8. qualified answer의 자동 판정과 운영 검수 비율
9. completed 해결 기록의 `published_indexable` 승인 기준
10. 도움의 영수증 알림 기본값
11. feed 다양성 제약의 초기 값
12. component mockup과 실제 화면 visual hierarchy 검증
13. funnel event·quarantine file·notification delivery log의 보존 기간
14. 이미지 self-publish를 다시 열 수 있는 OCR·검수 정확도와 사고 중단선
15. 민감하지 않은 push 상세 preview를 opt-in으로 허용할 범위

마지막 항목은 Lazyweb 화면 보고서와 실제 기기 캡처가 준비된 뒤 검증한다.

---

## 27. Definition of Done

설계의 첫 수직 흐름이 완료됐다고 말하려면 모두 충족해야 한다.

- [ ] 모바일 Home의 Amora 첫 가치가 유지된다.
- [ ] Community 첫 viewport에 실제 사람 글이 보인다.
- [ ] 모바일에서 출처·광고·검토·결정 상태가 웹과 같은 의미로 보인다.
- [ ] 내용-first composer가 draft·계정 전환·실패를 안전하게 처리한다.
- [ ] 글·poll·media·thread가 부분 성공하지 않는다.
- [ ] poll 재시도가 선택을 반전시키지 않고 durable rate limit이 모든 인스턴스에 적용된다.
- [ ] 베타 이미지가 UI·API·storage에서 모두 꺼져 있고 새 upload URL을 발급하지 않는다.
- [ ] 사람 답변과 AI·운영 답변이 지표와 UI에서 분리된다.
- [ ] 답변·inbox·thread state가 멱등·원자적이고 push는 at-least-once/best-effort로 감사된다.
- [ ] 모바일 알림이 정확한 답변으로 이동한다.
- [ ] push는 가치 설명 뒤 요청되고 잠금화면·logout·token rotation이 민감 정보를 남기지 않는다.
- [ ] 사용자 차단이 feed·답글·tag·알림에서 일관되게 작동하고 신고 원장과 분리된다.
- [ ] P0 질문자가 적용성을 private로 판단하고, P1을 열면 유효한 grant의 파트너만 참여한다.
- [ ] Amora가 선택한 source와 조건을 인용한다.
- [ ] 모든 AI 호출이 ai_interactions_log에 남는다.
- [ ] 승인 전에는 예산·할 일·일정이 바뀌지 않는다.
- [ ] 공동 변경 기능을 열 경우 동일 proposal version, 현재 roster, 필요한 승인을 가진다.
- [ ] 실제 적용은 decision_nodes와 실행 영수증을 남긴다.
- [ ] 실패·stale·결과 미확인이 성공으로 보이지 않는다.
- [ ] 결과 업데이트가 revision과 동의를 가진다.
- [ ] private canonical outcome과 공개 해결 기록 projection이 RLS·철회로 분리된다.
- [ ] 출처·경제적 관계·검증 수준이 서로 다른 축으로 저장·표시된다.
- [ ] source 철회·계정 삭제·커플 변경이 안전하다.
- [ ] 신고·통지·복원·이의제기가 E2E로 닫힌다.
- [ ] cross-couple, private/shared 누출 공격 테스트가 통과한다.
- [ ] 실제 iOS·Android와 접근성 검증이 있다.
- [ ] 운영 DB migration·backup·restore·postcheck 증거가 있다.
- [ ] 사람 답변 공급 Gate 1이 실제 데이터로 통과한다.
- [ ] community → Amora → 실제 행동 연결이 기준선 대비 검증된다.
- [ ] 비교 불안과 알림 피로가 허용 범위인지 확인한다.
- [ ] Lazyweb 화면 검증 또는 동등한 실제 화면 근거가 있다.

이 목록이 끝나기 전에는 “최고의 커뮤니티가 완성됐다”, “사람들이 무조건 참여한다”,
“출시 준비가 끝났다”고 말하지 않는다.

---

## 부록 A. 연구 기반

이 설계에 사용한 외부 연구는 웨딩한방의 실제 성과를 보장하지 않는다. 참여 구조를 만드는
방향성 근거로만 사용하며 제품 효과는 별도 실험으로 확인한다.

이번 검토에서 원문으로 다시 확인한 적용 한계:

- Reader-to-Leader는 독자·기여자·협력자·리더로 참여가 깊어질 수 있다는 프레임이지 모든
  독자를 작성자로 바꾸라는 목표가 아니다. 그래서 읽기·저장 자체도 정상 경로로 둔다.
- Beenen 등의 현장 실험은 “내 기여가 고유하다”는 맥락이 기여를 높일 수 있음을 보였지만,
  혜택을 강조하는 모든 메시지가 예상대로 작동한 것은 아니다. 따라서 “당신의 경험이
  필요해요” 요청과 도움의 영수증은 보장된 해법이 아니라 E3·E4 실험으로 유지한다.
- Cheng 등의 관찰 연구에서는 부정적 평가와 무반응 모두 건강하지 않은 후속 행동·이탈과
  연결됐다. 이 결과를 웨딩한방에 그대로 일반화하지는 않지만, 공개 downvote를 만들지 않고
  첫 사람 답변 SLA를 제품 계약으로 두는 방향 근거로 사용한다.
- Sailer 등의 실험은 “게임화 전체”가 자동으로 동기를 만든다는 결론이 아니라 요소마다 다른
  심리적 효과가 있음을 보여준다. 기존 XP·streak·rank를 그대로 전면화하지 않는 이유다.
- Ren 등의 field experiment는 집단 정체성과 개인 관계가 서로 다른 애착 경로임을 보여준다.
  동기방을 관계 공급 계층으로 두되 전체 제품·정보 정본으로 만들지 않는 이유다.
- Lin 등의 online support community 연구는 도움을 받은 사람이 다시 도움을 줄 의향으로 이어질
  수 있는 문제 해결·정서 지원 경로를 다뤘다. 특정 맥락의 자기보고 연구이므로 웨딩한방의
  효과로 일반화하지 않고 도움받기 → 도움주기 전환을 측정할 가설로만 사용한다.

- Preece & Shneiderman, Reader-to-Leader Framework:
  https://aisel.aisnet.org/thci/vol1/iss1/5/
- Beenen et al., Using Social Psychology to Motivate Contributions:
  https://files.grouplens.org/papers/beenen04-UsingSocialPsychToMotivateContribution.pdf
- Cheng et al., How Community Feedback Shapes User Behavior:
  https://ojs.aaai.org/index.php/ICWSM/article/view/14518
- Ciampaglia & Taraborelli, MoodBar:
  https://arxiv.org/abs/1409.1496
- Lin et al., Receiving and Offering Online Social Support:
  https://www.sciencedirect.com/science/article/abs/pii/S037872061500004X
- Ren et al., Building Member Attachment in Online Communities:
  https://aisel.aisnet.org/misq/vol36/iss3/11/
- Sailer et al., How Gamification Motivates:
  https://www.sciencedirect.com/science/article/pii/S074756321630855X

## 부록 B. 설계 판단 요약

| 판단 | 결론 |
|---|---|
| 순수 Threads형 제품 | 채택하지 않음 |
| Amora-only | 사람 신뢰·참여가 약해 불충분 |
| Amora + DecisionThread | 현재 최우선 설계 |
| 동기방-first | 초기 기본 화면으로 채택하지 않음 |
| 검색-first | 웹 유입에 채택 |
| 전역 leaderboard·streak | 채택하지 않음 |
| AI 인간답변 | 영구 금지 |
| 통제 베타 | 필수 |
| 공개 확대 | Gate 통과 뒤 조건부 |
