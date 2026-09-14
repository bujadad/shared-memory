# CROSS-MODEL ERROR LEDGER

> 시작: 2026-09-14
> 목적: GPT 계열과 Claude 계열의 상호 검증 효과를 원인코드별로 측정

## 원인코드

- `PROVIDER`: 인증·quota·provider routing 오류
- `RUNTIME`: OS·프로세스·도구·경로·스케줄러 오류
- `LOGIC`: 추론·인과·판단 오류
- `SCOPE`: 요청 범위·권한·완료조건 오류

## 기록 규칙

- 실제 오류가 재현되거나 원본·로그로 확인된 경우만 기록한다.
- 오류를 낸 쪽과 발견한 쪽을 분리한다.
- 자기채점은 금지한다. 상대가 근거를 확인해야 `confirmed`가 된다.
- 단순 문체 차이·취향 차이·근거 없는 이견은 집계하지 않는다.

## Events

| Date | Source | Detected by | Code | Evidence | Status |
|---|---|---|---|---|---|
| 2026-09-14 | OpenClaw/Claude | Hermes/GPT | LOGIC | OpenClaw가 Hermes의 WSL 접근 불가라고 판단했으나, Hermes가 `wsl.exe`로 `OpenClawGateway`와 OpenClaw CLI 접근을 실측해 정정. OpenClaw가 공개 스레드에서 오류 인정. | confirmed |
