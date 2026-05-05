# R1 Crypto → Stock Table ETL Mapping

> Phase R1 사전 준비 — 코인 전용 테이블 → stock broker-aware 테이블 데이터 이전 매핑.
> Plan: `~/.claude/plans/deep-interview-1-buzzing-reef.md`
> 사전 R0 commits: `5f7197e` (broker 컬럼), `6386a21` (repo filter), `746860a` (inline), `72bed43` (lots decimal).

## 1. 매핑 표

| Source (crypto)             | Target (stock)        | Broker  | 주요 변환                                                       |
|------------------------------|------------------------|---------|------------------------------------------------------------------|
| `cryptoAutoLots`             | `lots`                 | 'UPBIT' | DecimalString → `qty_decimal` 등 nullable 컬럼 (R0-5).         |
| `cryptoOrders`               | `orders`               | 'UPBIT' | state ↔ status mapping (§2). orderUuid ↔ id resolve.            |
| `cryptoFills`                | `trades`               | 'UPBIT' | `cryptoOrders → orders` 선행 INSERT 후 orderId resolve.         |
| `cryptoMarketMemos`          | `symbol_memos`         | 'UPBIT' | `market` → `pdno`, content 그대로.                              |
| `cryptoAutoTemplates`        | `settings` KV          | n/a     | key=`crypto:strategy:preset:{accountId}:{name}` JSON 그대로.    |
| `cryptoAutoConfigs`          | `settings` KV          | n/a     | key=`crypto:autoConfig:{accountId}:{exchange}:{market}` JSON.   |
| `cryptoAutoWatches`          | `watch_orders`         | 'UPBIT' | entryCondition mapping (§4).                                     |
| `cryptoBalances`             | (skip)                 | n/a     | polling 결과 — 매번 갱신, ETL 불필요.                           |
| `cryptoAutoEvents`           | `event_logs`           | n/a     | category='AUTO_CRYPTO', payload_json 그대로.                    |
| `cryptoCandles`/`cryptoInstruments`/`cryptoRealtimeCheckpoints` | (보존)             | n/a     | 시세 캐시 — stock 동등 부재. 일단 보존, R4 cleanup 시 결정.    |

## 2. cryptoOrders.state ↔ orders.status

| crypto state | stock status | 비고                                                |
|---------------|---------------|-----------------------------------------------------|
| `wait`        | `PENDING`     | 매수/매도 미체결.                                  |
| `watch`       | `PENDING`     | 트리거 대기 (코인 specific). orders 에 통합.       |
| `done`        | `FILLED`      | 완전 체결.                                          |
| `cancel`      | `CANCELLED`   | 사용자/시스템 취소.                                |

**partial 케이스**: cryptoOrders 에 별도 'partial' state 없음 — `executedVolume < volume` 으로 추론. ETL 시 `executed_volume > 0 && state='wait'` → status='PARTIAL'.

## 3. trades INSERT 의존성 (orderId FK)

ETL 실행 순서:
1. cryptoOrders → orders 모두 INSERT (`broker='UPBIT'`)
2. orderUuid → 새 `orders.id` map 메모리 보관
3. cryptoFills 순회 → `tradeMapByUuid[fill.orderUuid].id` 로 orderId resolve
4. trades INSERT (`broker='UPBIT'`)

cryptoFills 의 `orderUuid` 가 orders 매핑에 없으면 (orphan fill) → eventLog WARN 만 남기고 skip.

## 4. cryptoAutoWatches.entryConditionJson 매핑

cryptoAutoWatches 에는 `entryConditionJson` 필드가 있음 — 형식: `{"type":"immediate"|"price-above"|"price-below", "price": number|null}`.

stock `watchOrders` 의 등가:
- `comparator`: 'LTE' | 'GTE'
- `targetPrice`: integer
- `status`: 'WATCHING' | 'PAUSED' | ...

매핑:
| crypto entryCondition.type | watch_orders                                                |
|----------------------------|-------------------------------------------------------------|
| `immediate`                | status=`EXECUTED`, executedAt=now (이미 발사된 것으로 간주). |
| `price-above`              | comparator=`GTE`, targetPrice=price.                        |
| `price-below`              | comparator=`LTE`, targetPrice=price.                        |

**price 가 fractional 이면**: targetPrice 도 fractional → R0-6 (잠재) `target_price_decimal` 컬럼 필요. R1 도착 시 정밀 검증.

## 5. cryptoAutoConfigs → settings KV — schema 호환?

cryptoAutoConfigs 의 필드 (mode, emergencyDisabled, baseOrderKrw, addTriggerPct 등) 는 stock `StrategyProfile` zod schema 와 다름. settings 의 KV 자체는 raw JSON 저장이므로 schema 검증은 read 시점.

**대응**: `key='crypto:autoConfig:{...}'` 는 stock strategy-repo 의 readStrategyProfile 가 read 안 함 (다른 prefix). 코인 전용 read 함수는 R3/R4 phase 에서 stock 통합 컴포넌트 위에 broker 분기로 처리. R1 시점에는 단순 JSON 보존만.

## 6. Idempotency (재실행 방지)

ETL 함수는 idempotent 해야 함. 재실행 시 중복 INSERT 방지:
- `settings.crypto_etl_completed` flag 패턴 — 첫 실행 후 `'1'` 저장. 재실행 시 noop.
- 안전망: 모든 INSERT 에 `INSERT OR IGNORE` 또는 PK 충돌 체크.

## 7. ETL 트리거 시점

**1차 결정**: app 시작 시 자동 트리거 안 함. 사용자 confirm 모달 후 명시적 실행.
- 설정 페이지 → "코인 데이터 통합" 버튼 → confirm 모달 (백업 자동 생성 안내) → ETL 실행 → 결과 요약 표시.
- dry-run 모드 default — 사용자가 "실제 실행" 토글 후 actual write.

이유: ETL 은 사용자 자동매매 데이터를 만지므로 사용자 인지 + 동의 없이 자동 실행 금지.

## 8. crypto-only 필드 처리

| Field                     | 처리                                                                    |
|---------------------------|-------------------------------------------------------------------------|
| `cryptoAutoLots.realizedPnl` | drop. 추후 lots 사이드카 또는 lots 자체 추가 가능 (lots 에 realized_pnl 컬럼 없음). |
| `cryptoAutoLots.feesPaid`    | drop. 동일 — fees 추적은 별도 phase.                                  |
| `cryptoAutoLots.source`      | drop. dry-run/live 구분은 ETL 후 의미 없음 (사용자 데이터는 모두 live 가정). |
| `cryptoOrders.identifier`    | drop. UPBIT 클라이언트 idempotency key — orders 에 동등 없음.          |
| `cryptoOrders.paidFee`/`locked`/`rawJson` | drop. orders 에 동등 없음.                            |

drop 한 필드들은 ETL 결과 요약 로그에 row count 남겨 추후 추적 가능.

## 9. 백업 인프라 (R1-1)

기존 `src/main/db/settings-backup.ts` 의 retention 설정 위에 1회성 강제 백업 호출:
- 새 `src/main/db/etl-backup.ts` (또는 settings-backup.ts 확장) — DB 파일 `{db}.bak.crypto-etl.{timestamp}` 로 fs.copyFile.
- 실패 시 ETL 실행 중단 + 에러 throw + 사용자에게 안내.
- 복원 가이드: `docs/migrations/etl-restore.md` 별도 작성.

## 10. dry-run 모드

ETL 함수 시그니처: `runCryptoEtl(db: Db, options: { dryRun: boolean })`.

- `dryRun: true`: SELECT/SQL 실행하여 row count + 필드 매핑 검증, INSERT 안 함, diff log 만 반환.
- `dryRun: false`: 실제 INSERT 실행. 백업 자동 생성 후 진행.

UI 에서 dry-run 결과 사용자에게 보여주고 "확인 후 실제 실행" 버튼 단계 분리.

## OPEN (사용자 확인 권장 사항)

위 default 결정들은 R1 진행을 위한 합리적 가정. 다음 항목은 사용자 명시 확인 시점이 있으면 좋음:

1. `cryptoAutoLots.realizedPnl`/`feesPaid` drop — 사용자 PnL 기록이 사라짐. 별도 archive 가 필요한가?
2. ETL 트리거 시점 — 자동 (app 시작 시) vs 수동 (설정 버튼). 현 default 는 수동.
3. 코인 전용 `cryptoCandles`/`cryptoInstruments` 보존 vs cleanup — 시세 캐시는 stock 동등 부재.

## Verification

```bash
# R1-1 후
pnpm typecheck && pnpm test  # 회귀 0 + 새 ETL 테스트 fixture 통과
# R1-2 후
pnpm test src/main/db/migration-0022-crypto-etl.test.ts  # ETL 시나리오 검증
```
