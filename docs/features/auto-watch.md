# 자동감시 제어 · 실행 · 알림

CUSTOM / PREBUY / BOOSTER를 단일 자동감시 보드와 엔진으로 관리합니다.

상위 인덱스: [../README.md](../README.md)

## 1. 상태 모델

`watch_orders.status`

- `WATCHING` — 감시 중
- `PAUSED` — 사용자 일시중지
- `EXECUTED` — 주문 발사 성공
- `FAILED` — 주문 발사 실패
- `EXPIRED` — 유효일 만료
- `CANCELLED` — 사용자 삭제

`WATCHING ↔ PAUSED` 만 제어 상태입니다. 나머지는 terminal 상태입니다.

전역 자동감시는 계좌 단위 설정(`watch.global.enabled.{accountId}`)으로 관리하며, OFF여도 개별 row 상태는 바꾸지 않고 런타임 실행만 막습니다.

## 2. 비교 규칙과 AS-IS 정렬

비교는 돌파(cross) 감지가 아니라 **현재가 threshold 충족**입니다.

- `LTE` — `price <= targetPrice`
- `GTE` — `price >= targetPrice`

의미:

- `PREBUY` / AS-IS 예약매수: 목표가 이하로 내려오면 매수
- `BOOSTER` / AS-IS 수익부스터: 마지막 1차 매도 체결가 기준 `-N%` 하락 도달 시 재매수
- `CUSTOM`: AS-IS 확장 기능으로 `BUY/SELL + LTE/GTE`를 모두 허용

주의:

- 현재가가 이미 조건을 만족한 상태라면 다음 가격 업데이트에서 즉시 트리거됩니다.
- `boosterPct <= 0` 은 즉시 트리거 의미를 유지합니다.

## 3. 소스별 ownership

- `CUSTOM` — `watch_orders`가 authoritative
- `PREBUY` — `prebuy_orders`가 authoritative, `watch_orders`는 `sourceRefId=prebuy_orders.id`를 가진 control/runtime row
- `BOOSTER` — `watch_orders`가 runtime row이며 `metadata`에 booster task를 JSON으로 저장

`sourceRefId`와 `metadata`를 사용해 reload 시 중복 row 없이 reconcile합니다.

## 4. UI

헤더:

- `자동감시 ON/OFF (N)` 버튼
- `N = WATCHING + PAUSED`

보드:

- `현황` — `WATCHING + PAUSED`
- `실행내역` — `EXECUTED`
- `실패` — `FAILED`
- `히스토리` — 등록/수정/일시중지/재개/실행/실패/만료/삭제 이벤트 timeline

컨텍스트 메뉴:

- `시작` — `PAUSED → WATCHING`
- `중지` — `WATCHING → PAUSED`
- `삭제` — `CANCELLED`
- `수정` — `CUSTOM` row만 in-place update

## 5. 알림

자동감시 outcome은 메인 프로세스에서 발행하고, 두 채널로 fan-out 합니다.

- Native OS 알림 — `notifications.osEnabled !== false` 일 때
- Renderer toast — preload `appShell.onWatchEvent`

알림 범위:

- `EXECUTED`
- `FAILED`
- `EXPIRED`

체결통보 알림과 자동감시 outcome 알림은 별도 문구를 사용합니다.
