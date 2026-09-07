# 배포 전 의존성 보안 수정 — 2026-09-07

운영 배포 사전 점검 중 GitHub가 알려온 Dependabot 경고를 현재 브랜치의 잠금 파일과 대조했다. 출발 커밋은 `58a70b4c423d947fae327cc5625d05449ebafb70`이며, 기본 브랜치의 열린 경고 13건(High 8·Medium 4·Low 1)에 해당하는 버전이 이 브랜치에도 있었다. 경고를 숨기거나 운영에서 악용됐다고 단정하지 않고 의존 경로와 실제 수정 방법을 확인했다.

## 반영 내용

| 의존성 | 반영 | 확인한 범위 |
|---|---|---|
| fast-uri | 3.1.5 → 3.1.6 | 웹 Ajv의 아모라 도구 스키마 검증 경로. 기존 동기 스키마 검증을 보존한다. |
| browserslist | 4.28.2·4.28.6 → 4.28.7 | Babel·Metro·webpack의 빌드 경로. |
| @humanfs/node | 0.16.7 → 0.16.8 | ESLint 파일 처리 경로. |
| fflate | 0.4.8 → 0.4.9 | PostHog 압축 및 ZIP 호환성. |
| @xmldom/xmldom | 0.8.13 → 0.8.15 | Mammoth DOCX 읽기와 Expo plist 경로. |
| postcss-selector-parser | 6.1.2 → 6.1.3 | 모바일 Tailwind/PostCSS 빌드 경로. |
| decode-uri-component | 0.2.2 → 0.5.0 및 로컬 호환 패치 | React Navigation → query-string의 실제 딥링크 입력 경로. |
| image-size | 1.2.1 및 로컬 경계 검사 패치 | Metro의 이미지 자산 분석 경로. 공식 수정 버전으로 소개하지 않는다. |

새 부모 패키지가 요구하는 범위 때문에 @humanfs/core·@humanfs/types와 두 브라우저 매핑 패키지도 함께 바뀌었다. 그 밖의 앱 직접 의존성 버전은 변경하지 않았다. workspace override와 실제 잠금 파일의 버전을 모두 검사하며 두 로컬 패치의 연결도 고정한다.

문자 해석기는 0.5.0을 그대로 넣으면 기존 CommonJS 소비자가 `TypeError`를 내는 것을 먼저 재현했다. 보안 수정 알고리즘은 유지하고 모듈 내보내기 방식과 기존 `+` → 공백 계약만 보존했다. query-string이나 React Navigation의 대규모 업그레이드로 대체하지 않았다. 이전/새 후보의 103개 입력 결과를 대조했고, 실제 설치된 React Navigation의 한글·이모지·반복 값·숫자·비정상 escape 회귀 6개가 통과했다. 48/96바이트 비정상 입력의 native decode 호출은 기존 468/1,956회에서 후보 3/3회로 줄었다.

이미지 분석기는 ICNS의 길이 0 항목과 JXL의 크기 0 부분 상자가 처리를 끝내지 못하는 것을 별도 프로세스에서 재현했다. 최소 헤더/길이를 검사하고 ISO BMFF의 크기 0 상자를 파일 끝까지의 길이로 해석해 커서가 전진하도록 했다. 정상 PNG·ICNS·JXL·AVIF·JP2, EOF 상자와 실제 설치본 일치 등을 포함한 12개 회귀가 통과했다. 같은 HEIF 예제는 설치된 1.2.1에서 유한하게 반환했으므로 HEIF 무한 반복까지 재현했다고 기록하지 않는다.

## 검증 증거와 한계

- 첫 6개 버전 갱신 후 기존 웹 검사 6개 파일/172개 테스트, 실제 Mammoth·gzip/ZIP·URI·CSS·브라우저 목록 호환 검사 5개가 통과했다.
- 문자 해석기와 이미지 패치는 각각 실제 의미 변이 3개를 모두 검출하고 원복했다. 구문·임포트 실패나 설치본 바이트 불일치만으로 검출 성공을 세지 않았다.
- 반례는 독립 임시 복사본에서 실행했다. 설치된 pnpm 패키지와 원본 이미지에는 직접 쓰기 변이를 하지 않았다. 이미지 프로세스에는 시작·응답 시간과 heap 한도를, 문자 해석에는 VM 시간 한도를 적용했다.
- 최종 전체 타입·lint·테스트와 웹·Expo 빌드의 실행 결과는 [PR #328](https://github.com/Kyu-Sung-Cho/wedding-hanbang-web/pull/328)과 외부 `team-round6-deployment-20260907/security-final-gates/`의 종료 코드·원문 로그·소스 지문 영수증으로 확인한다. 개별 회귀 결과를 전체 통합 검사로 세지 않는다.
- 원래 13건 중 11건에 해당하는 버전은 공식 수정판으로 교체했다. image-size의 2건은 공식 수정판이 없어 로컬 패치를 검증했다. 버전 기반 audit이나 아직 병합하지 않은 기본 브랜치의 경고가 닫혔다고 주장하지 않는다.
- 최종 `pnpm audit --json`은 High 2건(image-size) 때문에 종료 코드 1이었다. 나머지 Critical·Moderate·Low는 0이다. audit이 제시한 `>=2.0.3`과 달리 npm registry의 정확한 `image-size@2.0.3` 조회는 패키지를 찾지 못했다. 따라서 설치 가능한 정식 수정판으로 취급하지 않았고, 검증한 로컬 패치와 남은 버전 경고를 함께 기록한다.
- Metro 패치는 Next.js에 별도로 내장된 이미지 분석 코드까지 바꾸지 않는다. 조사한 Next 경로는 정적 자산/개발용 blur였고 운영 최적화는 Sharp를 사용한다. 이 검토를 모든 외부 입력의 악용 가능성 부재 증명으로 확대하지 않는다.
- 운영 DB·Storage의 전량 백업/격리 복구, 신규 SQL 8개의 hosted 회귀, 실모델·실기기 검증과 운영 배포는 별도 미완료 조건이다. 자세한 조건은 `AMORA_DEPLOYMENT_PREREQUISITES_2026-09-07.md`에 있다.

원문 API 응답·npm 무결성·잠금 파일 전후·실행 로그는 외부 `dependency-security/`, `decode-uri-security/`, `image-size-guard-raw/`에 보존했다. 자격증명과 사용자 원본 데이터를 포함하지 않는다.

공식 근거: [fast-uri](https://github.com/advisories/GHSA-jqff-g426-hqxp), [browserslist](https://github.com/advisories/GHSA-c83g-rgw3-j3cx), [decode-uri-component](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr), [image-size ICNS](https://github.com/advisories/GHSA-w3rx-r6r6-pgpr), [image-size JXL/HEIF](https://github.com/advisories/GHSA-5p2g-fcmc-qvqq). 전체 13건의 공식 원문 링크는 외부 의존성 검토 보고서에 있다.
