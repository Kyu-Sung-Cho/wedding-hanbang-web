# 「오늘 한 마디」 독립 적대 감사 — 2026-07-28

대상: `feat/today-one-line` (`97d298c5`..`211b9e49`, PR #75)

5개 렌즈로 독립 감사 → 발견 **46건** → 건별 반증 시도 → **21건**이 반증을 통과했다.
에이전트 52개 · 도구 호출 1,036회 · 41분.

## 전체 판정

격리는 진짜다. candidate6.ts 0줄, apps/web/src/app/ 0줄, storage·network·analytics 0건, 응답에서 계산되는 값 0개 — 9개 주장 중 8개가 코드로 검증된다. 무너진 것은 주장 1 하나이고, 그것도 문자 그대로만 거짓이다(리듬 라벨은 기획서 §3 S1이 명시한 예외, 목차 시트는 §3 S1b가 별도 화면으로 규정). 진짜 문제는 다른 곳이다: 이 브랜치가 스스로 「최상위 불변식」이라 부른 것을 지키는 테스트가 그것을 검사하지 않는다. 문항 화면에 저작 장면 제목을 직접 렌더하는 변이, 회수 화면의 저작 카피 17항목×3줄을 전부 버리는 변이, 카드 후보를 응답으로 필터링하는 변이 — 셋 다 심어서 직접 돌렸고 전부 114/114 통과했다(변이 후 git checkout 복원, 트리 clean 재확인). 기획서 §10이 RED 1(sceneTitle 단정·4조합)과 RED 3(escape 전항목 → 배열 불변)으로 명세한 가드가 미구현이고 §13-5 갭 장부에도 없다. 그리고 §13-2 접힘선 표가 하단 고정 바 96px를 빼지 않아 360×640이 ✓가 아니라 ✗다 — §13-3이 「360·375에서는 가설2가 성립한다」로 320 보류를 판정한 근거가 사실이 아니다. 운영 사용자 영향은 0(로컬 dev 3중 게이트)이므로 전부 R1 투여 전에 닫으면 되는 것들이다.

## 검증된 주장 (8/9)

- 주장 2 — 점수·유형·궁합·overlap 없음, 응답에서 계산되는 값 0개. responses를 읽는 곳은 현재 문항 응답 반영 1곳뿐이고 집계·매핑·점수 함수가 없다.
- 주장 3 — 카드 후보가 응답·라벨과 무관. deriveCardCandidates(ids)가 응답을 인자로 받지 않고 useMemo deps에도 responses가 없다. 단 이 사실을 지키는 테스트는 없다(mustFix 3).
- 주장 4 — 응답 수집·저장·전송 0. research/ 전체에 fetch·XHR·sendBeacon·localStorage·sessionStorage·indexedDB·cookie·posthog·Sentry 0건. 유일한 브라우저 API는 onClick 안의 navigator.clipboard.writeText 하나.
- 주장 5 — 막간·황혼이 위치만의 함수. interludeIndexes(total)·duskTone(index,total)이 응답을 보지 않고 호출부도 넘기지 않는다. escape 전항목 워크스루와 정상 워크스루의 막간 인덱스 동일성을 Rhythm 테스트가 실제로 검증한다.
- 주장 6 — 초대 복사 문자열에 URL·브랜드·장면 제목·답·라벨 없음. buildInviteCopyLine은 항등함수이고 화면 표시값과 클립보드 인자가 같은 변수 하나(copyLine)다.
- 주장 7 — 완료에 고유 연출 없음. confetti·celebrat·animate-* 0건, 마지막 장면 버튼 전환이 중간 장면과 동일.
- 주장 8 — 운영 차단 하나도 해제 안 함. git diff 97d298c5~1..211b9e49 -- apps/web/src/app/ 이 빈 출력. 변경 파일 10개가 전부 research/ + docs/.
- 주장 9 — candidate6.ts 한 글자도 안 바꿈. 해당 경로 diff 빈 출력, 최종 수정 커밋이 이 브랜치 밖.

## 무너진 주장 (1)

- 주장 1 — 「문항(측정) 화면에 새 문장·라벨·마커를 하나도 얹지 않았다」는 문자 그대로 거짓이다. (a) 이 브랜치가 새로 넣은 sceneRhythmLabel이 questions 헤더에 렌더되고 출력에 「세 장 남았어요」·「다음이 마지막」 같은 완결 문장이 있다. (b) 이 브랜치가 새로 넣은 목차 시트가 step==="questions" 분기 안에서(494-501행) 저작 sceneTitle과 라벨 pill 2종을 렌더한다. 다만 둘 다 기획서가 명시한 것이다 — §3 S1이 리듬 라벨을 요구하고, §3 S1b가 시트를 별도 화면으로 규정하며 §4:188이 「라벨은 문항 화면에 존재하지 않고(목차 시트와 회수 행에만 있다)」로 선을 긋는다. 측정 오염 실효는 없다: 시트는 journey.slice(0, questionIndex)로 이미 답한 항목만 담아 미응답 문항의 제목이 새는 경로가 없고, 회수 문장(Tier B)은 data-recap-body="" 하드코딩으로 구조적으로 차단된다. 즉 문서 문구와 코드의 불일치이지 측정 타당도 결함이 아니다.

## 반드시 고칠 것 (4)

### M1. `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:80`

**무엇** — RED 1 미구현 — 이름은 「문항 화면에는 회수 문장도 장면 제목도 라벨도 없다」인데 본문(85-95행)이 sceneLabelPills 길이·recapRows 길이·recapLines 문자열만 단정하고 sceneTitle을 한 번도 검사하지 않는다. Prototype.tsx:415의 chapter 문단 뒤에 <p>{CANDIDATE6_SCENE_TEXT[currentItem.id].sceneTitle}</p>를 삽입해 직접 돌린 결과 114/114 통과했다(복원 완료). 기획서 §10 RED 1은 「tierB 문자열·sceneTitle·라벨 pill이 단 하나도 없음을 단정(Form A/B × ES_FIRST/AS_FIRST 4조합)」을 요구했고 구현은 sceneTitle 미검사 + Form A/ES_FIRST 1조합뿐이다. sceneTitle 21개와 card 3필드×17개를 순회 대상에 추가할 것.

**왜** — 이 브랜치가 운영 차단을 유지한 채 통과하는 근거가 이 테스트 suite다. 지금 상태에서는 문항 화면에 저작 카피가 새는 회귀가 들어와도 CI가 초록이고, 그 상태로 수집한 R1 응답은 사후에 오염 여부를 판별할 방법이 없다. 게다가 CANDIDATE6_SCENE_TEXT는 같은 파일에 이미 import되어 3곳에서 item.id로 인덱싱되므로 「사용자에게 현재 위치를 알려주자」는 자연스러운 리팩터링으로 언제든 들어온다.

### M2. `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:100`

**무엇** — 회수 화면(S4)이 저작 recapLines·sceneTitle을 실제로 렌더하는지 단정하는 테스트가 없다. 100-109행은 row.dataset.recapRow(id)만, 111-121행은 recapLines===null인 플래그 4항목만, 125-148행은 snapshot()을 자기 자신과 비교하는 자기참조(data-recap-body가 같은 bodyLines prop에서 파생돼 양변이 함께 움직인다). Prototype.tsx:534를 bodyLines={[item.scenario]}로 바꿔 저작 회수문장 17항목×3줄을 전부 폐기한 변이가 114/114 통과했다(복원 완료). 비플래그 17항목의 회수문장 리터럴이 화면에 있음을 단정하는 검사를 추가할 것.

**왜** — 회수 화면은 기획서가 「이 설계의 본체」라 부르는 곳이고 저작 카피가 이번 커밋의 핵심 산출물이다. 그것이 리팩터링 중 통째로 사라지고 원래의 재미없는 지문 목록으로 되돌아가도 CI가 알려주지 않는다. 같은 커밋 시리즈가 카드 쪽은 face.textContent에 card.prompt/when/action 포함을 단정하는 더 높은 기준을 지키므로 회수 화면만 예외다.

### M3. `apps/web/src/lib/weddingCode/research/__tests__/Candidate6CardSteps.test.tsx:51`

**무엇** — RED 3의 세 번째 절(「escape 4택을 전 항목에 선택해도 배열 불변」) 미구현. 카드 화면에 도달하는 워크스루 4개(CardSteps 52·112, Prototype 134, Recap 63)가 전부 querySelector('input[value^="bipolar-"], input[value^="impact-"]')로 항상 첫 라디오(bipolar--2 / impact-strongly_hinders)만 누른다 — neutral_impact도 escape도 한 번도 선택되지 않는다. escape 전항목 워크스루는 Rhythm.test.tsx:124-159에 있으나 recap에서 멈춰 카드 화면에 도달하지 않는다. Prototype.tsx:237 cardCandidates에 responses[id]?.kind !== "escape" 필터를 심고 deps에 responses를 추가한 변이가 114/114 통과했다(복원 완료). deriveCardCandidates의 arity 1 검사(candidate6SceneText.test.ts:222)는 순수함수 내부만 막고 호출 지점을 제약하지 못한다. escape/neutral을 전 항목에 고른 워크스루로 카드 화면까지 걸어가 후보 배열 deep-equal을 단정할 것.

**왜** — 화면은 「라벨은 후보를 바꾸지 않아요」라고만 주장하지만 설계 주장은 응답까지 포함한다. 「넘긴 장면은 후보에서 빼주는 게 친절하다」는 자연스러운 오판이 들어오면 사용자는 21문항 직후 짧아진 목록을 보며 「내 답을 보고 걸렀다」고 믿는다 — 기획서 위험 5가 카피로 막으려던 오해를 코드가 만들어내는데 테스트가 침묵한다. 현재 구현은 실제로 응답 독립적이므로 살아 있는 결함은 아니고, 회귀 fence 결손이다.

### M4. `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:452`

**무엇** — §13-2 접힘선 표가 뷰포트 전체 높이를 접힘선으로 썼다. 문항 화면은 h-dvh + overflow-hidden 셸(Prototype.tsx:813) 안에서 스크롤러(413행 min-h-0 flex-1 overflow-y-auto)와 이전/다음 바(463행 shrink-0)가 flex 형제이므로, 스크롤러가 잘리는 지점은 뷰포트 하단이 아니라 뷰포트 − 하단바 96 − padding-bottom 16 − border 1 = 뷰포트 − 113이다(문서 자신의 「스크롤 영역 상단 77px」을 코드로 재현하면 16+44+16+1=77로 정확히 일치하므로 같은 회계다). 재계산: 320×568 → 455 vs 604 = 149px 초과(표는 36px), 360×640 → 527 vs 582 = 55px 초과이므로 ✓가 아니라 ✗, 375×667 → 여유 13px(표는 126px처럼 읽힘). 표를 고치고 §13-3 근거 1을 다시 쓸 것.

**왜** — §13-3이 「360·375에서는 가설2가 성립한다」를 근거로 320을 안 쫓기로 판정했는데 그 근거가 360에서 거짓이다. R1 대상 기기 대역에서 「다섯 답 동시 비교」(§5 가설2)가 깨지고, 375도 여유 13px뿐이라 폰트 확대·안드로이드 시스템 바에서 즉시 무너진다. 이 상태로 사람 검증을 시작하면 가설2 실패를 UI 결함이 아니라 문항 문제로 오독한다. 판정 때 쓰라고 지정된 표가 틀린 상태다. (§13-3의 결론 자체는 살아남는다 — 갭이 36px이 아니라 149px이니 「밴드 교체 10~16px로는 못 메운다」는 오히려 강해진다.)

## 고치면 좋은 것 (9)

### S1. `apps/web/src/lib/weddingCode/research/candidate6SceneText.ts:10`

**무엇** — 최상위 불변식 docblock이 자기 파일의 export 3개에 대해 거짓이다. 「이 파일의 문장은 문항 화면(측정)에 단 하나도 렌더되지 않는다. 회수 화면(S4)과 그 이후에만 나타난다」인데, sceneRhythmLabel(243-249행)은 Prototype.tsx:386 questions 헤더에서, CANDIDATE6_INTERLUDE_SENTENCES(230-234행)는 문항 사이 막간에서, sceneTitle은 Prototype.tsx:1180 목차 시트(questions 하위)에서 렌더된다. 같은 파일 227행이 「막간은 문항 사이에 오기 때문에 이후 항목을 프라이밍할 수 있는 유일한 지점이다」로 스스로 모순한다. 기획서 §3 S1·S1b가 정한 좁힘(리듬 라벨 예외, 시트는 별도 화면)을 docblock에 반영할 것.

**왜** — 이 docblock은 리뷰어·후임자·R1 프로토콜 작성자가 「측정면은 깨끗하다」고 판단할 때 읽는 유일한 코드측 계약서다. 문서가 실제보다 강하게 적혀 있으면 오염 검토를 해야 할 사람이 검토를 건너뛴다.

### S2. `apps/web/src/lib/weddingCode/research/__tests__/candidate6SceneText.test.ts:83`

**무엇** — 금지어 스캐너가 기획서 §10 RED 9(361행)보다 5개 짧다 — 가족·하객·업체·견적·계약이 빠졌다(같은 파일 DOMAIN_NOUNS에는 있으나 그 검사는 막간 문장에만 적용된다). RED 9 목록에는 CLAUDE.md 확정 결정이 지목한 금액·부모도 없어 갭이 더 넓다. 현재 상수에 위반 문자열이 0건이므로 복원해도 테스트가 통과한다(무비용).

**왜** — 이 fence의 존재 이유가 「나중에 문장을 추가하는 사람이 업체·견적·계약을 회사 발화로 승격시키지 못하게」이고, 파일 스스로 28-29행에서 DS3에 대한 방어라고 적어뒀다. 플래그 4항목이 rewrite 판정으로 풀려 카피를 새로 저작하는 시점 — 즉 fence가 정확히 필요한 시점 — 에 그 단어들이 빠져 있다.

### S3. `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:1165`

**무엇** — 목차 시트 접근성. 트리거(388-394행)에 aria-expanded·aria-controls가 없어 스크린리더 사용자에게 상태 변화가 전혀 통보되지 않는다(WCAG 4.1.2). 시트 루트에 id·aria-labelledby 없음, Escape 핸들러 없음(research/ 전체에 keydown 0건), 열 때 포커스 이동 없음(setContentsOpen은 moveToStep을 타지 않아 focusRevision effect가 안 돈다), 닫을 때 포커스가 body로 유실. 기획서 §3 S1b:81이 명시한 dim bg-[#243832]/20 fade 220ms와 220ms translateY도 없어 불투명 z-20 시트가 계속 tabbable한 이전/다음 버튼을 덮는다(SC 2.4.11 소지).

**왜** — 이 시트는 기획서 §6-7이 「중도이탈자에게 회수 전 만회 기회를 준다」고 못박은, recognition 각도의 최대 약점을 메우는 장치다. 키보드·스크린리더 사용자에게는 그 만회 기회가 사실상 닫혀 있다. §13-4가 스크린리더 검증을 미측정으로 남겨둔 상태라 R1-UX 전에 코드로 잡을 수 있는 시점이다. 수정은 4줄 수준.

### S4. `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:150`

**무엇** — 「두 라벨은 크기·전환 클래스가 완전히 같다 — 색 토큰만 다르다」가 미선택 상태에서만 돈다. walkToRecap()은 라디오와 다음 버튼만 누르므로 단정 시점 sceneLabels는 {}이고, 그 상태에서 두 pill은 양쪽 모두 `${sceneLabelBase} ${sceneLabelIdle}`로 바이트 동일 문자열이라 사실상 자기 자신과의 비교다. 색이 갈리는 유일한 상태(선택됨)는 검사되지 않는다 — not-ours 선택 분기에 scale-50 opacity-40 text-[9px]를 심은 변이가 통과한다. 비교 전에 pill을 눌러 선택 상태를 만들 것(1행).

**왜** — 「우리 얘긴 아니에요」는 명중하지 않은 장면을 소외가 아닌 표현으로 바꾸는 유일한 채널이고, 기획서 §3 S1b:81이 두 pill의 크기·press·전환 클래스 문자열 완전 동일을 못 박는다. 반대 의사표시만 시각적으로 위축되는 회귀가 들어오면 라벨은 흡수 장치가 아니라 순응 유도가 되는데, 그걸 잡으라고 쓴 테스트가 잡지 못한다. 현재 렌더 코드는 대칭이라 사용자 영향 0.

### S5. `apps/web/src/lib/weddingCode/research/candidate6SceneText.ts:60`

**무엇** — 회수 화면 519행이 「저희가 해석한 게 아니라, 방금 지나오신 장면 그대로예요」라고 단정하는데(Recap.test.tsx:104가 이 문장을 assert로 못박았다), 바로 아래 534행이 렌더하는 recapLines에 문항 원문에 없는 문장이 있다. 가장 명확한 것은 DS1 「이제 취향 얘기다.」 — premise가 「두 종류의 이야기를 모두 나눌 수 있어요」로 두 대화가 모두 열려 있다고 못박는데 회수는 남은 게 취향 하나라고 닫고, leftAnchor(실제 진행 조건)를 지우고 rightAnchor 쪽으로 해소한다. DS1은 journey 첫 항목이라 제일 먼저 읽힌다. 좁게는 CP1 「같이 확인하면 된다.」도 behavior의 평서(「함께 확인한다」)를 당위·충분 화행으로 바꾼다(형제 17항목은 전부 가능·허용형).

**왜** — P1(trust)이 최우선인 제품에서 신뢰를 얻으려고 놓은 문장이 검증 가능하게 거짓이다. R1 인지면접에서 참가자가 이 불일치를 발견하면 회수 화면 전체의 신빙성이 무너진다. 파일 자신의 저작 규칙(16행)이 「과잉 구체 디테일 정확히 하나」를 회수문장에 배정하므로 문항 원문 밖 저작을 스펙이 이미 인정한다 — 519행의 절대적 표현을 완화하거나 DS1을 다시 쓰는 쪽이 정합적이다.

### S6. `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:580`

**무엇** — 카드 고르기 화면이 「지나온 장면 전부에서 고를 수 있어요」라고 한 뒤 같은 화면 628-631행에서 「{missingCount}개 장면은 문장을 아직 다듬는 중이라 카드가 없어요」라고 스스로 부정한다. missingCount는 모든 form·pair·해당성 조합에서 항상 4다(CORE_ORDER가 ES1·DS3·CP3·DS4를 무조건 포함하고 AS_FIRST 스왑은 ES1↔AS1 상호교환). 즉 「전부」는 19장 중 15장이다. 직전 회수 화면이 투여 전 장면을 행으로 보여주므로 감소를 사용자가 셀 수 있다. 「전부」 한 단어만 빼면 해소된다(Prototype.tsx:580 + CardSteps.test.tsx:76 + 기획서 §S5 세 곳 동시 수정).

**왜** — 「앱이 내 답을 보고 골라준 게 아니다」를 증명하려던 문장이 오히려 '뭔가 걸러졌다'는 의심의 근거가 된다 — 기획서 위험 5가 막으려던 그 오해다. 같은 문장 후반부(「라벨은 후보를 바꾸지 않아요」)는 변이 검증으로 참임이 증명돼 있어, 전반부만 검증 없이 거짓으로 남아 이 브랜치 자신의 「화면의 주장은 참」 기준에 걸린다.

### S7. `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:703`

**무엇** — 1인칭이 세 갈래다. 703행 「상대가 아무것도 안 해도 제 화면은 그대로예요」의 「제」는 519행이 회사를 「저희」로 부르는 겸양형 어간이라 앱의 1인칭으로 읽히는데 의도는 사용자의 화면이다(기획서 산문 151·199·211행은 「내 화면」·「내 결과」로 쓰고 화면 문자열만 「제 화면」). 그리고 778행 「우리는 이 카드를 보관하지 않았어요」(회사=우리)가 card-face 한 화면에서 739·750행의 카드 문장 「우리 나중에 뭘 제일 다시 볼까?」·「우리가 편한 쪽 하나만 먼저 정하기」(우리=부부)와 동시에 렌더된다. 수정은 두 단어, 둘 다 파일에 이미 있는 관행에 정렬: 703행 「제 화면」→「내 화면」(574·579행 관행), 778행 「우리는」→「저희는」(519행 관행). CardSteps.test.tsx:208과 기획서 155·211·283행도 같이 고쳐야 코드·문서가 갈라지지 않는다.

**왜** — 1인칭이 흔들리는 지점이 하필 비호혜 약속(703)과 미보관 약속(778), 즉 이 경험이 신뢰를 버는 두 문장이다. 「제 화면」이 앱 화면으로 읽히면 「상대가 안 해도 내 결과는 그대로」의 소유격 정박이 사라져 안심이 시스템 서술로 격하된다.

### S8. `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:518`

**무엇** — §13-5의 「의도적으로 따르지 않은 카피 1건」이 사실이 아니다. 미기록 이탈: (a) §9:329가 in-scope로 올린 press 방향 반전 미구현 — 다섯 답(1009행 active:scale-[0.98])과 escape 4택(1054행 active:scale-[0.99])이 사양의 반대 방향으로 움직이고 primary/secondary 버튼에는 active: 변형이 아예 없다. 반전이 들어간 곳은 라벨 pill과 카드 후보 행 둘뿐인데 §3 S1은 「다섯 답·escape 4택 전부 완전히 동일한 모션」을 명시한다. (b) safe-area 인라인 style → Tailwind 임의값 미이행(815행 잔존, §8:308 「인라인 style 0」). (c) radius 24/18 → 20/16 절반만. (d) globals.css의 .c6-stagger-1~6 유틸과 시트 220ms·dim·막간 300ms·버튼 80ms 지연 전부 미구현. (e) §9 신규 파일 4개(Interlude/ContentsSheet/Recap/CardSteps.tsx) 미생성 — 전부 Prototype.tsx 인라인. (f) §7 카피 덱 「여기서 라벨을 새로 붙이거나 지울 수 있어요」·「라벨과 답이 전부 사라져요. 새로고침도 같아요」가 화면에 없고, Tier B 예 4건·카드 예 5건이 다르다(§7 예시 중 4건이 12자/30자/한 문장 규칙을 스스로 위반하므로 재저작이 불가피했는데 그 사유가 없다). (g) 신규 화면 카피가 DESIGN.md 스케일 밖 13/15/28px을 쓰고 §9:333이 요구한 Decisions Log 2행이 미등재(단 1행은 §12-1 파운더 결정 대기 중이라 보류가 맞다).

**왜** — 기획서가 스스로 「미준수는 1건뿐」이라고 완결 선언한 상태라 다음 사람은 §7 카피 덱과 §8 사양을 현재 화면의 정본으로 신뢰한다. 실제로는 여러 곳에서 갈려 있어 카피 리뷰·R1 스크립트·QA 대조가 어긋난다. 특히 (a)는 §6이 꼽은 재미 메커니즘 2번이고 세로 높이를 1px도 안 바꾸므로 §13-3의 접힘선 보류 사유에 해당하지 않는다 — 보류인지 누락인지 구분할 근거가 없다.

### S9. `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:659`

**무엇** — card-pick에서 카드를 확정한 뒤(659-661행 setMyCardId → moveToStep("card-give")) myCardId를 되돌리는 핸들러가 없다. recap·card-pick·card-give 세 화면에 뒤로 가는 버튼이 0개이고, 유일한 후퇴는 restart()로 responses·sceneLabels·myCardId를 전부 비우는 전면 재시작이다(questions에는 previousQuestion이 있는데 이후 화면엔 대응물이 없다).

**왜** — 오탭 한 번으로 확정되지는 않으므로(후보 클릭은 draft만, 확정은 disabled 게이트가 걸린 별 버튼) 심각도는 낮다. 다만 기획서 §3 S4/S5/S6 버튼 인벤토리에 뒤로가 없어 구현이 기획 범위와 일치하는 상태이므로, R1에서 「카드를 바꾸고 싶었는데 못 했다」는 관찰이 나오면 그것은 정상 산출이라는 것을 R1 스크립트에 미리 적어두는 편이 낫다. 저장·수집이 0이라 데이터 손실은 없고 참가자 시간만 든다.

## 기록할 관찰 (10)

- 감사 방법과 복원: 변이 3종을 HEAD(211d 아님 — 211b9e49) 작업 트리에 직접 심어 `npx vitest run src/lib/weddingCode/research/__tests__`로 측정했다. 기준선 9 files / 114 tests 통과 → 변이 A(문항 화면에 sceneTitle 렌더) 114/114 → 변이 B(회수 bodyLines를 item.scenario로 고정) 114/114 → 변이 C(카드 후보에 escape 응답 필터) 114/114. 매 변이 후 git checkout --으로 복원하고 최종 git status --porcelain 빈 출력 · HEAD 211b9e49 · 114/114 재확인했다.
- 운영 노출은 0이다. Candidate6Prototype의 비테스트 임포터는 localPreviewPage.tsx 하나뿐이고 apps/web/src/app/ 어느 파일도 그것을 import하지 않는다. localPreviewPage는 NODE_ENV===development AND WEDDING_CODE_RESEARCH_PREVIEW===true AND host∈{localhost,127.0.0.1,[::1]} 3중 게이트 밖에서 notFound()다. 따라서 위 shouldFix 카피·접근성 항목은 R1 인지면접 표면의 결함이고 예비부부에게 도달하지 않는다.
- 격리 fence 자체는 건강하다. candidate5.test.ts의 정적 스캐너가 research/ 하위 .ts/.tsx를 재귀 수집하므로 신규 candidate6SceneText.ts와 수정된 Prototype.tsx가 화이트리스트 없이 자동 포함되고, 자체 공격 픽스처로 스캐너가 살아 있는지도 확인한다. scripts/check-wedding-code-production-artifact.mjs도 운영 번들에 연구 마커가 있으면 빌드를 실패시킨다.
- 라벨 비보상(RED 2)과 escape→막간 위치 불변(RED 3 일부)은 제대로 구현된 드문 예다. CardSteps.test.tsx:99-129는 라벨 상태가 다른 세션을 만들려고 매번 새 root를 마운트해 21문항을 다시 걸어가고, Rhythm.test.tsx:124-159는 escape 전항목 워크스루와 정상 워크스루를 실제로 비교하며 빈 배열 자기비교를 length 가드로 막는다. mustFix 3의 수정은 이 두 패턴을 카드 화면까지 연장하는 것이다.
- 반증으로 기각된 것 중 파운더가 알 만한 것: EscapeChoices의 `useState(response?.kind === "escape")`는 응답 파생값이 아니라 응답 반영(체크된 라디오와 같은 부류)이고, 이 브랜치가 건드리지 않은 기존 코드다. 그리고 감사가 제안한 「항상 접힘」 수정은 escape에 탭 1회를 더 물려 오히려 비대칭을 만든다.
- press 방향의 shrink 클래스(1009·1054행)는 97d298c5~1에 동일 문자열로 이미 있었다 — 이 브랜치가 회귀시킨 것이 아니라 §9가 고치겠다고 올려놓고 안 고친 것이다. 반대로 새로 넣은 lift 쪽(64-67·603행)은 transition-colors를 써서 transform이 전환되지 않아 사양의 duration-150 ease-out 없이 즉시 튄다.
- DESIGN.md 스케일 이탈은 순증이 +4개뿐이고 브랜치는 오히려 개선 방향이다(off-scale text-[34px]·[38px] 제거, on-scale text-[24px] 0→5·rounded-[20px] 0→2 도입, off-scale 비율 43%→32%). 게다가 research/ 밖 apps/web/src에 text-[13px] 336개 등 임의 px가 이미 깔려 있고 이를 검사하는 lint·test·CI가 0개다. 도달 불가 파일의 +4개를 major로 볼 근거는 없다.
- 기획서 §7 카피 덱은 정본이 될 수 없다. ES2 카드 프롬프트 38자·JI3 31자·SI2 32자가 §4B의 30자 상한을, OA2 제목 13자가 §4A의 12자 상한을, OA1 프롬프트가 「한 문장」 규칙을 위반해 §10 RED 11 정적 검사에서 떨어진다. 덱을 복붙하면 자기 테스트가 빨간불이 된다 — §7에 「예시이며 규칙 위반 시 재저작한다」는 유보를 한 줄 넣는 것이 §13-5 수정과 함께 필요하다.
- 금지어 스캐너의 시간 표기 검사(candidate6SceneText.test.ts:104 /\d+\s*(분|초)/)는 아라비아 숫자만 본다 — 기획서 자신의 예시 「오 분만」·「십 분짜리」가 통과한다. 현재 상수에 실제 위반은 0건이므로 잠재 구멍이다.
- 알려진 것으로 이미 처리된 항목(S8 미구현, 320×568 grid 접힘, 리뷰 플래그 4항목 카드·회수문장 null, 시작 버튼 라벨, CI 빌링)은 위 어느 항목에도 중복되지 않는다. 단 320 항목은 예외다 — 기존 판정이 근거로 삼은 36px 수치 자체가 틀렸다는 것이 mustFix 4의 내용이다.

---

## 부록 — 반증을 통과한 21건 원문

### 1. [major] 최상위 불변식을 지킨다고 이름 붙은 가드 테스트가 실제로는 그 불변식을 검사하지 않는다. 돌연변이 2종을 넣어도 연구 테스트 114개가 전부 통과한다 — 불변식 위반도, 회수 화면 콘텐츠 전면 소실도 못 잡는다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:80`
- **근거**: 테스트 이름은 `it("문항 화면에는 회수 문장도 장면 제목도 라벨도 없다")`인데 본문(81-97행)이 검사하는 건 `sceneLabelPills(container)` 길이, `recapRows(container)` 길이, 그리고 `entry.recapLines` 문자열뿐이다. **`sceneTitle`을 단 한 번도 assert하지 않고**, 목차 시트를 여는 경로도 밟지 않는다(시트가 닫힌 기본 상태만 본다).

감사 중 작업 트리에서 이 파일의 변형본을 발견해(내가 만든 것이 아니다 — 별도 프로세스가 수정) 그대로 돌연변이 프로브로 사용했다:
- 변이 A (Prototype.tsx:415 직후 삽입) `<p ...>{CANDIDATE6_SCENE_TEXT[currentItem.id].sceneTitle}</p>` — **현재 무응답 항목**의 저작 제목을 문항 화면 본문에 직접 렌더. 불변식의 가장 직접적인 위반.
- 변이 B (Prototype.tsx:534) `bodyLines={CANDIDATE6_SCENE_TEXT[item.id].recapLines ?? [item.scenario]}` → `bodyLines={[item.scenario]}` — 회수 화면이 저작 회수문장 17항목×3줄을 전부 버리고 문항 원문만 출력.

결과: `Test Files 9 passed (9) / Tests 114 passed (114)`. 두 변이 모두 무사통과. 이후 `git checkout --`로 211b9e49 상태 복구 완료(`git status` clean 확인).

원인은 assertion이 전부 구조만 본다는 것이다 — Recap.test.tsx:108은 `rows.map(row => row.dataset.recapRow)`(id만), 111-121행 플래그 테스트는 `toContain(item.scenario)`라 변이 B에서도 참이 되고, 비플래그 항목이 `recapLines`를 쓰는지 확인하는 assertion이 어디에도 없다.
- **영향**: 이 브랜치가 운영 차단 상태를 유지한 채 통과하는 근거가 사실상 이 테스트 suite다. 지금 상태에서는 (a) 누군가 문항 화면에 장면 텍스트를 얹어도, (b) 회수 화면의 저작 카피가 통째로 사라져도 CI가 초록이다. 즉 주장 1의 방어선이 존재하지 않고, 앞으로의 리팩터링에서 측정 오염이 조용히 들어올 통로가 열려 있다.
- **반증 시도 결과**: 반증 실패 — 지적이 정확하고, 독립적으로 재현했다. (1) Candidate6Recap.test.tsx:80-98을 직접 열어 확인: 이름에 "장면 제목도 없다"가 있으나 본문은 sceneLabelPills 길이·recapRows 길이·recapLines 문자열 3가지만 assert하고 sceneTitle을 한 번도 검사하지 않는다. grep 결과 sceneTitle을 쓰는 테스트는 Candidate6CardSteps.test.tsx:216 하나뿐이고 거기서도 초대 복사 문자열을 볼 뿐 문항 화면과 무관하다. (2) 작업 트리를 별도 프로세스가 실시간으로 변형하고 있었으므로(그 프로세스의 A+B+cardCandidates 패치가 내 세션 중 들어왔다 사라짐) research/를 researchAudit/로 통째 복사해 격리 측정했다. 클린 baseline 9 files/114 tests 통과. 변이 A만 적용(문항 화면 chapter 문단 뒤에 현재 미응답 항목의 sceneTitle을 <p>로 직접 렌더) → 114/114 통과. 되돌리고 변이 B만 적용(Candidate6Prototype.tsx:534 bodyLines를 [item.scenario]로 고정) → 114/114 통과. RecapRow(1136-1142행)가 bodyLines를 가시 <p>로 렌더하고 data-recap-body로 join하므로 변이 B는 저작 회수문장 17항목×3줄을 실제로 화면에서 전부 지운다. (3) 다른 방어선 없음: 비플래그 항목이 recapLines를 렌더하는지 확인하는 positive assertion이 어디에도 없고(114행 플래그 테스트는 toContain(item.scenario)라 B에서도 참, 128-147행 라벨 불변 테스트는 recapBody를 자기 스냅샷끼리만 비교), candidate6SceneText.test.ts는 데이터만 본다. 회수문장 리터럴("이제 취향 얘기다" 등)을 apps/web/src·scripts·docs에서 grep → candidate6SceneText.ts 외 0건. scripts/tests/wedding-code-research-safety.test.mjs는 env 키 차단·요청 allowlist·lock nonce·라우트 산출물 정리만 보는 인프라 격리 가드라 화면 카피와 무관. Candidate6Prototype 소스를 스캔하는 스크립트 가드나 커스텀 eslint 룰도 없다. (4) 알려진 목록(S8·320px 접힘선·플래그 4항목 카드 없음·시작 버튼 라벨·CI 빌링) 어디에도 포함되지 않는다. (5) 도달 가능성: CANDIDATE6_SCENE_TEXT는 같은 파일에 이미 import되어 3곳에서 item.id로 인덱싱되므로 변이 A는 자연스러운 리팩터링으로 언제든 들어올 수 있다. 지적 근거 중 한 가지만 성립하지 않는다 — "목차 시트를 여는 경로를 밟지 않는다"를 결함으로 든 부분. 시트는 의도적으로 장면 제목만 보여주는 화면이고("답은 여기 적지 않아요. 장면 제목만 있어요."), Candidate6Recap.test.tsx:194-237의 별도 describe가 이미 덮는다. 순수성 테스트가 시트를 열지 않는 것은 올바른 범위 설정이지 누락이 아니다. 핵심 주장에는 영향 없다. 정리 완료: researchAudit/ 삭제, git status 비어 있음, Candidate6Prototype.tsx diff 없음.

### 2. [minor] 이 파일의 최상위 불변식 docblock이 자기 파일의 export 3개에 대해 사실이 아니다. 「회수 화면(S4)과 그 이후에만 나타난다」고 적혀 있지만 S4 이전에 렌더되는 export가 셋이다.

- **위치**: `apps/web/src/lib/weddingCode/research/candidate6SceneText.ts:10`
- **근거**: candidate6SceneText.ts:10-12 — 「**이 파일의 문장은 문항 화면(측정)에 단 하나도 렌더되지 않는다.** 회수 화면(S4)과 그 이후에만 나타난다.」

반례:
1. `sceneRhythmLabel` → Prototype.tsx:386에서 문항 화면 헤더에 렌더. 출력 문자열은 「첫 장면」·「장면 N」·「세 장 남았어요」·「다음이 마지막」·「마지막 한 장」(candidate6SceneText.ts:243-249).
2. `CANDIDATE6_INTERLUDE_SENTENCES` → Prototype.tsx:246,258에서 문항과 문항 **사이**에 렌더. 같은 파일 227행이 이걸 스스로 인정한다 — 「막간은 문항 사이에 오기 때문에 이후 항목을 프라이밍할 수 있는 유일한 지점이다」. 즉 docblock 최상단과 227행이 서로 모순된다.
3. `CANDIDATE6_SCENE_TEXT[...].sceneTitle` → Prototype.tsx:1180(목차 시트, 측정 중).

기획서(63_...md:65)는 리듬 라벨을 「장면 지문·라벨·마커 0개」의 예외로 좁게 정의해 두었지만, 코드 파일의 docblock에는 그 좁힘이 반영되지 않았다.
- **영향**: 이 docblock은 리뷰어·후임자·R1 프로토콜 작성자가 「측정면은 깨끗하다」고 판단할 때 읽는 유일한 코드측 계약서다. 문서가 실제보다 강하게 적혀 있으면, 오염 검토를 해야 할 사람이 검토를 건너뛴다. 실제로 위 F1·F2가 그 경로로 남았다.
- **반증 시도 결과**: 반증 실패. 세 반례를 파일에서 직접 확인했다. (1) candidate6SceneText.ts:10-12의 최상위 불변식 docblock에는 3~30행 어디에도 리듬 라벨·막간 예외가 적혀 있지 않다. (2) sceneRhythmLabel(candidate6SceneText.ts:243-249)이 Candidate6Prototype.tsx:386에서 렌더되며, 이 지점은 363행 `if (step === "questions" && currentItem)` 블록 내부 헤더다. 출력 중 「세 장 남았어요」는 라벨이 아니라 완결 문장이다. (3) CANDIDATE6_INTERLUDE_SENTENCES(230-234행)가 Prototype.tsx:246,258의 interlude 스텝에서 렌더되고 그 위치는 interludeIndexes가 정하는 문항 사이 = S4 이전이다. 같은 파일 227행 「막간은 문항 사이에 오기 때문에…」가 자인하므로 10행과 227행이 한 파일 안에서 직접 모순한다. (4) sceneTitle이 Prototype.tsx:1180 ContentsSheet에서 렌더되고, ContentsSheet는 494-501행 questions 스텝 return 내부에 마운트되며 헤더 버튼(390행 setContentsOpen(true))으로 도달 가능하다. 자기 주석(1150행)이 「아직 측정 중이므로」라고 인정한다. 반증 시도 전부 실패: 「문장」을 recapLines·card로 좁게 읽어도 막간 상수는 이 파일이 저술한 완결 문장이며 S4 이전에 렌더되므로 두 번째 문장이 거짓이다. 다른 곳이 막고 있지도 않다 — 오히려 Candidate6Prototype.test.tsx:60,79,98이 문항 화면의 [data-scene-rhythm] 텍스트를, Candidate6Rhythm.test.tsx:117이 막간 문장 렌더를 계약으로 고정한다. 「이미 알려진 것」 5항목 어디에도 없어 중복도 아니다. 다만 영향은 문서 정확성에 국한된다: 런타임 결함 0, 기획서(63_...md S1 절)는 「좌상단 이야기 리듬 라벨」을 명시해 정확하므로 문서 권위 계층은 맞고 코드측 docblock만 실제보다 강하다. 주장 2·4·6·9는 이 반례로 무너지지 않고 주장 1만 문자 그대로 거짓이다. whyItMatters의 "F1·F2가 이 경로로 남았다"는 인과 주장은 이 범위에서 검증되지 않았다.

### 3. [major] 주장 1("문항 측정 화면에 새 문장·라벨·마커를 하나도 얹지 않았다")은 거짓이다. 목차 시트가 측정 중에 우리가 저작한 sceneTitle 21종과 라벨 pill 2종을 렌더하고, 그것을 검증한다는 이름의 테스트는 그 경로를 한 번도 열지 않는다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:1177-1183`
- **근거**: Candidate6Prototype.tsx:388-394 — questions step 헤더에 상시 노출되는 버튼 `onClick={() => setContentsOpen(true)}` (라벨 「지나온 장면」). 열리면 Candidate6Prototype.tsx:1177-1183이 지나온 전 항목에 대해 `{CANDIDATE6_SCENE_TEXT[item.id].sceneTitle}` + `<SceneLabelPills ... onToggle={onToggle} />`를 렌더한다(조작까지 가능). 그런데 오염 검사 Candidate6Recap.test.tsx:80-98은 시트를 열지 않은 상태에서만 `expect(sceneLabelPills(container)).toHaveLength(0)`을 단정하므로 항상 통과한다 — 같은 파일 219-236의 다른 테스트가 시트를 열면 제목과 pill이 나온다는 것을 스스로 증명한다. 기획서 §3 S1b도 이 배치를 명시하므로 구현 실수가 아니라 **주장 문구가 구현과 어긋난 것**이다.
- **영향**: ES2/AS2·CP1/CP3는 `scenario`가 문자 그대로 같다(candidate6.ts:190 support-b 「후보가 많아 비교가 끝나지 않는 장면」, candidate6.ts:370·396 「맡은 일을 진행 중인 장면」). journey index 10(C6-AS2)을 아직 답하지 않은 상태에서 시트를 열면 index 8(C6-ES2)에 대한 **우리 해석** 「복잡한 마음」이 화면에 뜬다. 동일 지문 쌍을 구별하는 단서를 측정 도중에 우리가 주입하는 것이고, 이는 이 설계가 "구조적으로 불가능"하다고 문서에 적은 바로 그 오염이다. R1 결과를 "Tier B는 회수 이후에만 존재했다"는 전제로 해석하면 그 전제가 참이 아니다.
- **반증 시도 결과**: 반증 실패. 인용된 코드가 HEAD(211b9e49)에 그대로 있고 도달 가능하며, 막고 있는 테스트·가드가 하나도 없다. `git show HEAD:...`로 워킹트리와 별도 검증함.

【사실 확인 — 전부 참】
1. Candidate6Prototype.tsx:388-394 (HEAD 동일) — `step === "questions"` 헤더에 상시 노출 버튼 「지나온 장면」 → `setContentsOpen(true)`. 조건 없음.
2. :494-501 — `ContentsSheet items={journey.slice(0, questionIndex)}`가 questions 렌더 분기(363-505) **안**에 마운트된다.
3. :1177-1183 — 지나온 전 항목에 `{CANDIDATE6_SCENE_TEXT[item.id].sceneTitle}` + `<SceneLabelPills onToggle={toggleSceneLabel}>`(조작 가능). 즉 측정 중 우리 저작 제목 + 라벨 pill이 렌더된다.
4. Candidate6Recap.test.tsx:80-98 — 이름은 「문항 화면에는 회수 문장도 **장면 제목**도 라벨도 없다」인데, `CANDIDATE6_SCENE_TEXT`를 import해 `.recapLines`만 순회한다. **`sceneTitle`을 단 한 번도 단정하지 않고**, 시트를 열지도 않는다 → 위반 경로에 커버리지 0. 같은 파일 219-236이 시트를 열면 행이 나온다는 것을 스스로 증명.
5. 기획서 §11 RED 1(63_..._plan:353)이 정확히 이 단정을 요구했다: "questions step DOM에 tierB 문자열·**sceneTitle**·라벨 pill이 단 하나도 없음을 단정(Form A/B × ES_FIRST/AS_FIRST 4조합)". 구현된 테스트는 sceneTitle 미검사·시트 미개방·Form A/ES_FIRST 1조합뿐 — **명세된 가드가 미구현**이다.
6. 더 나아가 candidate6SceneText.ts 헤더 독스트링이 "**이 파일의 문장은 문항 화면(측정)에 단 하나도 렌더되지 않는다. 회수 화면(S4)과 그 이후에만 나타난다**"고 단정하는데, sceneTitle이 그 파일에 있고 측정 중에 렌더된다 → 소스 자체의 불변식 진술이 거짓. 기획서 §5-A(:172)도 "제목 12자 이내"를 Tier B 저작 규칙에 넣고 Tier B는 "회수(S4) 이후 화면에서만 렌더된다"고 못 박았으므로, 문서 자체 분류상 Tier B 유출이다.
7. "이미 알려진 것" 5항목·§13(13-1~13-5) 어디에도 없다 → 중복 아님.

【지적에서 과장된 부분(부분 반증)】
- 오염 인과가 약하다. 시트는 `journey.slice(0, questionIndex)`로 **지나온 항목만** 보여 미응답 항목의 문장 선노출은 0이다. 그리고 동일 `scenario` 쌍을 실제로 구별하는 자극은 `behavior`이고 그것은 각 문항 화면에 전문이 렌더된다(C6-ES2 behavior "상대가 복잡하게 느끼는 마음을 인정해 준다" → 제목 "복잡한 마음" / C6-AS2 "상대가 비교할 기준 하나를 제안한다" → "기준 하나 제안"). 제목은 사용자가 그 문항에서 이미 읽은 문장의 손실 압축이라, AS2 화면이 자체로 주지 않는 단서를 새로 주입하지는 않는다.
- 회수 문장(recapLines) 유출은 없다 — 시트 행은 `data-recap-body=""` 하드코딩이고 :232-235가 이를 고정한다. 따라서 "Tier B는 회수 이후에만 존재했다"는 전제는 3줄 회수 문장에 대해서는 참이고, 제목을 Tier B로 세는 문서 분류를 적용할 때만 거짓이다.

【부수 발견 — 지적자 본인 절차 주장이 거짓】
"git checkout -- 복원, 최종 트리 clean 재확인"이라고 했지만 트리가 clean이 아니다. `git status --porcelain`: ` M Candidate6Prototype.tsx`(:533 `title={CANDIDATE6_SCENE_TEXT[item.id].sceneTitle}` → `title={""}`로 남은 **미복원 변이**), `?? __tests__/zz_probe.test.ts`, `?? weddingCode/researchAudit/`. 이 변이는 회수 화면(S4) RecapRow 제목이고 인용된 시트 경로와 무관하므로 증거 자체는 훼손되지 않았으나(HEAD로 독립 검증함), 부수적으로 **그 변이가 살아남았다** = 회수 행 제목을 고정하는 테스트도 없다는 뜻이다. 남은 파일 3건은 커밋 전에 정리해야 한다.

【결론】주장 1은 문자 그대로 거짓이다. 다만 심각도의 근거는 지적자가 든 ES2/AS2 프라이밍이 아니라, ①소스 독스트링이 거짓 불변식을 진술함 ②스스로 "최상위 불변식"이라 부른 것의 가드가 위반 경로에서 구조적으로 실패 불가능함 ③기획서 RED 1이 명세한 단정이 미구현임 — 이 셋이다. 운영 표면 영향은 0(연구 프로토타입).

### 4. [minor] 주장 3의 절반 — "카드 후보가 **응답**과 무관하다" — 을 증명하는 테스트가 하나도 없다. 라벨 독립성만 검증됐고, 응답 독립성은 arity 검사 1줄로 대체돼 있는데 그 검사는 우회가 자명하다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/Candidate6CardSteps.test.tsx:51-59`
- **근거**: 카드 단계에 도달하는 모든 워크스루가 `container.querySelector('input[value^="bipolar-"], input[value^="impact-"]')` 즉 **항상 첫 라디오**만 누른다(CardSteps.test.tsx:52, 112; Prototype.test.tsx:134; Recap.test.tsx:63). candidate6.ts:96·99-105 기준 그 값은 언제나 `bipolar--2` / `impact-strongly_hinders`다 — `neutral_impact`도 escape도 단 한 번도 선택되지 않는다. escape를 전 항목에 넣는 워크스루는 Candidate6Rhythm.test.tsx:124-159에 있지만 막간 위치만 보고 카드 화면에 도달하지 않는다(기획서 §10 RED 3의 "escape 4택을 전 항목에 선택해도 배열 불변"이 미구현). 남은 방어선인 candidate6SceneText.test.ts:222-224 `expect(deriveCardCandidates.length).toBe(1)`은 `(ids, responses = {})`처럼 기본값을 주면 `Function.length`가 그대로 1이라 통과한다. **변이 검증**: Candidate6Prototype.tsx:237의 cardCandidates에 `.filter(id => responses[id]?.kind !== "escape" && responses[id] !== {kind:"impact",level:"neutral_impact"})`를 심고 6개 파일 실행 → 66/66 통과.
- **영향**: 화면은 "라벨은 후보를 바꾸지 않아요"라고만 주장하지만 설계 주장은 응답까지 포함한다. 응답 기반 필터가 들어오면 "거의 없음"이나 "넘길게요"를 고른 장면의 카드가 조용히 사라지고, 사용자는 21문항 직후 짧아진 목록을 보며 "내 답을 보고 걸렀다"고 믿는다 — 기획서 §11 위험 5가 카피로 막으려던 바로 그 오해를 코드가 실제로 만들어내는데 테스트가 침묵한다.
- **반증 시도 결과**: 반증 실패 — 다섯 가지 사실 요소 전부와 변이 결과까지 직접 재현했다.

(1) 옵션 순서: `candidate6.ts`의 `CANDIDATE6_BIPOLAR_DIRECTIONS = [-2,-1,0,1,2]`, `CANDIDATE6_IMPACT_LEVELS = ["strongly_hinders", ...]`이고 `Candidate6Prototype.tsx:891·931`이 그 배열을 그대로 map 한다. 따라서 `querySelector('input[value^="bipolar-"], input[value^="impact-"]')`의 첫 매치는 항상 `bipolar--2` / `impact-strongly_hinders`다. 카드 화면에 도달하는 워크스루 4개(CardSteps 52·112, Prototype 134, Recap 63·221) 전부 이 셀렉터만 쓴다 — grep 전수 확인, 예외 0.

(2) escape 워크스루는 `Candidate6Rhythm.test.tsx:124-159` 하나뿐이고 마지막에 "지나온 장면 보기"까지만 눌러 recap에서 끝난다. "오늘 꺼낼 한 마디 고르기"를 누르지 않으므로 카드 화면에 도달하지 않고, 단정도 `expect(withEscape).toEqual(withNormal)`(막간 인덱스)뿐이다. 지적 내용 그대로다.

(3) `candidate6SceneText.ts:268-272`의 `deriveCardCandidates(administeredIds)`는 응답을 볼 수 없다는 게 구조적으로 참이지만, `expect(deriveCardCandidates.length).toBe(1)`(candidate6SceneText.test.ts:222-224)은 **호출 지점**을 전혀 제약하지 못한다. 실제 필터가 들어갈 자리는 `Candidate6Prototype.tsx:237`의 `cardCandidates` useMemo이고, 거기서는 `responses`가 스코프에 그대로 있다.

(4) 변이 검증 직접 재현: 기준선 6파일 66/66 green → `cardCandidates`에 `responses[id]?.kind === "escape"` 및 `impact/neutral_impact` 제거 필터를 심고 deps에 `responses` 추가 → **66/66 그대로 green**. 지적의 수치와 일치. (변이는 `git checkout --`로 복원 완료.)

(5) 다른 방어선 없음: repo 전체에서 `cardCandidates|deriveCardCandidates|data-card-candidate`를 참조하는 파일은 소스 2개 + 테스트 3개뿐이고, `wedding-code-candidate6-visual-qa.mjs`/`-security-qa.mjs`에도 후보·escape 검사가 없다. 타입 층도 못 막는다(호출 지점 `.filter`는 정상 타입체크).

중복도 아니다 — "이미 알려진 것" 5항목(S8, 320×568 grid, 리뷰 플래그 카드 없음, 시작 버튼 카피, CI)에 없고, 기획서 §13-5 "구현 갭"은 intro(S0) 두 건만 기록했다. 반면 기획서는 이 테스트를 명시적으로 요구한다: §10 RED 3 "escape 4택을 전 항목에 선택해도 배열 불변", 그리고 §9 S5 사양(line 121) "라벨·응답이 배열에 관여하지 않음을 deep-equal 테스트로 고정". 즉 기획이 지정한 RED 하나가 미구현인데 갭 장부에 안 올라갔다.

다만 severity는 major → minor로 조정한다. 현재 구현은 실제로 응답 독립적이므로 **살아 있는 결함이 아니고**, 표면은 운영 차단된 연구 프로토타입이다. 순수 함수 시그니처가 함수 내부의 응답 접근은 진짜로 막는다. 남는 것은 회귀 fence 결손 — 미래에 "넘긴 장면은 빼주는 게 친절하다"는 자연스러운 오판이 들어와도 테스트가 침묵한다는 것이고, 수정 비용은 escape/neutral을 전 항목에 고른 워크스루 1개로 카드 화면까지 걸어가 `EXPECTED_CANDIDATES`와 deep-equal 하는 검사 한 개다.

부수 관찰: 감사 중 다른 세션이 같은 파일에 별도 변이(`sceneLabelBase`에 `hidden` 추가)와 `apps/web/.mutcheck/` 백업을 두고 진행 중이라 그 변경은 손대지 않았다. 내 변이만 복원했다.

### 5. [major] 오염 차단 테스트의 이름은 "회수 문장도 **장면 제목**도 라벨도 없다"인데, 실제로 검사하는 것은 `recapLines`뿐이다. sceneTitle·card.prompt·card.when·card.action 어느 것도 문항 화면 부재 검사를 받지 않는다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:80-98`
- **근거**: 87-95줄이 유일한 문자열 검사이고 둘 다 `entry.recapLines`만 순회한다(`for (const line of entry.recapLines ?? [])`, `for (const other of Object.values(...)) for (const line of other.recapLines ?? [])`). sceneTitle 21개와 card 3필드×17개는 루프 대상이 아니다. **변이 검증**: 문항 화면 Candidate6Prototype.tsx:415-417 바로 아래에 `<p>{CANDIDATE6_SCENE_TEXT[currentItem.id].sceneTitle}</p>`를 추가 → 66/66 통과. 덧붙여 기획서 §10 RED 1은 "tierB 문자열·sceneTitle·라벨 pill … **Form A/B × ES_FIRST/AS_FIRST 4조합**"을 요구했지만 컴포넌트 테스트는 전부 `form="A"` 기본 `ES_FIRST` 1조합뿐이다(`supportPairOrder` prop을 넘기는 테스트가 0개).
- **영향**: 이 파일이 스스로 "최상위 불변식"이라 부르는 것(재미 문장이 M0 문항 기준점을 옮긴다)의 절반이 무방비다. 저작 문장이 측정 화면으로 새는 회귀가 들어와도 66개 테스트가 전부 초록으로 남고, 그 상태로 수집한 R1 응답은 오염 여부를 사후에 판별할 방법이 없다.
- **반증 시도 결과**: 반증 실패 — 지적이 정확하다. (1) 코드 확인: Candidate6Recap.test.tsx:80-98의 단정은 sceneLabelPills 길이 0, recapRows 길이 0, 그리고 entry.recapLines/other.recapLines 순회 2개가 전부다. sceneTitle·card.prompt·card.when·card.action은 어느 루프에도 없다. 테스트 이름이 "장면 제목"을 명시하는데 장면 제목을 검사하는 코드가 없다. (2) 변이 독립 재현: 기준선 114/114 green(9파일, 감사의 66은 더 좁은 선택) 확인 후 Candidate6Prototype.tsx:415-417의 {currentItem.chapter} 바로 아래에 <p data-MUTATION="">{CANDIDATE6_SCENE_TEXT[currentItem.id].sceneTitle}</p> 삽입 → **114/114 그대로 통과**. 저작 카피가 M0 측정 화면에 렌더되는데 전 스위트가 침묵한다. git checkout -- 복원, 잔여물 grep 0건, 재실행 114/114. (3) 다른 가드 부재: 5개 컴포넌트 테스트 + candidate6SceneText.test.ts 전부 확인. candidate6SceneText.test.ts는 문자열 내용(자수·금지어·시간표기)만 제약하고 렌더 위치는 말하지 않는다. Candidate6Prototype.test.tsx의 부정 regex는 최종 카드 화면 대상이다. 타입으로도 표현 불가. (4) 4조합 부속 주장도 사실: supportPairOrder/AS_FIRST는 candidate6.test.ts(순수 journey 빌더)에만 있고 컴포넌트 테스트는 prop도 form="B"도 넘기지 않는다. 다만 이 부분은 감사 주장을 오히려 약화시킨다 — 문항 화면 JSX는 4조합에서 동일하므로 오염 회귀는 어느 조합에서든 똑같이 새거나 안 샌다. 주 지적은 여기 의존하지 않는다. (5) "이미 알려진 것" 5항목(S8·320×568 접힘선·리뷰 플래그 4항목·시작 버튼 라벨·CI) 어디에도 중복되지 않는다. 부분 완화 요인 2개는 확인했으나 구제하지 못한다: 실동작 결함은 없고(questions 분기는 currentItem.chapter/scenario/prompt/premise/behavior와 anchor만 렌더 — candidate6SceneText.ts 문자열 0개), questions 단계에서 유일하게 SCENE_TEXT를 만지는 ContentsSheet(1180줄)는 data-recap-row·data-scene-label을 함께 내보내 두 구조 검사에 우연히 걸린다. 그러나 그 커버리지는 이름이 약속한 텍스트 검사가 아니라 구조적 우연이고, 현실적 회귀(사용자 위치 안내용 장면 제목 헤더 추가)는 맨 <p>라 그대로 통과한다.

### 6. [major] 회수 화면이 저작한 `recapLines`·`sceneTitle`을 실제로 렌더하는지 단정하는 테스트가 없다. 이 기능 전체가 조용히 사라져도 전 테스트가 통과한다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:100-148`
- **근거**: 회수 관련 단정 목록: 100-109는 `row.dataset.recapRow` 즉 **id만** 비교, 111-121은 플래그 4항목이 `item.scenario`를 담는지만(= recapLines가 null인 경우만) 확인, 125-148은 `snapshot()`을 자기 자신과 비교하는 자기참조라 어떤 본문이든 통과. `data-recap-body`(Candidate6Prototype.tsx:1136)는 `bodyLines`에서 파생된 값이라 스냅샷 비교의 양변이 함께 움직인다. candidate6SceneText.test.ts는 상수의 존재·치수만 보고 렌더를 보지 않는다. **변이 검증**: Candidate6Prototype.tsx:534를 `bodyLines={CANDIDATE6_SCENE_TEXT[item.id].recapLines ?? [item.scenario]}` → `bodyLines={[item.scenario]}`로 바꿔 저작 문장 17×3줄을 전부 폐기 → 66/66 통과.
- **영향**: 회수 화면(S4)은 기획서가 "이 설계의 본체"라 부르는 곳이고, 저작 문장이 사라지면 남는 것은 원래의 재미없는 지문 목록이다. 즉 이번 커밋의 핵심 산출물이 리팩터링 중에 통째로 되돌아가도 CI가 알려주지 않는다. RED 2가 자기참조 스냅샷으로 구현되면서 "라벨이 본문을 안 바꾼다"만 남고 "본문이 존재한다"가 빠졌다.
- **반증 시도 결과**: 반증 실패. 지적이 정확하고, 내가 사례를 하나 더 찾았다.

[인용 코드 검증 — 전부 일치] Candidate6Prototype.tsx:534 = `bodyLines={CANDIDATE6_SCENE_TEXT[item.id].recapLines ?? [item.scenario]}`, :1136 = `data-recap-body={bodyLines.join(" ")}`. 스냅샷 속성이 같은 `bodyLines` prop에서 파생되므로 비교 양변이 함께 움직인다는 서술이 참이다.

[단정 성격 검증 — 전부 일치] Candidate6Recap.test.tsx:108은 `row.dataset.recapRow`(id)만 비교. :114-120은 `recapLines === null`로 필터한 플래그 항목만 `item.scenario` 포함을 확인하므로, 본문이 scenario뿐이어도 만족한다. :128-147은 라벨 토글 전/후 비교 — 라벨 독립성이라는 실제 불변식이지만 본문 내용을 고정하지 않는다.

[레포 전수 grep] 저작 문장 리터럴("조건은 둘 다 맞다", "마지막 두 곳" 등)이 렌더된다고 단정하는 테스트가 어디에도 없다.

[변이 검증 — 기준선 66/66 green 확인 후]
- 변이 A(보고서 재현): `bodyLines={[item.scenario]}` → 66/66 통과. 재현됨.
- 변이 B(보고서에 없는 신규): 회수 행 `title={""}` → 66/66 통과. 회수 화면 sceneTitle 렌더도 무단정. 갭이 더 넓다.
- 변이 C(반증 시도): candidate6SceneText.ts의 recapLines 배열 17개 전부 null → FAIL(`C6-DS1에 회수 문장이 없다`, candidate6SceneText.test.ts:54).

[변이 C = 유일한 반증 재료지만 불충분] 상수 자체는 존재·치수(15자·3줄·금지어)가 보호된다. 따라서 폭발 반경은 "기능 전체가 사라진다"보다 좁다 — 저작 데이터는 조용히 삭제 불가, **렌더 배선만** 조용히 끊긴다. 사용자에게 보이는 결과는 동일하므로 메커니즘만 정정되고 결론은 유지된다.

[중복 아님] §13-4는 회수 화면의 **접힘선**이 미측정이라는 뷰포트 항목이고 커버리지가 아니다. §13-5는 intro 갭. 알려진 "플래그 4항목에 카드·회수문장 없음"은 null 케이스이고, 이 지적은 문장이 **있는** 17항목에 관한 것이다.

[도달 가능] 회수(S4)는 본류이고 테스트가 이미 walkToRecap으로 도달한다.

[기준 미달을 보여주는 내부 대조] 같은 커밋 시리즈가 카드 쪽은 더 높은 기준을 지킨다 — Candidate6CardSteps.test.tsx:183-185가 `face.textContent`에 card.prompt/when/action 포함을 단정하고, :211-212가 초대 문자열을 고정한다. 회수 화면만 예외이고, 기획서는 그 화면을 "이 설계의 본체"라 부른다.

복원 완료: 66/66 green, 트리 clean(gitignore된 researchAudit/ 스크래치만 남음 — 동시 실행 세션 것).

### 7. [minor] 라벨 2종 대칭 검사가 **미선택 상태**에서만 돈다. 그 상태에서 두 pill의 className은 같은 상수(`sceneLabelBase + sceneLabelIdle`)로 조립되므로 사실상 자기 자신과의 비교이고, 비대칭이 발생할 수 있는 유일한 상태(선택됨)는 검사되지 않는다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/Candidate6Recap.test.tsx:150-167`
- **근거**: `await walkToRecap()` 직후 곧바로 첫 행의 두 pill className을 비교하는데, 이 시점 라벨은 0개다. Candidate6Prototype.tsx:1097-1099·1108-1110을 보면 미선택 분기는 양쪽 모두 `sceneLabelIdle`로 동일 문자열이고, 색이 갈리는 것은 선택 분기뿐이다. 테스트는 한 번도 pill을 누른 뒤 다시 비교하지 않는다. **변이 검증**: not-ours 선택 분기를 `"bg-[#8F6662] text-white border-[#8F6662] scale-50 opacity-40 text-[9px] min-h-[20px]"`로 바꿔 반대 라벨만 절반 크기·40% 불투명으로 만듦 → 66/66 통과.
- **영향**: "우리 얘긴 아니에요"는 명중하지 않은 장면을 소외가 아닌 표현으로 바꾸는 유일한 채널이고, 기획서 §3 S1b는 두 pill의 크기·press·전환 클래스가 완전히 같아야 한다고 못 박는다. 반대 의사표시만 시각적으로 위축되는 회귀가 들어오면 라벨은 흡수 장치가 아니라 순응 유도가 되는데, 그 전환을 잡으라고 쓴 테스트가 잡지 못한다.
- **반증 시도 결과**: 반증 실패. (1) Candidate6Recap.test.tsx:62-76의 walkToRecap()은 radio와 다음/넘기기 버튼만 클릭하고 pill을 누르는 경로가 없어, 150-167행 단정 시점의 sceneLabels는 {}다. (2) Candidate6Prototype.tsx:1097-1099·1108-1110은 label이 undefined일 때 양쪽 모두 `${sceneLabelBase} ${sceneLabelIdle}`로 바이트 동일 문자열을 생성하므로 166행 비교는 같은 상수끼리의 비교다. (3) 선택 상태 className을 단정하는 테스트가 저장소에 없다 — CardSteps.test.tsx:120-125는 pill을 누르지만 카드 후보 id만 비교하고, Recap.test.tsx:125-148은 누른 뒤 id·recapBody·버튼 텍스트만 스냅샷한다(className 미포함). (4) 독립 재현: 공용 파일을 동시 변이 중인 다른 세션과의 경합을 피해 apps/web/.mutcheck/에 격리 복사본을 만들어 측정(측정 후 삭제, git status clean). 기준선 46/46 green → not-ours 선택 분기를 "bg-[#8F6662] text-white border-[#8F6662] scale-50 opacity-40 text-[9px] min-h-[20px]"로 변이 → 46/46 통과(생존). 대조 변이로 미선택 분기에 scale-50 opacity-40을 붙이면 166행이 실패하므로, 이 테스트의 실효 범위는 idle 상태로 한정된다. (5) 기획서 근거 정확: docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:81이 두 pill의 선택 색을 각각 지정한 직후 "두 pill의 크기·press·전환 클래스 문자열 완전 동일"을 못 박고, 111행은 recap pill이 S1b와 동일 컴포넌트·수치임을 요구한다. 테스트 이름("색 토큰만 다르다")이 주장하는 대상이 바로 선택 상태다. 부분 교정: "비대칭이 발생할 수 있는 유일한 상태가 선택됨"은 과장 — idle 비대칭도 가능하고 그것은 잡힌다. 그러나 색이 갈리는 유일한 상태가 미검사라는 핵심은 성립한다. 중복 아님(알려진 4항목과 무관). 현재 렌더 코드는 양쪽 대칭이라 사용자 영향 0, 연구 표면(운영 차단 하위)의 회귀 감시 공백만 실재하므로 minor 유지. 수정은 1행: 비교 전에 pill을 눌러 선택 상태를 만드는 것.

### 8. [minor] 회수 화면이 「저희가 해석한 게 아니라, 방금 지나오신 장면 그대로예요.」라고 단언하지만, 같은 화면의 recapLines는 문항 원문에 없는 새 사실·권유·단정을 여러 곳에서 추가한다. 화면의 핵심 신뢰 문장이 바로 아래 목록에 의해 반증된다.

- **위치**: `C:/Users/admin/Desktop/weddinghanbang_website/hanbang-web/apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:519`
- **근거**: Prototype.tsx:519 `저희가 해석한 게 아니라, 방금 지나오신 장면 그대로예요.` / 바로 아래 534행이 `CANDIDATE6_SCENE_TEXT[item.id].recapLines`를 렌더한다.
반증 사례(전부 문항 premise·scenario·behavior에 없는 문장):
- candidate6SceneText.ts:60 DS1 `"이제 취향 얘기다."` — 문항은 두 anchor(진행 조건 / 원하는 축하 장면) 중 순서를 물을 뿐인데, 회수는 남은 대화가 '취향'이라고 결론짓는다.
- candidate6SceneText.ts:136 CP1 `"같이 확인하면 된다."` — 측정 대상 behavior(`약속한 중간 시점에 진행 상태를 함께 확인한다`)를 권유형으로 바꿔 되돌려준다.
- candidate6SceneText.ts:127 OA3 `"순서는 내가 정한다."` — behavior를 이미 일어난 사실로 단정한다.
- candidate6SceneText.ts:194 AS3 `"대안을 봐야 한다."` — premise는 `대안을 살펴볼 시간은 충분해요`(가능)인데 의무형으로 바뀐다.
- **영향**: P1(trust)이 최우선인 제품에서, 신뢰를 얻으려고 놓은 문장이 검증 가능하게 거짓이다. 「많이 방해돼요」로 답한 사람은 자기 답과 반대되는 권유(`같이 확인하면 된다`)를 '내가 방금 지나온 장면 그대로'라는 이름표를 달고 다시 받는다. R1 인지면접에서 참가자가 이 불일치를 발견하면 회수 화면 전체의 신빙성이 무너진다.
- **반증 시도 결과**: 반증 실패 — 핵심 주장은 살아남는다. 다만 인용 4건 중 2건은 무효다.

확인된 것
- 인용 정확. candidate6SceneText.ts:60·127·136·194에 그 문장들이 실제로 있다(첫 Bash 읽기가 stale 스냅샷이라 `recapLines: null`로 보였으나, Read·Grep·Bash 재실행 3개가 일치). Prototype.tsx:519의 신뢰 문장과 534행 `recapLines` 렌더는 같은 `<section>` 안, 바로 위아래다.
- 도달 가능. localPreviewPage.tsx가 유일 진입인데 `NODE_ENV==='development'` + `WEDDING_CODE_RESEARCH_PREVIEW==='true'` + hostname ∈ {localhost,127.0.0.1,[::1]} 3중 게이트 + noindex. 운영 노출 0. 그러나 그 로컬 프리뷰가 바로 R1 인지면접 표면이므로 지적이 말한 영향 경로 자체는 실재.
- 막는 가드 없음. candidate6SceneText.test.ts는 길이 상한·판정어휘·분초표기·카드 안전만 본다. Candidate6Recap.test.tsx:111-121의 원문 대조는 `recapLines === null`인 플래그 4항목 한정이고, 저작된 17항목엔 충실성 검사가 없다. 오히려 :104가 신뢰 문장을 assert로 못박아 놓았다.
- "이미 알려진 것" 중복 아님. 그 목록은 플래그 4항목에 회수문장이 *없다*는 역방향 사실이다.

인용 중 무효 2건
- AS3 `대안을 봐야 한다` — 선택 인용. 지적은 premise(`대안을 살펴볼 시간은 충분해요`, 가능)만 들었지만 같은 항목 scenario(candidate6.ts:196, SUPPORT_PAIR_C)가 `기대했던 선택지를 바꿔야 하는 장면` — 의무형이 문항 원문에 이미 있다. 충실한 재진술이다.
- OA3 `순서는 내가 정한다` — 주장한 근거가 틀렸다. 원본 behavior(candidate6.ts:360)도 `순서를 스스로 정한다`로 동일한 평서·현재형이다. "이미 일어난 사실로 단정"이 아니다. (별개 결함은 있다 — 1인칭 `내가`가 문항이 지정하지 않은 담당자 역할을 응답자에게 배정한다. OA1·OA2는 `한 명이`를 유지한다. 그러나 이건 지적된 내용이 아니다.)

살아남는 2건
- DS1 `이제 취향 얘기다` — 가장 강하고 명확하다. premise가 `두 종류의 이야기를 모두 나눌 수 있어요`로 두 대화가 모두 열려 있다고 못박는데, 회수는 남은 게 취향 하나라고 닫는다. bipolar-order 항목의 leftAnchor(`실제 진행 조건이…`)를 지우고 rightAnchor 쪽으로 해소해버린다. 좌측 anchor를 고른 사람은 "저희가 해석한 게 아니라"라는 이름표를 달고 자기가 먼저 꺼내겠다고 한 대화가 끝났다는 말을 받는다. 게다가 DS1은 journey·P1 패널 첫 항목(candidate6.ts:741, 801)이라 제일 먼저 읽힌다.
- CP1 `같이 확인하면 된다` — 좁게 성립. behavior는 평서(`함께 확인한다`)인데 `-하면 된다`는 당위·충분 화행이다. 저작된 17항목 3행 중 이 형태는 여기 하나뿐이고 형제들은 전부 가능·허용형이다(JI1 `같이 만들어도 된다`, JI3 `하나만 골라도 된다`, JI2 `같이 볼 수 있다`, CP2 `아직 고칠 수 있다`). balanced-impact 항목에서 `많이 방해돼요`로 답한 사람이 권유를 되받는다는 독법은 정당하다.

부수적으로 core 주장을 뒷받침: 파일 자신의 저작 규칙(candidate6SceneText.ts:16)이 `과잉 구체 디테일 정확히 하나`를 회수문장에 배정한다 — 문항 원문 밖 저작을 스펙이 이미 인정하는 셈이라 `저희가 해석한 게 아니라`의 절대적 표현과 상충한다.

### 9. [minor] 화자 1인칭이 「저희」·「우리」·「제」로 세 갈래다. 특히 「제 화면」은 앱이 화자인 해요체 문맥에서 '앱의 화면'을 뜻하게 되고, 「우리는 이 카드를 보관하지 않았어요」의 '우리'는 바로 앞 화면이 부부를 가리키도록 훈련시킨 그 단어다.

- **위치**: `C:/Users/admin/Desktop/weddinghanbang_website/hanbang-web/apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:703`
- **근거**: Prototype.tsx:703 `상대가 아무것도 안 해도 제 화면은 그대로예요.` — 화면 전체가 운영자 해요체(`보여드려요`·`골라주세요`)이므로 '제'는 앱의 1인칭이 된다. 의도는 사용자의 화면이다.
Prototype.tsx:519 `저희가 해석한 게 아니라` (회사=저희) ↔ 784행 `우리는 이 카드를 보관하지 않았어요` (회사=우리) ↔ 1101·1112행 라벨 `우리 얘기` / `우리 얘긴 아니에요` (부부=우리) ↔ 280행 h1 `우리 얘기, 어디서부터 꺼낼까요` (부부=우리).
- **영향**: 1인칭이 흔들리는 지점이 하필 비호혜 약속(703행)과 미보관 약속(784행), 즉 이 경험이 신뢰를 버는 두 문장이다. '제 화면'이 앱 화면으로 읽히면 「상대가 안 해도 내 결과는 그대로」라는 약속이 전달되지 않는다.
- **반증 시도 결과**: 반증 실패. 인용 6곳 중 5곳이 정확하고(703·519·1101·1112·280), 「우리는 이 카드를 보관하지 않았어요」는 784행이 아니라 778행 — 행번호 6줄 오차뿐 실체는 그대로다.

Part B(1인칭 3갈래)는 감사가 든 것보다 강하게 확인된다. card-face 한 화면에 두 지시체가 동시에 렌더된다: C6-DS2/C6-SI1/C6-SI2를 고르면 739행이 카드 문장을 24px로 출력(「우리 나중에 뭘 제일 다시 볼까?」/「우리 그림부터 먼저 맞춰볼까?」, 우리=부부, C6-SI1은 750행 action에 「우리가 편한 쪽 하나만 먼저 정하기」까지)하고, 그 아래 778행이 13px로 「우리는 이 카드를 보관하지 않았어요」(우리=회사)를 출력한다. 같은 뷰포트·같은 단어·두 지시체.

Part A(제 화면)는 파일 자신의 관행이 "의도된 선택" 방어를 무너뜨린다. 574·579행이 이미 앱 화자가 사용자를 「나」로 부르는 관행을 세웠고(「상대가 나한테 물어줄 한 마디를 골라주세요」, 「꺼내는 사람이 늘 나였다면」), 519행은 회사를 「저희」로 부른다. 703행의 「제」는 519행 회사가 쓰는 저-어간의 겸양형이라, 파일 내 유일하게 회사 대명사족과 충돌하는 독자 소유격이다. 의도가 사용자 화면임은 기획서 자신이 증명한다 — 같은 비호혜 약속을 산문에서 151·199행 「내 화면」, 211행 「내 결과」로 쓰면서 화면 문자열만 283행 「제 화면」이다.

반증 시도 전부 실패: ①도달 가능 — 785행 moveToStep("invite")로 703 도달, card-face는 641·656행에서 진입. ②가드 없음, 오히려 역방향 — Candidate6CardSteps.test.tsx:208이 「제 화면」 문자열을 그대로 단정해 결함을 고정한다. ③기지 목록(S8·320px grid·리뷰 플래그 4·시작 버튼 라벨·CI) 어디에도 없음. ④기획서가 155·211·283행에서 「제 화면」을 명시하고 778행 문장은 artifact 안에서 축자 이식된 것(문서 232·273행)이지만, 이는 책임 소재를 기획 단계로 옮길 뿐 결함을 없애지 못한다 — 감사 렌즈가 명시적으로 한국어 카피·두 갈래 읽힘이다.

과장된 부분은 하나: whyItMatters의 "약속이 전달되지 않는다". 앱-화면 독법에서도 「화면은 그대로예요」는 「상대가 안 해도 안 바뀐다」를 여전히 전달하고, 잃는 것은 독자에게로의 소유격 정박이라 안심이 시스템 서술로 격하될 뿐 파괴되지 않는다. 9개 불변식(측정 오염·점수·저장·운영 차단·candidate6.ts)은 하나도 건드리지 않는다.

수정은 두 단어, 둘 다 파일에 이미 있는 관행에 정렬: 703행 「제 화면」→「내 화면」(574·579 관행), 778행 「우리는」→「저희는」(519 관행). 범위 주의 — Candidate6CardSteps.test.tsx:208과 기획서 155·211·283행도 같이 고쳐야 코드·문서가 갈라지지 않는다.

### 10. [minor] 카드 고르기 화면이 「지나온 장면 전부에서 고를 수 있어요」라고 한 뒤 같은 화면 두 블록 아래에서 「4개 장면은 … 카드가 없어요」라고 스스로 부정한다.

- **위치**: `C:/Users/admin/Desktop/weddinghanbang_website/hanbang-web/apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:580`
- **근거**: Prototype.tsx:580 `"지나온 장면 전부에서 고를 수 있어요. 라벨은 후보를 바꾸지 않아요."`
Prototype.tsx:628-631 `{missingCount > 0 ? … {missingCount}개 장면은 문장을 아직 다듬는 중이라 카드가 없어요.`
실제 후보는 `deriveCardCandidates`가 리뷰 플래그 4개를 뺀 목록이다(candidate6SceneText.ts:268-272).
- **영향**: '전부'라는 단어가 거짓이라, 「앱이 내 답을 보고 골라준 게 아니다」를 증명하려던 문장이 오히려 '뭔가 걸러졌다'는 의심의 근거가 된다(기획서 위험 5가 막으려던 바로 그 오해). 「지나온 장면에서 고르는 거예요 — 답도 라벨도 후보를 바꾸지 않아요」처럼 '전부'만 빼면 해소된다.
- **반증 시도 결과**: 반증 실패 — 인용 정확하고 상시 도달 가능. Candidate6Prototype.tsx:580이 card-pick(giving=false)에서 "지나온 장면 전부에서 고를 수 있어요"를 렌더하고, :628-631의 고지문 블록은 giving 조건 밖에 있어 같은 화면에 함께 렌더된다. missingCount는 항상 4다: candidate6.ts:740-760 CORE_ORDER가 ES1·DS3·CP3·DS4를 무조건 포함하고 orderSupportPairs의 AS_FIRST 스왑은 ES1↔AS1 상호교환이라 집합이 불변, stakeholderApplicability는 SI1/SI2 추가 여부만 바꾼다. 따라서 모든 form·pair·해당성 조합에서 두 문장이 공존한다. 직전 회수 화면이 투여 19/21장면 전부를 행으로 보여주므로(Candidate6Recap.test.tsx:100-109) 후보 목록의 4행 감소는 사용자가 셀 수 있고, "전부"는 19장 중 15장이라 문자 그대로 거짓이다. 막는 가드도 없다 — Candidate6CardSteps.test.tsx:74-77이 이 문자열을 그대로 고정하고, :99-129는 같은 문장 후반부("라벨은 후보를 바꾸지 않아요")만 변이 검증으로 참임을 증명해, 전반부만 검증 없이 거짓으로 남아 이 브랜치 자신의 "화면의 주장은 참" 기준에 걸린다. 알려진 항목("플래그 4항목에 카드 없음, 의도적")과도 중복이 아니다(그 공백의 고지문과 '전부'의 충돌이 쟁점). 다만 지적의 영향 서술은 과장됐다: (1) "두 블록 아래"가 아니라 후보 15~17행(min-h-76px, 약 1,200px) 아래라 한 뷰포트에 함께 들어오지 않는다 (2) 고지 사유가 "문장을 아직 다듬는 중"이라 응답 무관 저작 사유이고, CardSteps 테스트 :79-80 주석이 이 문장이 바로 "내 답을 보고 걸렀다" 오해를 막기 위한 것임을 명시 — 고지문 삭제가 위험 5에 더 취약하다 (3) 이 프로토타입은 research/README.md:47대로 로컬 dev가 만드는 gitignore 라우트에서만 임포트되어 운영 표면 결함이 아니다 (4) 기획서 :115·:231·:261-262가 두 문장을 그대로 명세하므로 수정 시 Prototype.tsx:580 + 테스트 :76 + 기획서 §S5 세 곳을 같이 고쳐야 한다. 남는 실재 결함은 한 단어의 사실성이므로 minor.

### 11. [minor] 금지어 스캐너가 기획서 RED 9가 규정한 목록보다 좁다. 도메인 민감어 5개(가족·하객·업체·견적·계약)가 조용히 빠졌다.

- **위치**: `C:/Users/admin/Desktop/weddinghanbang_website/hanbang-web/apps/web/src/lib/weddingCode/research/__tests__/candidate6SceneText.test.ts:83`
- **근거**: 구현: candidate6SceneText.test.ts:83 `const banned = /점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급/;`
기획: 63번 문서:361 `… |등급|가족|하객|업체|견적|계약/ 불포함`
현재 상수는 다섯 단어를 실제로 쓰지 않으므로 목록을 복원해도 테스트는 통과한다.
- **영향**: DS3에 우리 문장을 얹지 않기로 한 이유가 「업체 서술을 우리 발화로 승격시키지 않기 위해서」(candidate6SceneText.ts:28-29)인데, 그 규칙을 지키게 강제할 검사가 지금은 없다. 리뷰 플래그 4항목의 rewrite 판정이 나서 카피를 새로 저작할 때 정확히 이 단어들이 들어올 자리다.
- **반증 시도 결과**: 반증 실패 — 지적이 사실이고 실재하는 fence 공백이다. (1) 인용 정확: candidate6SceneText.test.ts:83이 `/점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급/`로 그대로 있고, 기획서 361행 RED 9는 `…|등급|가족|하객|업체|견적|계약/`이다. 정확히 5개가 빠졌다. (2) 도달 가능: 84-92행 루프가 21항목의 sceneTitle·recapLines·card 3필드를 돌므로, 그 필드에 5개 단어가 들어와도 아무 검사가 막지 않는다. (3) 다른 guard 없음 — DOMAIN_NOUNS(28-32행)는 5개 단어를 전부 포함하지만 133-142행에서 CANDIDATE6_INTERLUDE_SENTENCES에만 적용되고 장면 엔트리는 건드리지 않는다. scripts/wedding-code-candidate6-security-qa.mjs·-visual-qa.mjs·wedding-code-research-safety.mjs에 금지어/점수/등급/업체/계약/견적/하객/가족 grep 결과 0건. `satisfies Record<…>`는 형태만 본다. (4) 의도적 결정이 아님 — §13-5 이탈 원장에는 시작 버튼 카피 1건만 기록돼 있고 이 건은 없다. 같은 테스트 파일 21-27행에는 RED 10을 도메인 명사 검사로 뒤집은 이유가 길게 주석으로 남아 있어, 저자가 의도적 이탈은 기록하는 습관이 있음을 보여준다. 게다가 저자 본인이 그 5개 단어를 DOMAIN_NOUNS에 넣어 도메인 민감어로 분류했으므로, 장면 스캐너에서의 누락은 판단이 아니라 실수로 읽힌다. (5) 반증 시도 실패 — RED 9 문구("전 문자열")를 파일 소스 스캔으로 읽으면 28행 JSDoc의 "업체" 때문에 실패하겠지만, 구현은 엔트리 필드만 스캔하고 그 필드엔 5단어가 없어(grep으로 확인) 복원해도 통과한다. 즉 좁힐 기술적 이유가 없다. candidate6.ts의 업체(243-244행)·계약(189행)은 instrument 원문이고 스캐너 대상이 아니다. (6) 영향은 잠재적 — 현재 잘못 나가는 문자열 0개이고, FLAGGED 테스트(46-57행)가 CP3·DS3·DS4·ES1의 card·recapLines를 null로 강제하므로 DS3 업체 서술의 우리 발화 승격은 지금은 불가능하다. 노출은 rewrite 판정으로 플래그가 풀려 카피를 새로 저작하는 시점에 열리며, 상시 fence의 존재 목적이 바로 그 시점이다. 연구 전용 파일이고 운영 표면은 차단 상태라 minor가 적정. "이미 알려진 것" 4항목 어디에도 포함되지 않는다.

### 12. [minor] 회수 화면 이후 전 구간(recap → card-pick → card-give)에 뒤로 가는 경로가 하나도 없다. 카드를 잘못 확정하면 되돌릴 방법이 19~21개 답을 전부 날리는 전면 재시작뿐이다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:634`
- **근거**: recap의 버튼은 「오늘 꺼낼 한 마디 고르기」 하나뿐이고(541-551행), card-pick/card-give의 버튼 행은 `giving`일 때만 「이번엔 안 고를게요」가 추가되는 확정 버튼 1~2개다(634-668행). questions step에는 `previousQuestion` 버튼이 있는데(471-474행) 이후 화면에는 대응물이 없다. 확정은 즉시 비가역이다: `setMyCardId(draftCardId); setDraftCardId(null); moveToStep("card-give")`(659-661행) 뒤 myCardId를 다시 쓸 수 있는 핸들러가 없고, 유일한 후퇴는 `restart()`(218-231행)로 responses·sceneLabels·myCardId를 전부 비운다. 프로브로 확인: recap·card-pick·card-give 세 화면 모두 /이전|뒤로|돌아가/에 매칭되는 버튼이 0개이고, card-face에서만 「처음부터 다시 보기」가 나타난다 — PASS.
- **영향**: 이 경험의 명시 약속은 "앱이 고르지 않고 사용자가 고른다"(화면 카피 「지나온 장면 전부에서 고를 수 있어요」)인데, 정작 그 선택만 유일하게 취소 불가다. 15~17개 후보를 스크롤하다 오탭 한 번이면 카드가 확정되고, 원상복구하려면 방금 20분 걸려 답한 19~21장면을 다시 답해야 한다. R1 인지면접에서 이 지점의 이탈은 "재미 없음"이 아니라 도구 결함으로 기록될 것이고, 재미 가설(§5)의 측정을 오염시킨다.
- **반증 시도 결과**: 구조 주장은 코드 참이라 반증 실패했으나, 하중을 지는 실패 시나리오는 거짓이므로 심각도를 minor로 정정한다.

[참으로 확인된 것] Candidate6Prototype.tsx 프로브 전수조사(form=A, applicable, journey 21, 후보 17): card-pick 비후보 버튼 = ["이 카드로 정하기"], card-give = ["이번엔 안 고를게요","이 카드로 정하기"], card-face = ["한 마디 건네기","처음부터 다시 보기"]. recap(507-555)도 라벨 pill 외 버튼 1개. setMyCardId 호출부는 659행과 restart()(223행) 둘뿐이고, restart는 responses·stakeholderApplicability까지 비워 시작 버튼이 다시 disabled가 된다(프로브 확인). 확정 후 myCardId를 되돌리는 경로가 실제로 없다.

[반증된 것] ①"오탭 한 번이면 카드가 확정"은 거짓이다. 후보 행 클릭은 setDraftCardId만 하고(602행) 확정은 별개 버튼 disabled={!draftCardId}(650행)다. card-pick 안 오탭은 다른 행을 누르면 복구된다(프로브: 3번째→0번째 aria-pressed 이전). disabled 게이트는 Candidate6CardSteps.test.tsx:91-93이 이미 고정. 실제 트리거는 '의도적 확정 후 변심'이라는 훨씬 드문 경로다. ②"그 선택만 유일하게 취소 불가"도 거짓(givenCardId·shownInterludes 동일). ③recap을 묶은 것은 범위 과장 — recap 복귀로 가능한 건 재라벨링뿐이고 라벨이 후보·본문·버튼을 안 바꾼다는 건 같은 파일 99-129행 테스트로 증명돼 있어 기능 가치 0. 하중 있는 구멍은 card-pick 확정 → card-give 단 한 전이다.

[심각도 하향 근거] docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md §3의 S4/S5/S6 사양과 §7 카피 덱 버튼 목록에 뒤로 버튼이 없고 되돌리기는 S7 「처음부터 다시 보기」로만 명시됐다 — 구현이 그 인벤토리와 정확히 일치하므로 로직 결함이 아니라 기획이 택한 범위다. S5/S6에 3번째 버튼을 넣으면 Candidate6CardSteps.test.tsx:151-160이 고정한 '건너뛰기·확정 동일 크기' 불변식을 재설계해야 한다. 저장·수집이 0이라 연구 데이터 손실 없고 참가자 시간만 든다. 막힘·오데이터·죽은 화면 없음(card-face·restart 항상 도달). §13-4가 회수·카드·초대 화면을 미측정 표면으로 이미 선언했고, R1에서 '카드를 바꾸고 싶었는데 못 했다'는 관찰은 측정 오염이 아니라 정상 산출이다.

### 13. [minor] 새로 추가된 목차 시트가 모달처럼 화면을 덮으면서 dialog 시맨틱·포커스 이동·Escape 닫기·dim 배경이 전부 없고, DOM 순서상 문항 폼 전체 뒤에 있다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:1165`
- **근거**: ContentsSheet 루트는 `<div className="fixed inset-x-0 bottom-0 z-20 ...">`(1165행)뿐이다 — `role="dialog"`/`aria-modal`/`aria-labelledby` 없음, 열릴 때 포커스를 옮기는 코드 없음(포커스 이동은 `moveToStep`에만 걸려 있고 1165행 경로는 `moveToStep`을 타지 않는다), Escape 핸들러 없음, 배경 `inert`/`aria-hidden` 없음, 닫을 때 트리거 버튼으로 포커스를 되돌리지 않는다. 배경 dim도 없다 — 기획서 §3 S1b 사양은 "dim bg-[#243832]/20 fade 220ms"를 명시한다. 트리거 버튼은 `<header>` 안(388-394행)이고 시트는 `<section>` 뒤(494-501행)라, 여는 순간 키보드 사용자는 5답 라디오 5개 + escape details + escape 라디오 4개 + 이전/다음 버튼을 전부 지나야 시트에 닿는다.
- **영향**: 이 시트는 기획서 §6-7이 "중도이탈자에게 회수 전 만회 기회를 준다"고 못박은, recognition 각도의 최대 약점을 메우는 장치다. 키보드·스크린리더 사용자에게는 그 만회 기회가 사실상 닫혀 있다. §13-4가 스크린리더 검증을 "아직 측정하지 못한 것"으로 남겨둔 상태라 R1-UX 전에 코드로 잡을 수 있는 유일한 시점이다.
- **반증 시도 결과**: 반증 실패 — 핵심은 실재한다. 다만 근거 두 곳이 틀렸다.

**직접 확인해 참인 것**
- `Candidate6Prototype.tsx:1165` 루트는 인용 그대로 `<div className="fixed inset-x-0 bottom-0 z-20 rounded-t-[20px] ...">` 단독. `role`/`aria-modal`/`aria-labelledby` 0개.
- 트리거(388-394행)는 `type`/`onClick`/`className`뿐 — `aria-expanded`·`aria-controls`도 없다(지적이 놓친, 더 무거운 결함).
- `grep -rn "keydown|onKeyDown|KeyboardEvent" research/` → 0 hit. Escape 핸들러 부재 확정.
- `setContentsOpen(true)`(390행)는 `moveToStep`(161-164행)을 타지 않으므로 `focusRevision`이 증가하지 않는다 → 149-152행 포커스 effect 미발동. 지적대로다.
- DOM 순서: 시트(494-501행)가 `<section>`(403-492행) **뒤**. 참.
- dim 없음. 기획서 §3 S1b **81행**이 `dim bg-[#243832]/20 fade 220ms`를 명시하므로 자기 사양 위반이다(§13-5의 의도적 이탈 1건은 시작 버튼 카피뿐 — dim 누락은 미기록). 220ms translateY·40ms stagger도 함께 빠져 있다.

**실측 재현**(임시 probe로 tab 순서·포커스 계측, 실행 후 삭제): `focus AFTER open = BUTTON:지나온 장면`(이동 없음) / `Escape 후 시트 열림 = true` / **`focus AFTER close = BODY`**(닫기 시 포커스가 document 루트로 유실 — WCAG 2.4.3) / `scrim candidates = 0`.

**근거 오류 1 — tab stop 수**: "5답 라디오 5개 + escape 라디오 4개 + 이전/다음 전부"는 거짓이다. 900·934·979행이 모두 `name={`candidate6-${itemId}`}`로 **동일 라디오 그룹**이라 Tab stop은 그룹당 1회이고, escape 라디오는 닫힌 `<details>`(959행) 안이라 포커스 불가다. 실측 결과 트리거→첫 시트 컨트롤 사이 stop은 `radio-group(members=5)` / `summary` / `이전` = **3개**(`다음`은 disabled). 약 11개가 아니다. 따라서 whyItMatters의 "사실상 닫혀 있다"는 키보드 사용자에게 과장이다 — 3 Tab이면 닿는다.

**근거 오류 2 — 성격 오분류**: dim도 inert도 없으니 이것은 모달이 아니라 **비모달 bottom sheet**다. 비모달에는 `role="dialog"`·`aria-modal`·focus trap이 규범적 요구가 아니다. 실제 결함은 ①disclosure 패턴인데 공개 콘텐츠가 트리거에 인접하지 않음 ②트리거에 `aria-expanded` 없어 SR 사용자에게 상태 변화가 **전혀 통보되지 않음**(WCAG 4.1.2) ③닫을 때 포커스 유실. 추가로 불투명 z-20 시트가 `이전`/`다음`을 덮는데 둘은 계속 tabbable → WCAG 2.2 SC 2.4.11(Focus Not Obscured) 위반 소지.

**중복 아님**: §13-4는 스크린리더 *측정*을 미룬 것이고, 시트 시맨틱·dim 누락을 알려진 결함으로 기록한 곳은 없다. 테스트도 막지 않는다 — `Candidate6Recap.test.tsx:194-237`은 텍스트·행 id·`data-recap-body` 공백만 검사하고 접근성 속성은 검사하지 않는다.

**severity minor 유지 타당**: 이 프로토타입은 `localPreviewPage.tsx`에서만 마운트되고 `app/wedding-code/**`에서 도달 불가(운영 차단 유지). 실제 사용자 피해는 R1-UX 세션에 국한된다. 고칠 것은 4줄 수준: 트리거에 `aria-expanded`+`aria-controls`, 시트에 `id`+`aria-labelledby`, 열 때 시트 제목으로 포커스 이동·닫을 때 트리거 복귀, Escape 핸들러. dim은 별개 사양 이탈로 따로 처리.

### 14. [major] §13-2 접힘선 표가 하단 고정 바(96px)와 safe-area 여백을 빼지 않고 뷰포트 전체 높이를 접힘선으로 썼다. 문서 자신의 숫자로 재계산하면 320은 36px가 아니라 ~148px 초과이고, 360×640은 ✓가 아니라 ✗다. §13-3 판정 전체가 이 잘못된 기준 위에 서 있다.

- **위치**: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:452-472`
- **근거**: 문서 표: `| 320×568 | 604px | 568px | ✗ 36px 초과 |` `| 360×640 | 582px | 640px | ✓ |`. 바로 아래 줄이 스스로 레이아웃을 적는다: `바깥: 헤더 44px · 하단 고정 바 96px · safe-area 상단 여백 포함 스크롤 영역 상단 77px.`  코드는 실제로 그 구조다 — 측정 시점 커밋 a0929d60의 Candidate6Prototype.tsx:798 `viewportLocked ? "flex h-dvh overflow-hidden"`, :398 `min-h-0 flex-1 overflow-y-auto overscroll-contain`, :448 `<div className="shrink-0 border-t ...">`(다음/이전 버튼 바). 즉 스크롤 영역이 잘리는 지점은 뷰포트 하단이 아니라 `뷰포트높이 − 하단바 96 − main padding-bottom max(1rem)=16`이다.  320×568 → 보이는 하단 456px, grid 하단 604px → 148px 초과(표의 36px의 4배).  360×640 → 보이는 하단 528px, grid 하단 582px → 54px 초과이므로 ✗여야 한다.  375×667 → 555px vs 541px로 14px 여유만 남는다(표는 126px 여유처럼 보인다).
- **영향**: §13-3이 「360·375에서는 가설2가 성립한다」를 근거로 320을 안 쫓기로 판정했고, 「밴드 교체는 10~16px만 벌어 36px 갭을 못 메운다」로 음각 홈·premise 밴드 교체를 보류했다. 두 근거가 모두 무너진다 — 보정하면 R1 대상 기기 대역(360)에서도 「다섯 답 동시 비교」(§5 가설2)가 깨지고, 375도 14px 여유뿐이라 폰트 확대·안드로이드 시스템 바에서 즉시 무너진다. 사람 검증을 이 상태로 시작하면 가설2 실패를 UI 결함이 아니라 문항 문제로 오독하게 된다.
- **반증 시도 결과**: 반증 실패. 네 갈래로 깨보려 했지만 전부 지적 쪽으로 닫혔다.

(1) 인용 코드 실재 확인 — `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx`. `viewportLocked` 호출부는 전 파일에 단 하나이고 그게 바로 문항 화면이다(HEAD:365, 측정 커밋 a0929d60:350 `<PrototypeShell viewportLocked showFooter={false}>`). 셸은 `viewportLocked ? "flex h-dvh overflow-hidden"`(HEAD:813)이고 인라인 스타일에 `paddingBottom: "max(1rem, env(safe-area-inset-bottom))"`. 스크롤 영역은 `min-h-0 flex-1 overflow-y-auto overscroll-contain`(HEAD:413), 이전/다음 바는 그 **형제** `<div className="shrink-0 border-t border-[#EFE4D7] bg-white px-4 pb-3 pt-2 ...">`(HEAD:463) — `position: fixed`가 아니라 flex 형제다. 즉 바가 스크롤러 높이를 이미 깎아먹고, 스크롤러 클립 아래 내용은 화면에 없다.

(2) 도달 가능성 — "h-dvh 클래스가 없어서 실제로는 문서 스크롤이었다"가 유일한 진짜 반증 경로였는데 닫혔다. `apps/web/node_modules/tailwindcss` = **4.2.2**, `h-dvh` 지원. h-dvh→flex-1/min-h-0 사슬이 전부 확정 높이라 스크롤러가 실제로 클립한다.

(3) 다른 곳이 막고 있나 — 오히려 **레포가 문서를 반박한다**. `scripts/wedding-code-candidate6-visual-qa.mjs:51-60` `assertQuestionViewportLocked`가 `documentHeight <= viewportHeight + 1`을 단정하며 "question document must not have a second vertical scroller"라고 쓴다. 문서 스크롤이 없다는 것을 레포가 스스로 못 박았으니, `window.innerHeight`는 정의상 접힘선이 될 수 없다 — 그 아래로 페이지를 굴려서 도달할 수 있는 것이 없다. jsdom 테스트에는 기하 단정이 0개라 아무것도 안 잡는다.

(4) 결정적 교차검증 — 문서 자신의 "스크롤 영역 상단 77px"를 내가 코드로 독립 재현했다: 16(main `max(1rem, safe-top)`) + 44(헤더) + 16(`mb-4`) + 1(section border) = **77**. 같은 회계를 하단에 적용하면 보이는 하단 = 뷰포트 − 16(padding-bottom) − 96(바) − 1(border) = **뷰포트 − 113**. 문서는 뷰포트 전체를 썼다. 재계산: 320×568 → 455 vs 604 = **~149px 초과**(문서 36px, 4배); 360×640 → 527 vs 582 = **~55px 초과이므로 ✓가 아니라 ✗**; 375×667 → 554 vs 541 = **여유 13px**뿐; 375×812만 넉넉하다. 지적의 네 수치가 ±1px로 재현된다. (문서 표 604는 scrollTop=0 뷰포트 좌표와 내부 정합: 77+595=672 블록합, grid는 fieldset 안 EscapeChoices 위라 그만큼 위.)

(5) 중복 아님 — "이미 알려진 것"의 320 항목은 36px를 **사실로 받아들이고** 판정 완료로 처리한다. 새로운 사실은 크기가 4배라는 것과 360행의 ✓가 거짓이라는 것, 375 여유가 126px이 아니라 13px이라는 것이다.

(6) 영향 실재성 — 코드 결함은 아니고 운영 표면도 없다(연구 프로토타입, 빌드 fence). 무너지는 것은 §13-3의 **근거**다: 1번("360·375에서는 가설2가 성립한다")은 360에서 거짓. 단 2번의 결론은 살아남는다 — 갭이 36px이 아니라 149px이니 "밴드 교체 10~16px로는 못 메운다"는 오히려 강해진다. 그래서 취한 **행동**(320 보류·밴드 교체 보류)은 유지될 수 있지만 기록된 근거는 유지되지 않고, §13-4 "아직 측정하지 못한 것"도 이를 밝히지 않는다. 사람 게이트(R1-UX 실기기)가 결국 잡아줄 여지는 있으나, 그 판정 때 쓰라고 지정된 "이 표"가 틀린 상태다.

### 15. [minor] §9 변경 파일에 명시된 「safe-area 인라인 style → Tailwind 임의값」이 구현되지 않았고, §8 「인라인 style 0」도 지켜지지 않았다. 문서에 기록도 없다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:815-820`
- **근거**: 코드: `style={{ paddingTop: "max(1rem, env(safe-area-inset-top))", paddingRight: ..., paddingBottom: ..., paddingLeft: ... }}`.  기획서 §8:308 `**인라인 style 0** — ... safe-area는 pt-[max(1rem,env(safe-area-inset-top))] ... Tailwind 임의값으로 교체.`  §9:329 변경 파일 항목에도 `safe-area 인라인 style → Tailwind 임의값`이 명시돼 있다.  §13-5 「기획 대비 구현 갭」은 intro 2건만 적고 이 항목을 언급하지 않는다.  테스트는 `expect(container.querySelector("[style*='width']")).toBeNull()`(Candidate6Rhythm.test.tsx:77)만 보므로 padding 인라인 style은 통과한다.
- **영향**: CLAUDE.md 코딩 컨벤션이 「스타일은 Tailwind만(인라인 style 금지)」이라 저장소 규칙 위반이 남는다. 더 중요한 건 §8이 이 항목을 「진행률 바 삭제로 인라인 style이 0이 된다」는 완결 주장으로 썼다는 점 — 실제로는 0이 아니므로 그 주장을 근거로 삼는 후속 검사(운영 번들 정적 검사 등)가 헛돈다.
- **반증 시도 결과**: 지적의 사실 주장은 전부 확인됨 — Candidate6Prototype.tsx:815-820에 인용된 safe-area 인라인 style이 실재하고(연구 디렉터리 전체에서 유일한 style= 출현), 기획서 §8:308이 Tailwind 임의값 교체를, §9:329가 변경 파일 항목으로 명시하며, §13-5는 intro 2건 + 의도적 카피 이탈 1건만 적고 이 항목을 누락한다. Candidate6Rhythm.test.tsx:77도 [style*='width']만 본다. 갭의 존재는 반증 불가.

그러나 whyItMatters의 두 근거는 코드로 반증된다. (1) `git show 97d298c5~1:...Candidate6Prototype.tsx`의 478행에 동일 블록이 바이트 단위로 이미 존재 — 브랜치는 진행률 바 style={{width}}만 지웠고(2→1) 이 블록은 손대지 않았다. 선재 코드이므로 회귀 0. (2) 저장소 규칙 위반 근거는 공허하다: apps/web/eslint.config.mjs는 nextVitals+nextTs뿐이고 react/forbid-dom-props 같은 규칙이 없으며, apps/web/src의 51개 파일이 이미 style={{를 쓴다. 한 줄을 안 고친 것이 새 위반을 만들지 않는다. (3) 「운영 번들 정적 검사가 헛돈다」는 실제 가드가 반증한다: scripts/check-wedding-code-production-artifact.mjs는 .next/static·.next/server를 훑어 연구 체인 마커(wedding-code-candidate6-research·C6-DS1·C6-ES1)가 조금이라도 있으면 빌드를 실패시킨다. Candidate6Prototype은 localPreviewPage.tsx만 import하고 그건 생성형 로컬 dev 라우트로만 도달하며, 그 라우트가 남아 있으면 production build 자체가 막힌다(§13-1b). 즉 이 줄을 담은 운영 번들이 존재할 수 없어 지목된 후속 검사 시나리오는 발생 불가. (4) §8은 「시각 사양」 절 = 구현 전 명세이고 문서의 검증 기록은 §13이다. §8:308을 「완결 주장」으로 읽은 것은 문서 구조 오독. (5) 처방 자체가 무해한 no-op도 아니다: shell className이 px-2 py-4 sm:px-4 sm:py-10인데 인라인 style이 전 폭에서 이를 덮고 있다. Tailwind v4(^4)에서 pt-[max(1rem,env(...))]로 바꾸면 단일 클래스 동등 특이성이라 ≥640px에서 sm:px-4 sm:py-10이 이겨 데스크톱 패딩이 16/8px→40/16px로 변한다. §8은 sm: 클래스 제거를 말하지 않으므로 문자 그대로 적용하면 렌더가 바뀐다.

부수 확인: globals.css에 .c6-stagger-1~6도 없고(stagger 미구현이라 무의미), §9 신규 파일 4개(Candidate6Interlude/ContentsSheet/Recap/CardSteps.tsx)도 전부 없이 Candidate6Prototype.tsx 한 파일에 구현됐다. 기획 대비 이탈은 지적보다 넓지만, 이 항목의 잔여 영향은 §13-5에 한 줄 기록하지 않은 문서 위생뿐이다. 따라서 major가 아니라 minor.

### 16. [minor] §8이 「신규 카피는 DESIGN.md 스케일 값만 사용한다: 12/14/16/18/20/24/30」·「rounded-[24px]·rounded-[18px]는 20/16으로 정렬한다」고 못 박았는데, 신규 화면(S4 회수·S5·S6·S7·S9·S1b 시트)이 전부 스케일 밖 값을 쓴다. §9가 요구한 DESIGN.md Decisions Log 2행도 등재되지 않았다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:103,514,518,571,577,629,685,689,702,777,1167`
- **근거**: DESIGN.md:24 `Scale: xs 12, sm 14, base 16, lg 18, xl 20, 2xl 24, 3xl 30, 4xl 36, 5xl 48`, :53 `Border radius: sm 6, md 8, lg 12, xl 16, 2xl 20, 3xl 28, full 9999`.  신규 화면 실제 값: recap h1 `text-[28px]`(:514), recap 본문 `text-[15px]`(:518), card-pick 안내 `text-[15px]`(:577), 플래그 고지 `text-[13px]`(:629), invite `text-[15px]`(:689)/`text-[13px]`(:702), 카드 밖 `text-[13px]`(:777), 시트 안내 `text-[13px]`(:1167), h1 `sm:text-[28px]`(:571,:685). 13·15·28은 스케일에 없다.  surface 상수(:103) `rounded-[24px]`가 recap·card-pick·card-face·invite 전부에 그대로 쓰인다 — 기획 §8:302는 surface 20, 5:8 카드 face 28을 요구.  intro 카드 미리보기 `rounded-[18px]`(:354), IntroChoice `rounded-[14px]`(:858)도 남아 있다.  `git log -3 -- DESIGN.md` → 최신 커밋 40cb3ea9(2026-07-02). §9:333이 요구한 2행(연구 프로토타입 화법 예외 / 문항 화면 off-scale 13·15·17 잠정 유지)이 전혀 없다.
- **영향**: §8의 예외 허용은 「현행 문항 화면에 이미 박혀 있는 13/15/17px」로 명시적으로 한정돼 있고 신규 화면은 예외 대상이 아니다. DESIGN.md가 시각 권위인데 그 권위를 벗어난 값이 신규 화면에 새로 심겼고, 예외를 등재하라는 지시도 이행되지 않아 다음 사람이 「이게 승인된 예외인가 드리프트인가」를 판별할 근거가 없다.
- **반증 시도 결과**: 부분 반증. 사실로 남는 것: DESIGN.md는 이 브랜치에서 한 줄도 안 바뀌었고(`git diff --name-only f5143075..211b9e49`에 없음, 최신 커밋 40cb3ea9 / 2026-07-02), 신규 화면 카피가 스케일 밖 13/15/28을 쓴다(:514 `text-[28px]`, :518·:577·:689 `text-[15px]`, :629·:702·:777·:1167 `text-[13px]`). §9의 in-scope 항목 "radius 24/18 → 20/16"도 절반만 됐고, §8:302가 요구한 5:8 카드 face radius 28은 미적용 — :734가 `${surface} … aspect-[5/8]`로 radius 24를 그대로 쓴다. §13-5는 intro 갭과 시작 버튼 카피 이탈만 기록하고 이 건은 기록이 없다.  반증되는 것 4가지: (1) 「신규 화면에 새로 심겼다」는 radius 쪽에서 사실과 반대다. base→head 카운트가 `rounded-[24px]` 1→1(base:60의 surface 상수 그대로, 신규 심음 0), `rounded-[18px]` 2→1, `rounded-[14px]` 3→3, `text-[28px]` 4→4, `text-[17px]` 2→1, 온-스케일 `rounded-[20px]` 0→2 — 인용된 :103·:354·:858은 전부 브랜치가 작성하지 않은 기존 줄이고, 브랜치는 스케일 쪽으로 이동했다. 파일 전체 순증 off-scale은 +4개뿐. (2) 도달 불가. `Candidate6Prototype`을 import하는 건 `localPreviewPage.tsx`와 테스트 5개뿐이고, `apps/web/src/app/` 어디도 localPreviewPage를 import하지 않는다(app/wedding-code에는 page.tsx·WeddingCodeClient·result만). 게다가 localPreviewPage:21-30이 NODE_ENV≠development ∥ WEDDING_CODE_RESEARCH_PREVIEW≠true → notFound, 이어서 host∉{localhost,127.0.0.1,[::1]} → notFound로 3중 차단. 어떤 환경에서도 사용자가 이 픽셀을 볼 수 없다. (3) DESIGN.md 스케일은 이 레포에서 강제되는 권위가 아니다. research 폴더 밖 apps/web/src/**/*.tsx에 `text-[13px]` 336개, `text-[15px]` 87개, `text-[22px]` 42개, `text-[17px]` 29개, `text-[28px]` 13개, `rounded-[14px]` 49개, `rounded-[18px]` 46개, `rounded-[24px]` 10개 — lint 규칙·테스트·토큰 게이트 0. 「다음 사람이 승인된 예외인지 드리프트인지 판별 못 한다」는 운영 코드베이스 전체의 기존 상태이고, 도달 불가 파일의 +4개가 이를 유의미하게 악화시키지 않는다. (4) Decisions Log 2행 중 1행은 기획서 스스로 보류시킨 것이다. §12-1이 "이 결정이 DESIGN.md Decisions Log 등재와 테스트 문자열 갱신 범위를 정한다"고 명시했고 §9의 (1)행이 바로 그 「연구 프로토타입 화면 이름/화법 예외」다 — 파운더 결정 전에 쓰면 아무도 안 한 결정을 기록하는 것이라 withholding이 기획 준수다. 따라서 실제 미이행은 게이트 없는 (2)행 한 줄 + 신규 카피 6개소 off-scale + card face radius 28 미적용이며, 런타임·사용자·테스트 영향 0의 문서 위생 누락이다.

### 17. [minor] 재미 메커니즘 §6-2 「press 방향 반전」이 측정 화면(다섯 답·escape 4택·주/보조 버튼)에 적용되지 않았고, 다섯 답은 오히려 반대 방향(눌리는 방향)으로 움직인다. §13-3의 보류 목록에도 없어 미기록 갭이다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:1009,1054,105,107`
- **근거**: 기획 §6-2:218 `press 방향 반전 — 손가락이 카드를 집는 방향으로 뜬다. active:-translate-y-[4px] active:scale-[1.015] + 그림자 확장, duration-150 ease-out. 다섯 답·escape 4택·라벨 2종·모든 버튼에 완전히 동일하게 적용해 특정 응답 차등을 0으로 유지한다.` (§3 S0 사양:61도 `press는 전 화면 동일`).  구현: ScaleChoice(다섯 답) `transition duration-150 active:scale-[0.98]`(:1009) — 축소, 즉 반대 방향. ChoiceRow(escape 4택) `active:scale-[0.99]`(:1054) — 역시 축소. primaryButton(:105)·secondaryButton(:107)에는 `active:` 변형이 아예 없다.  반전이 실제로 들어간 곳은 sceneLabelBase(:64-67)와 카드 후보 행(:603) 둘뿐이다.  §13-3:483은 보류 항목을 `음각 홈·premise 밴드 교체`로만 적어 press는 언급하지 않는다.
- **영향**: press 반전은 §6이 꼽은 16개 재미 메커니즘 중 2번이고, 세로 높이를 1px도 바꾸지 않으므로 §13-3의 접힘선 보류 사유에 해당하지 않는다. 결과적으로 같은 화면 안에서 라벨 pill은 위로 뜨고 다섯 답은 아래로 눌리는 상반된 촉감이 공존해 「전 화면 동일한 press」라는 비보상 논거 자체가 화면에서 거짓이 됐다. R1에서 촉감 항목을 물어봐도 무엇을 측정한 건지 알 수 없다.
- **반증 시도 결과**: 사실 핵심은 반증 못 했다. 인용 코드가 정확하다: `grep -n "active:"` 전체 결과가 딱 4개 — sceneLabelBase:64-67과 카드 후보 행:603만 `active:-translate-y-[4px] active:scale-[1.015]`이고, ScaleChoice(다섯 답):1009는 `active:scale-[0.98]`, ChoiceRow(escape 4택):1054는 `active:scale-[0.99]`로 반대 방향이며, primaryButton:105·secondaryButton:107·목차 시트 열기 버튼:388에는 `active:` 변형이 없다. 기획 §6-2:218은 "다섯 답·escape 4택·라벨 2종·모든 버튼에 완전히 동일하게" 적용을 요구하고 §3:61은 "press는 전 화면 동일"이라 못 박는다. 문서 기록도 없다 — §13-3:483은 보류를 「음각 홈·premise 밴드 교체」로만 적고, §13-5는 S0 결함 2건만 적으며, §11:329는 press를 세 항목과 묶어 변경 목록에 올려놨으므로 둘만 이름 지어 보류한 것은 press가 완료됐다는 뜻으로 읽힌다. 테스트 가드도 없다(`__tests__/` 전체에 active:scale|active:-translate|press 히트 0). "이미 알려진 것" 어느 항목에도 포함되지 않고 접힘선 보류 사유(세로 높이)와도 무관하다. 다만 whyItMatters는 상당 부분 틀렸다. (1) 비보상 논거는 무너지지 않았다 — §6-2 자신이 명시한 목적은 "특정 응답 차등을 0으로 유지"이고, 다섯 답 5개가 한 문자열, escape 4개가 한 문자열, pill 2개가 한 문자열을 공유하므로 어떤 응답도 촉감으로 우대받지 않는다. 실제 강제 장치인 RED 4(Candidate6Recap.test.tsx:149, 색 토큰 제외 className 완전 일치)도 통과한다. (2) "같은 화면 안에 공존"은 사실이 아니다 — 라벨은 문항 화면에 없고(기획:188, 코드상 SceneLabelPills는 RecapRow와 ContentsSheet에만), 겹치는 경우는 헤더에서 여는 `fixed bottom-0` 목차 시트가 문항을 부분 덮는 예외 상태뿐이다. (3) R1에 촉감 항목이 아예 없다 — §12:367의 probe는 막간·S0·라벨 3개이고 R1-UX는 접힘선·리듬 라벨·pill role이다. 추가로 지적이 놓친 두 가지: shrink 클래스는 97d298c5~1(:672,:717)에 동일 문자열로 이미 있었으므로 이 브랜치가 회귀시킨 게 아니고, 반대로 새로 넣은 lift 쪽은 `transition-colors`를 써서 transform이 전환되지 않아 specced한 duration-150 ease-out 없이 즉시 튄다. 결론: 기획 대비 구현 갭이자 미기록 갭으로 실재하지만, 측정 의미·저장 데이터·접근성·비보상 불변식에 영향 0이고, 운영 차단된 연구 프로토타입의 촉감 일관성·문서 충실도 문제다.

### 18. [minor] §13-5의 「의도적으로 따르지 않은 카피 1건」이 사실이 아니다. §7 카피 덱(「그대로 쓸 문장」)을 따르지 않은 항목이 최소 8건이고, 시작 버튼 외에는 어디에도 기록되지 않았다.

- **위치**: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:518-521`
- **근거**: 문서 §13-5:518 `**의도적으로 따르지 않은 카피 1건**: §7 카피 덱은 시작 버튼을 「첫 장면 보기」로 바꾸라고 했지만 「장면 시작하기」를 유지했다.`  실제 미준수 목록: ①§7:246 `[목차 시트 하단] 여기서 라벨을 새로 붙이거나 지울 수 있어요.` → ContentsSheet(:1164-1191)에 없음 ②§7:286 `[다시 하기] 처음부터 다시 보기 — 라벨과 답이 전부 사라져요. 새로고침도 같아요.` → 버튼 텍스트가 「처음부터 다시 보기」뿐(:794) ③§7:262 `네 장면은…` → `{missingCount}개 장면은…`(:630) ④§7:243 `[진행 sr-only] 전체 열아홉 장 중 네 번째 장면` → `전체 {journey.length}장 중 {questionIndex+1}번째 장면`(:398) ⑤§7:241 신뢰 3점 3번째 `점수·유형·궁합이 없어요` → 제목 「결과를 단정하지 않아요」(:345) ⑥§7:256-259 Tier B 예 4건 전부 제목·문장이 다름(예: `C6-OA2 「정리는 한 사람이 맡았다」` → sceneTitle `정리를 맡았다`) ⑦§7:266-270 카드 예 5건 전부 문장이 다름 ⑧§3 S7:137 버튼 3종(「이 한 줄만 복사」/「휴대폰 넘겨주기」/「처음부터 다시 보기」) → 구현은 「한 마디 건네기」+「처음부터 다시 보기」 2종(:789,:794).
- **영향**: 기획서가 스스로 「미준수는 1건뿐」이라고 완결 선언한 상태라, 다음 사람은 §7 카피 덱을 현재 화면의 정본으로 신뢰하게 된다. 실제로는 덱과 화면이 8곳에서 갈려 있어 카피 리뷰·R1 스크립트·QA 스크린샷 대조가 전부 어긋난다. 특히 ⑥⑦은 저작 규칙(15자·30자) 때문에 바꿀 수밖에 없었던 것으로 보이는데(아래 별도 항목), 그 사유가 어디에도 없다.
- **반증 시도 결과**: 반증 실패. 핵심 주장(§13-5:518의 「의도적으로 따르지 않은 카피 1건」이 사실이 아니다)은 살아남는다. 다만 열거된 8건 중 2건은 반증되고 1건은 기지(known) 항목과 중복이며, 3건은 기획서 자기 규칙 때문에 구현 불가였던 것이라 severity는 minor로 내린다.

확인된 것(직접 파일 열어 대조):
- ① 확인. `§7:246 여기서 라벨을 새로 붙이거나 지울 수 있어요.` → `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx` ContentsSheet(1152~1193)에 없고, `grep -rn "붙이거나 지|라벨을 새로" apps/web/src/` 결과 0건. 저장소 어디에도 없다. 단 §3 S1b:77의 「본다」 열거 목록에도 이 문장이 없어 §3/§7 충돌이며, 라벨 pill 기능 자체는 SceneLabelPills로 구현돼 있다(기능 손실 0).
- ② 확인. `§7:286 처음부터 다시 보기 — 라벨과 답이 전부 사라져요. 새로고침도 같아요.` → 버튼은 `:793-796`에 「처음부터 다시 보기」만. 뒤 설명절은 src 전체에 0건. 다만 인접 카피가 실질을 덮는다(`:343` TrustPoint body 「새로고침하면 답이 사라져요.」, `:778` 「우리는 이 카드를 보관하지 않았어요. 새로고침하면 사라져요.」).
- ③ 확인(문자 차이만). `:630 {missingCount}개 장면은…` vs 덱 「네 장면은…」. CORE_ORDER(candidate6.ts:740-760, 19항목)가 플래그 4개(ES1·DS3·CP3·DS4)를 항상 포함하므로 missingCount는 항상 4 → 렌더 결과는 「4개 장면은」. 수치 정확성 차이 없음, 표기만 다르다.
- ⑥ 부분 확인. 4건 전부 sceneTitle이 다르다. 그러나 「문장도 전부 다르다」는 과장 — C6-CP2 recapLines는 덱과 완전히 동일(`candidate6SceneText.ts:145-146` 준비는 끝났다./확정만 안 눌렀다./아직 고칠 수 있다.). 그리고 덱의 OA2 제목 「정리는 한 사람이 맡았다」는 13자로 기획서 자기 상한(§4:172·§8:311 제목 12자)을 넘겨, 기획서가 §10 RED 11로 지시한 정적 검사(`__tests__/candidate6SceneText.test.ts:70` sceneTitle ≤12)에서 실패한다. 즉 덱대로 못 쓴다.
- ⑦ 확인. prompt 5/5 다르고 ES2·SI2는 when·action까지 다르다. 덱의 「SI2 예」는 실제로 구현 SI1(`:206-214`)에 대응한다. 하지만 JI3(31자)·ES2(38자)·SI2(32자)는 §4:178의 30자 상한 위반이라 test:76에서 실패하고, OA1 덱 prompt는 두 문장이라 「한 문장」 규칙 위반이다. 순전히 재량으로 바꾼 건 CP2(「오 분만」 삭제) 1건뿐이다.

반증된 것:
- ④ 반증. 정본 스펙 §3 S1:71이 명시적으로 `sr-only 「전체 19장 중 4번째 장면」(journey.length 실측값)`을 지시한다. 구현 `:398 전체 {journey.length}장 중 {questionIndex+1}번째 장면`은 §3을 그대로 따른 것이다. 「열아홉/네 번째」인 §7:243이 오히려 §3과 어긋난 쪽이고, 인덱스 의존 문자열이라 애초에 literal일 수 없다.
- ⑤ 반증. 덱 문자열 「점수·유형·궁합이 없어요」는 `:345`에 그대로 렌더된다(TrustPoint body). §7:241은 3개 문구만 주고 title/body 구분을 지정하지 않으며, §3 S0:55도 「점수·유형·궁합 없음」이라는 개념만 요구한다. 화면에 세 문구 전부 있다.
- ⑧ 대부분 중복·반증. 「휴대폰 넘겨주기」 부재는 기지 목록의 "S8 넘겨주기 미구현(의도적)"과 동일. 「이 한 줄만 복사」는 `:715`에 존재하며 위치가 S9인데, 이는 §7:284([S9 버튼 2종] 이 한 줄만 복사 / 안 보내고 끝내기)를 정확히 따른 것이다. §3:137과 §7:284가 서로 충돌하고 구현은 덱을 따랐다. 실제 신규 문자열은 「한 마디 건네기」(`:789`) 1건.

영향: 문서 정확성에 국한된다. 런타임·테스트·컴플라이언스 fence·운영 표면에 영향 0(candidate6.ts 1474줄 무변경). "R1 스크립트·QA 스크린샷 대조가 전부 어긋난다"는 과장 — QA 스크립트는 코드 문자열을 키로 잡고(§13-5가 시작 버튼을 유지한 사유가 바로 그것), 장면·카드 텍스트의 정본은 `candidate6SceneText.ts`이고 그 저작 규칙은 `candidate6SceneText.test.ts`가 정적으로 강제한다. 덱이 21장면 중 9개만 예시했고 그중 4개는 기획서 자기 상한을 위반하므로, 덱이 정본이 될 수 없다는 건 다음 사람도 즉시 발견한다.

남는 실재 결함: §13-5가 「1건」이라고 완결 선언한 것 자체. ①②는 §7이 「그대로 쓸 문장」이라 표시한 문장이 화면에 없고 사유가 어디에도 없다. §13-5 문맥이 S0 갭이라 범위 한정 독해도 가능하지만, ①②가 S0 밖이고 소절 제목이 「기획 대비 구현 갭」이라 어느 독해로도 문서는 오해를 남긴다. 고칠 것은 §13-5에 (a) ①② 미구현 명시, (b) ⑥⑦은 §7 예시가 12자/30자/한 문장 규칙 위반이라 재저작했다는 한 줄, (c) §3:137 vs §7:284 버튼 충돌 해소 기록 — 세 줄 추가다.

### 19. [minor] §7 카피 덱의 예시 4건이 같은 문서 §4B·§10 RED 11이 정한 저작 규칙을 스스로 위반한다(작성자가 이미 고쳤다는 2건과 별개).

- **위치**: `docs/wedding-code/63_today_one_line_design_plan_2026-07-28.md:266-268,258`
- **근거**: §4B:178 `cardPrompt(… 30자 이내, 물음표로 끝난다)`, §4A:172 `④제목 12자 이내`, §4B:181 `시간 표현은 cardAction 필드에서만 허용하고, 나머지 전 상수에서는 분·초 표기를 금지어 스캐너로 막는다.`  그런데 §7:268 `[카드 예 · ES2] 지금은 얘기를 들어주는 게 좋아, 다음 할 일 하나 정하는 게 좋아?` = 38자(30자 초과).  §7:267 `[카드 예 · CP2] 확정 누르기 전에 오 분만 같이 볼래?` 와 §7:266 `[카드 예 · JI3] 쌓인 작은 일 중에 십 분짜리 하나만…` = cardPrompt에 시간 표현(오 분·십 분).  §7:258 `[Tier B 예 · C6-OA2 「정리는 한 사람이 맡았다」]` = 제목 13자(12자 초과).  §7:269 `[카드 예 · OA1] 이건 내가 찾을게. 방법은 내 방식대로 해도 괜찮아?` = 두 문장(「한 문장」 규칙 위반).  구현은 전부 규칙 쪽을 택해 짧게 고쳤지만(candidate6SceneText.ts:169,147,102,118,111) 그 사실이 어디에도 없다.  덧붙여 구현된 스캐너는 아라비아 숫자만 본다 — candidate6SceneText.test.ts:104 `not.toMatch(/\d+\s*(분|초)/)` 라서 기획서 자신의 예시 문자열 「오 분만」·「십 분짜리」는 통과한다.
- **영향**: 기획서를 정본으로 삼아 카피를 복붙하면 자기 테스트에서 떨어진다. 그리고 한글 수사 시간 표현이 스캐너 구멍이라, 「완료 시간 사전 추정」 금지가 실제로는 절반만 막혀 있다.
- **반증 시도 결과**: 반증 실패 — 사실 관계가 전부 확인되며, 오히려 지적이 과소하다.

1) 인용된 규칙은 실재한다. §4B:178(cardPrompt 30자·물음표·한 문장), §4A:172(④제목 12자), §4B:181(시간 표현은 cardAction 필드만), §10 RED 11(치수 정적 검사) 전부 원문 그대로. 계수 규약도 다툼 없음 — 구현 테스트가 공백 포함 String.length를 쓴다(candidate6SceneText.test.ts:70 `sceneTitle.length <= 12`, :76 `card.prompt.length <= 30`), 이는 §8의 270px 폭 근거(공백도 폭을 먹는다)와 일치한다.

2) 실측(테스트와 같은 규약): §7:268 ES2 프롬프트 38자, §7:266 JI3 31자, §7:270 SI2 32자 — 30자 초과가 3건이다(지적은 1건만 셌다). §7:258 제목 「정리는 한 사람이 맡았다」 13자 > 12자. §7:267 「오 분만」·§7:266 「십 분짜리」는 cardPrompt에 든 시간 표현(§4B:181 위반). §7:269 「이건 내가 찾을게. 방법은…」은 두 문장(§4B:178 「한 문장」 위반). 지적한 4건 전부 실재하고 최소 2건이 더 있다.

3) 구현은 전부 규칙 쪽이다 — candidate6SceneText.ts:102/111/147/169 프롬프트가 19/18/16/24자, :117 제목 7자. 테스트를 실제로 돌렸다: 20 passed. 따라서 「기획서를 정본으로 복붙하면 자기 테스트에서 떨어진다」는 검증 가능하게 참이다(길이 단정에서 4건 실패).

4) 기록 누락은 지적보다 심하다. §13-5:518이 「의도적으로 따르지 않은 카피 1건」이라고 양적 단정을 하는데, §7과 상수를 대조하면 카드 프롬프트 5건·장면 제목 4건·when 3건·action 3건·회수 줄 5건이 어긋난다. §7 헤더는 「카피 덱 (그대로 쓸 문장)」이고 문서 어디에도 「예시일 뿐」이라는 유보가 없다(grep 결과 234행 헤더와 518행뿐).

5) 스캐너 구멍도 실재한다. :104 `/\d+\s*(분|초)/`는 아라비아 숫자만 본다. 「오 분」·「십 분」은 통과하고 이를 막는 다른 가드가 없다(candidate6.test.ts:729도 `/15분|20분/`로 숫자 전용).

반증에 성공한 부분은 하나다 — whyItMatters의 「완료 시간 사전 추정 금지가 실제로는 절반만 막혀 있다」는 과장이다. 그 금지의 대상은 경험 소요시간 고지(§63:47 「개수는 소요시간 대리 지표」, §7:240 「걸리는 시간은 실제 사용성 검증 뒤 안내」)이고 그 울타리는 별도로 서 있다(Candidate6Prototype.test.tsx:48 `not.toContain("3분 테스트")`). 파트너에게 「오 분만 같이 볼래?」는 명시 허용된 「10분 안에」에 인접한 대화 제안이지 제품의 완료 시간 추정이 아니다. 게다가 문서 자신의 문구가 「분·초 표기」라서 숫자 정규식이 그 절에는 충실하다. 또 현재 상수에는 action 필드에조차 시간 표현이 0건이므로(「10분 안에」 라벨은 Candidate6Prototype.tsx:750에 있다) 실제 누출은 없고 잠재 구멍이다.

중복도 아니다 — 「이미 알려진 것」의 카피 항목은 시작 버튼 라벨 1건이고 사유가 기록돼 있다. 여기 5~6건은 기록이 없다.

결론: 코드 결함 0, 사용자 영향 0, 테스트 그린. 순수 문서 자기모순 + 잠재 스캐너 공백. minor 유지가 정확하다.

### 20. [minor] RED 9 금지어 스캐너의 어휘 목록이 기획서가 지정한 것보다 5개 짧다. 축소 사실이 기록되지 않았다.

- **위치**: `apps/web/src/lib/weddingCode/research/__tests__/candidate6SceneText.test.ts:83`
- **근거**: 기획 §10:361 `RED 9 — 금지어 스캐너: candidate6SceneText.ts 전 문자열에 /점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급|가족|하객|업체|견적|계약/ 불포함`.  구현: `const banned = /점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급/;` — `가족|하객|업체|견적|계약` 누락.  (막간용 DOMAIN_NOUNS 배열에는 이 단어들이 있지만 그 검사는 CANDIDATE6_INTERLUDE_SENTENCES에만 적용된다 — 같은 파일 :134-142.)  현재 상수에 실제 위반 문자열은 없다.
- **영향**: 지금은 무해하지만, 이 펜스의 존재 이유가 「나중에 문장을 추가하는 사람이 업체·견적·계약을 회사 발화로 승격시키지 못하게」다(§4A 리뷰 플래그 항목 DS3에 대한 명시적 방어). 플래그 4개가 rewrite로 판정되어 Tier B를 저작하게 되는 시점에 정확히 필요한 단어들이 빠져 있다.
- **반증 시도 결과**: 직접 확인 결과 인용이 정확하다. candidate6SceneText.test.ts:83의 banned는 14개 어휘(`점수|유형|궁합|overlap|정확도|희귀|상위|퍼센트|성공|이혼|검증됨|안전|위험|등급`)이고, 기획 §10:361이 지정한 19개 중 꼬리 5개(`가족|하객|업체|견적|계약`)가 절단됐다. 대체 커버리지도 없다 — 그 5개는 DOMAIN_NOUNS(:29-33)에 있지만 검사 대상이 CANDIDATE6_INTERLUDE_SENTENCES뿐(:134-142)이라, 21항목 저작 문자열(sceneTitle/recapLines/card 3필드)에는 도메인 명사 펜스가 0개다. 다른 가드도 이 표면을 덮지 않는다: 동일 어휘 세트는 candidate5.test.ts:173(CANDIDATE5_NEUTRAL_TOPICS)와 candidate6.test.ts:760(CANDIDATE6_NEUTRAL_CONVERSATION_CARDS)에만 존재하며 두 파일 모두 candidate6SceneText를 import하지 않는다(= 이 기능군의 확립된 카피 펜스인데 신규 상수만 누락). 지적의 근거도 실재한다: §4A가 "전 티어 공통 3금 (b) 업체·금액·등급·안전/위험·부모 단정 0"과 "DS3의 업체 서술을 회사 발화로 승격시키지도 않는다"를 명시하고, 같은 정규식엔 `금액`·`부모`도 빠져 갭이 지적보다 오히려 넓다. 기록 여부도 반증 실패: §13-5(기획 대비 구현 갭)는 S0 갭 2건과 의도적 카피 편차 1건(시작 버튼)만 남겼고, 막간 검사 반전은 테스트 주석 :22-29에 기록됐으나 RED 9 축소는 문서·커밋 본문(211b9e49) 어디에도 없다. 반증 시도로 세운 두 논거가 무너졌다 — (1) "RED 9가 RED 10(tierA 명사 ⊂ premise)과 모순돼 축소가 불가피"는 거짓이다. RED 10은 상한이고 RED 9는 추가 금지라 양립하며, 구현이 DS1 premise의 '업체'를 "마지막 두 곳"으로 우회 저작한 것이 양립 증거다. (2) "플래그 4항목 null 강제(:48-58)가 DS3를 이미 막는다"는 참이지만 플래그가 rewrite로 풀리면 같이 사라지는 펜스라, 지적이 겨눈 시점엔 무효다. 다만 영향은 현재 0이다 — candidate6SceneText.ts에서 그 5개 단어는 JSDoc 주석 :28에만 있고 문자열 값에는 없어, 5개를 추가해도 깨지는 테스트가 없다(무비용 수정이라 '불가피한 축소' 방어도 불가). 즉 실체는 있으나 전방 방어 펜스의 완성도·기록 누락이고 사용자 영향은 없으므로 minor 유지.

### 21. [minor] §3 S1b·S2·S4의 모션 사양(시트 220ms 상승 + dim, 막간 문장 300ms + 버튼 80ms 지연)이 전혀 구현되지 않았고, 시트에 dim 배경도 없다.

- **위치**: `apps/web/src/lib/weddingCode/research/Candidate6Prototype.tsx:1164-1191`
- **근거**: 기획 §3 S1b 사양:81 `rounded-t-[20px] bg-white, 220ms translateY(100%)→0, dim bg-[#243832]/20 fade 220ms.` → 구현 :1165는 `fixed inset-x-0 bottom-0 z-20 rounded-t-[20px] border-t … shadow-…`로 전환도 dim도 없다.  §3 S2 사양:91 `문장 300ms opacity+translateY 8px, 버튼은 80ms 지연 후 등장.` → 구현 :248-263 막간 화면에 transition/animation 클래스 0개.  §8 motion:304의 short 160·220 / medium 300 규정이 신규 화면 어디에도 적용되지 않았다.  §13-5 갭 목록에 없음.
- **영향**: 컴플라이언스 위험은 없지만, 시트에 dim이 없으면 배경의 문항 화면과 시각적으로 분리되지 않는다 — 측정 화면 위에 장면 제목·라벨이 겹쳐 뜨는 구조라 「지금 보고 있는 것이 문항인가 목록인가」가 흐려지고, 이는 최상위 불변식(측정 화면 오염 방지)이 지키려는 경계 그 자체다.
- **반증 시도 결과**: 핵심은 실재한다(반증 실패). Candidate6Prototype.tsx:1165의 ContentsSheet 루트는 `fixed inset-x-0 bottom-0 z-20 rounded-t-[20px] border-t border-[#EFE4D7] bg-white px-4 py-5 shadow-[0_-18px_50px_rgba(36,56,50,0.12)]`이고 컴포넌트 전체에 translate/transition/duration 토큰이 0개, dim 요소도 0개다(§3 S1b:81은 220ms translateY + dim/20 fade 명시). :245-263 막간 화면도 transition/animation 클래스 0개(§3 S2:91은 문장 300ms + 버튼 80ms 지연). §9 범위에 있던 .c6-stagger-1~6은 apps/web/src 전체에 존재하지 않는다(grep 무결과). §13-5는 intro 2건 + 시작 버튼 카피 1건만 기록하고 §13-3은 음각 홈·premise 밴드 보류를 기록하는데, 시트·막간 모션은 둘 중 어디에도 없다 — '명시됐지만 미구현이고 갭 장부에도 없음'은 사실이다. 두 경로 모두 도달 가능하다(:388-393 헤더 버튼 → contentsOpen, 막간은 Candidate6Rhythm.test.tsx:101-105가 실제로 통과시킨다).

다만 지적의 두 부분은 틀렸다. (1) 증거문 "§8 short 160·220 / medium 300 규정이 신규 화면 어디에도 적용되지 않았다"는 거짓이다. git diff 97d298c5..211b9e49가 바로 이 구간에서 추가한 것: :368 `transition-colors duration-[450ms] motion-reduce:transition-none`(§8 medium 450 황혼), :384 `transition-opacity duration-[220ms]`(§8 short 220 라벨 교체), :405 `transition-colors duration-[220ms]`(§8 champagne border 220ms). §8이 이름 붙인 값 중 셋이 구현됐고, 미구현은 시트 상승·dim / 막간 300 / 버튼 80 지연 / stagger 40뿐이다. (2) whyItMatters의 최상위 불변식 연결은 성립하지 않는다. 시트는 불투명 bg-white + hairline border-t + 0.12 알파 상향 shadow(문항 surface 자체 shadow 0.07보다 강함)라 "분리되지 않는다"는 과장이고, 결정적으로 `items={journey.slice(0, questionIndex)}`이므로 지금 열려 있는 장면의 제목은 시트에 원리적으로 들어갈 수 없으며 시트가 스스로 "답은 여기 적지 않아요. 장면 제목만 있어요."를 출력한다. 지적이 불러온 오염 경로(현재 문항의 해석이 문항과 함께 보이는 것)는 dim 유무와 무관하게 구조로 닫혀 있다. 모션 부재의 기능·컴플라이언스·접근성 영향은 0이며(모션이 없으니 motion-reduce 요건 자동 충족, 완료 고유 연출 위험은 오히려 감소) 남는 실제 영향은 기획서 §3·§8 사양과 §13 갭 장부의 문서 불일치 하나다.
