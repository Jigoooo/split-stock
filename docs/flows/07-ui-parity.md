# 07. UPBIT UI Parity + 한국어 라벨 + AI 추천 플로우

UPBIT 자동매매 UI를 도메스틱(KIS) 수준으로 맞추는 parity 작업 및 관련 UI 정책.

---

## UPBIT UI Parity 범위

UPBIT 자동매매 화면은 KIS 화면과 동일한 레이아웃/컴포넌트 구조를 공유하되,
broker별 차이를 조건부 렌더링으로 처리한다.

### 현재 구현 상태 (E2-1 + E2-2 + post-E2 hardening 통합)

```
[UPBIT 자동매매 진입]
  → 계좌 선택 (onActiveAccountChanged)
  → CryptoAutoSection 렌더링
       ├─ 잔고 실시간 평가 (NM-017)
       │    → UPBIT REST 잔고 조회
       │    → 현재가 × 보유수량 = 평가금액
       │    → 전체 계좌 체결 내역
       ├─ 자동매매 ON/OFF 토글
       │    → safetyRegistry.master
       ├─ 차수별 설정 (UI)
       │    → plan-buy threshold / 목표 수익률
       └─ 부스터 설정 (UI)
            → profitBooster.enabled / boosterPct
```

### Parity 체크리스트

| 항목 | KIS | UPBIT | 상태 |
|---|---|---|---|
| 자동매매 ON/OFF 토글 | ✅ | ✅ | 동등 |
| 차수별 매수 설정 | ✅ | ✅ | 동등 |
| 부스터 설정 | ✅ | ✅ | 동등 |
| 체결 내역 실시간 | ✅ | ✅ NM-017 | 동등 |
| 잔고 실시간 평가 | ✅ | ✅ NM-017 | 동등 |
| 실전 전환 2단계 모달 | ✅ | ✅ (공유) | 동등 |
| catch-up 다이얼로그 | ✅ KIS only | ❌ UPBIT 미해당 | 설계 의도 |
| 예약매수 | ✅ KIS only | ❌ UPBIT 미해당 | 설계 의도 |

---

## 한국어 라벨 정책

### 원칙

- 모든 사용자 노출 텍스트는 한국어 우선
- 영어 약어는 필요 최소한으로 제한 (예: WS, REST, rps 등 기술 용어 제외)
- 에러 메시지 한국어화 포함

### 주요 라벨 매핑

| 도메인 | 영어 원문 | 한국어 라벨 |
|---|---|---|
| 자동매매 | Auto Trading | 자동매매 |
| 매수 | Buy | 매수 |
| 매도 | Sell | 매도 |
| 차수 | nth / order level | 차수 |
| 부스터 | Profit Booster | 수익 부스터 |
| 실전 전환 | Switch to PROD | 실전 전환 |
| 잔고 평가 | Evaluated Balance | 잔고 평가금액 |
| catch-up | Catch-up | 따라잡기 / catch-up |
| 예약매수 | Pre-buy | 예약매수 |

---

## AI 추천 기능 (현재 disabled)

### 현재 상태

AI 종목 추천 / 전략 추천 기능은 현재 UI에 disabled 상태로 존재.
렌더링은 되나 실제 API 연결 없음.

```
[AI 추천 버튼 클릭]
  → isAiEnabled 플래그 확인
  → false: 버튼 비활성화 또는 "준비 중" 안내
  → true: [미구현 — 로드맵 Phase 1]
```

### 로드맵 (AI 고도화 — 별도 backlog)

| Phase | 기능 | 상태 |
|---|---|---|
| 1 | 종목 추천 (BYO API 키) | backlog |
| 2 | strategy 추천 + DART/KRX MCP | backlog |
| 3 | 회고 + 리스크 요약 | backlog |
| 4 | LangGraph | backlog |
| 5 | MCP 서버화 | backlog |

---

## UPBIT 잔고 실시간 평가 (NM-017)

### ASCII 흐름도

```
[잔고 실시간 평가 — NM-017]
UPBIT REST 잔고 조회 (polling)
  → accounts[] (currency, balance, avg_buy_price)
  → 현재가 조회 (ticker REST)
  → 평가금액 = balance × current_price
  → 평가손익 = (current_price - avg_buy_price) × balance
  → renderer 반영

[전체 계좌 체결 내역]
UPBIT private WS → applyPrivateOrder
  → repo.applyPrivateOrderEvent (cryptoFills)
  → broadcastToAllWindows → renderer 체결 목록 갱신
```

### 검증 결과 (NM-017)

✅ UPBIT 잔고 실시간 평가 + 전체 계좌 체결 — commit `40d0535`.

---

## 검증 결과

✅ UPBIT UI KIS 수준 parity 달성 (NM-017 포함).
✅ 한국어 라벨 정책 적용.
⚠️ AI 추천 기능 — 현재 disabled. 로드맵 Phase 1 이후 활성화.
