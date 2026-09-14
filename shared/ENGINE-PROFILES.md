# ENGINE PROFILES — 일론·젠슨

> 기준일: 2026-09-14
> 목적: 모델 서열이 아니라 접근환경·실측 성능에 따른 역할 라우팅

## 일론 (Hermes)

### 실측
- 모델: `gpt-5.6-sol`
- Provider: `openai-codex`
- 인증: OpenAI Codex OAuth
- Fallback providers: `[]`
- Hermes: `v0.18.2 (2026.7.7.2)`
- OpenAI SDK: `2.24.0`
- Hermes Python: `3.11.15`
- Agent max turns: `60`
- Context limit: config 미지정(provider 자동 결정). 정확한 최대치는 현재 런타임에서 노출되지 않음.
- 분당·일일 한도: 고정 수치 미노출. 실제 quota 기반이며 2026-09-14 05:11에는 429 후, 08:11 및 10:37 cron 실행은 성공.

### 접근환경
- Windows 11 host와 로컬 파일·프로세스·Hermes·Slack·cron에 직접 접근.
- Windows에서 `wsl.exe`를 통해 `OpenClawGateway` 및 OpenClaw CLI 호출 가능.
- WSL 쪽 `/mnt/c`는 미마운트이므로 OpenClaw→Windows 접근은 막혀 있음. 현재 접근은 비대칭임.

## 젠슨 (OpenClaw)

### 독립 확인
- 기본 모델: `anthropic/claude-opus-5`
- OpenClaw: `2026.5.28 (e932160)`
- 실행환경: WSL2 `OpenClawGateway`

### OpenClaw 자체 실측 보고
- 런타임: `claude-cli/claude-opus-5`, OAuth
- 등록 모델 7종, 정밀 대형 작업은 `claude-fable-5-1`로 태스크 단위 전환 가능
- Context 200k, Claude CLI `2.1.261`
- `/mnt/c` 미마운트·interop 차단, WSL 메모리 상한 6GB, 긴 단일 턴 watchdog 오판 위험

## 역할분담 반영 원칙

1. 일론을 무료·경량 초안 전용으로 제한하지 않는다. 분석·구현·독립 검증까지 동등하게 맡긴다.
2. 역할의 기본축은 모델 서열이 아니라 물리적 접근권한이다: Windows/Hermes 운영은 일론, WSL 내부 장기원장은 젠슨.
3. 서로 다른 모델 계열을 Maker/Checker로 사용해 동일 편향과 동일 오류 가능성을 낮춘다.
4. 도메인 Lead 직접 단일보고 원칙은 유지한다. 부자아빠님이 상대 의견을 요청하면 추가 교차검증한다.
5. 30일 기준선 평가와 역할 재배정 시 본 문서의 엔진 변경을 반영한다.
