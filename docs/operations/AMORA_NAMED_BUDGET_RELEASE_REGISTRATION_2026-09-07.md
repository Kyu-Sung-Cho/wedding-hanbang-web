# 이름별 예산 배분 SQL의 배포 목록 등록

2026-09-07 로컬 등록 시점 기록이다. 운영 적용 완료 보고서가 아니다.

- 전역 `vendor-disclosure-v2-20260718.json`에 `20260907085111_amora_budget_plan_named_allocations.sql` 하나를 추가했다. SQL SHA256은 `5be83d180d905c6c0883c81ef0e0379b7b70a70c56ddea86d30b04548a950ae9`다.
- 등록 전 로컬 배포 fence는 정확한 SQL 목록 불일치를 검출했다. 새 scoped loader가 검토한 SQL을 읽는 것만으로 전역 정적 배포 계약까지 충족되지는 않는다.
- 정본 함수가 계산한 새 Production authorization SHA256은 `9fdf97e91ca6e53ac19394443d452061f635d1f05cfceff50483fa3d3cc5f3e7`이다. 저장소 signature pin은 이 값과 일치한다. Vercel Sensitive 환경변수 교체와 실제 Production 후보 빌드 검증은 운영 담당자의 별도 단계이며, 이 기록 시점에는 미완료다.
- 전역 `deployment_blocked`, 기존 predecessor/head 및 `missing` 증거 5종은 바꾸지 않았다. 기존 8개 SQL scoped 실행 매니페스트와 full controller도 그대로다.
- 실제 신규 SQL 적용은 `--amora-named-budget-hotfix`의 별도 214→215 계약만 사용한다. 정확한 source commit·1개 SQL·원본 백업·실제 PostgreSQL 시험·쓰기 차단·원자 적용·canary·소유 lease 해제 조건은 계속 필요하다.

전역 목록 등록이나 로컬 검사 통과를 운영 DB 적용, 원본 전체 복구, Storage 복구 또는 실제 모델 검증으로 해석하지 않는다.
