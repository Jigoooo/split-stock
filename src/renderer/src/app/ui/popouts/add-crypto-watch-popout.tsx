import { consumeAddCryptoWatchPrefill } from '@renderer/pages/main/model/crypto-watch-popout-prefill';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, Checkbox, Select, TextInput } from '@renderer/shared/ui';
import {
  type CryptoAutoWatchEntryCondition,
  type CryptoAutoWatchStatus,
  type CryptoKrwMarketCode,
  type CryptoStrategyProfile,
  createCryptoStrategyRules,
  createDefaultCryptoStrategyProfile,
  DEFAULT_CRYPTO_MARKET,
} from '@shared/contracts';
import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';

const sanitizeDecimal = (value: string): string => {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
};

export const AddCryptoWatchPopout = (): ReactElement => {
  const contentRef = useRef<HTMLDivElement>(null);
  const payload = useMemo(() => {
    try {
      return consumeAddCryptoWatchPrefill();
    } catch {
      return null;
    }
  }, []);
  const accountId = payload?.accountId ?? 0;
  const [market, setMarket] = useState<CryptoKrwMarketCode>(
    payload?.market ?? (DEFAULT_CRYPTO_MARKET as CryptoKrwMarketCode),
  );
  const [label, setLabel] = useState('');
  const [status, setStatus] = useState<CryptoAutoWatchStatus>('PAUSED');
  const [entryType, setEntryType] = useState<CryptoAutoWatchEntryCondition['type']>('immediate');
  const [entryPrice, setEntryPrice] = useState('');
  const [maxStages, setMaxStages] = useState('3');
  const [amountKrw, setAmountKrw] = useState('5000');
  const [dropPct, setDropPct] = useState('0.03');
  const [profitPct, setProfitPct] = useState('0.02');
  const [autoBuyEnabled, setAutoBuyEnabled] = useState(true);
  const [autoSellEnabled, setAutoSellEnabled] = useState(true);
  const [maxOrderKrw, setMaxOrderKrw] = useState('5000');
  const [maxExposureKrw, setMaxExposureKrw] = useState('50000');

  const watchQuery = trpc.crypto.getAutoWatch.useQuery(
    { accountId, id: payload?.watchId ?? 0 },
    { enabled: accountId > 0 && payload?.watchId !== undefined },
  );
  // RALPLAN P6 #8 — UPBIT KRW 마켓 검색용 자동완성 데이터 (코인명/마켓 코드 모두 매칭).
  const marketsQuery = trpc.crypto.listMarkets.useQuery(
    { quoteCurrency: 'KRW', limit: 200 },
    { staleTime: 5 * 60_000 },
  );
  const marketOptions = useMemo(() => {
    const data = marketsQuery.data;
    const entries = data && 'entries' in data ? data.entries : [];
    return entries
      .map((m) => ({
        value: m.market,
        label: `${m.market} · ${m.koreanName ?? m.englishName ?? ''}`,
      }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }, [marketsQuery.data]);
  const createWatch = trpc.crypto.createAutoWatch.useMutation();
  const updateWatch = trpc.crypto.updateAutoWatch.useMutation();

  useEffect(() => {
    document.title = payload?.watchId
      ? 'Split Stock · 코인 자동감시 수정'
      : 'Split Stock · 코인 자동감시 추가';
  }, [payload?.watchId]);

  useEffect(() => {
    const watch = watchQuery.data?.watch;
    if (!watch) return;
    setMarket(watch.market);
    setLabel(watch.label ?? '');
    setStatus(watch.status === 'CANCELLED' ? 'PAUSED' : watch.status);
    setEntryType(watch.entryCondition.type);
    setEntryPrice(watch.entryCondition.price ?? '');
    setMaxStages(String(watch.strategy.maxStages));
    setAmountKrw(watch.strategy.buyRules[0]?.amountKrw ?? '5000');
    setDropPct(watch.strategy.buyRules[1]?.triggerDropPct ?? '0.03');
    setProfitPct(watch.strategy.sellRules[0]?.targetProfitPct ?? '0.02');
    setAutoBuyEnabled(watch.strategy.autoBuyEnabled);
    setAutoSellEnabled(watch.strategy.autoSellEnabled);
    setMaxOrderKrw(watch.config.maxOrderKrw);
    setMaxExposureKrw(watch.config.maxTotalExposureKrw);
  }, [watchQuery.data?.watch]);

  useEffect(() => {
    const shell = window.appShell;
    const node = contentRef.current;
    if (!shell?.fitContentHeight || !node) return;
    let frameId = 0;
    const resizeToContent = (): void => {
      if (frameId !== 0) return;
      frameId = window.requestAnimationFrame(() => {
        frameId = 0;
        void shell.fitContentHeight(Math.ceil(node.getBoundingClientRect().height));
      });
    };
    resizeToContent();
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(node);
    return () => {
      if (frameId !== 0) window.cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, []);

  const buildProfile = (): CryptoStrategyProfile => {
    const stages = Math.max(1, Math.min(50, Number(maxStages) || 1));
    return {
      ...createDefaultCryptoStrategyProfile(market),
      market,
      maxStages: stages,
      ...createCryptoStrategyRules(stages, {
        amountKrw: amountKrw || '5000',
        dropPct: dropPct || '0.03',
        profitPct: profitPct || '0.02',
      }),
      autoBuyEnabled,
      autoSellEnabled,
    };
  };

  const save = async (): Promise<void> => {
    const input = {
      accountId,
      ...(payload?.watchId !== undefined ? { id: payload.watchId } : {}),
      market,
      label: label.trim() || undefined,
      status,
      entryCondition: {
        type: entryType,
        price: entryType === 'immediate' ? null : entryPrice || null,
      },
      strategy: buildProfile(),
      guard: {
        maxOrderKrw: maxOrderKrw || '5000',
        maxTotalExposureKrw: maxExposureKrw || '50000',
      },
    };
    if (payload?.watchId !== undefined) await updateWatch.mutateAsync(input);
    else await createWatch.mutateAsync(input);
    window.appShell?.broadcastAccountChanged?.(accountId);
    window.close();
  };

  const pending = createWatch.isPending || updateWatch.isPending;

  return (
    <div ref={contentRef} className="panel add-watch-order-dialog add-crypto-watch-popout">
      <div className="panel__title">
        {payload?.watchId ? '코인 자동감시 수정' : '코인 자동감시 추가'}
      </div>
      <div className="panel__body add-crypto-watch-popout__body">
        <div className="add-crypto-watch-popout__field">
          <span className="muted">마켓</span>
          <TextInput
            aria-label="코인 자동감시 마켓"
            dense
            list="add-crypto-watch-markets"
            placeholder="KRW-BTC 또는 비트코인"
            value={market}
            onChange={(event) => setMarket(event.target.value.toUpperCase() as CryptoKrwMarketCode)}
          />
          <datalist id="add-crypto-watch-markets">
            {marketOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </datalist>
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">별칭</span>
          <TextInput
            aria-label="코인 자동감시 별칭"
            dense
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">초기 상태</span>
          <Select
            aria-label="코인 자동감시 초기 상태"
            dense
            value={status}
            onChange={(event) => setStatus(event.target.value as CryptoAutoWatchStatus)}
          >
            <option value="PAUSED">중지</option>
            <option value="WATCHING">감시중</option>
          </Select>
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">최초 매수 감시 조건</span>
          <Select
            aria-label="최초 매수 감시 조건"
            dense
            value={entryType}
            onChange={(event) =>
              setEntryType(event.target.value as CryptoAutoWatchEntryCondition['type'])
            }
          >
            <option value="immediate">즉시</option>
            <option value="price-below">가격 이하</option>
            <option value="price-above">가격 이상</option>
          </Select>
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">감시 가격</span>
          <TextInput
            aria-label="감시 가격"
            dense
            disabled={entryType === 'immediate'}
            value={entryPrice}
            onChange={(event) => setEntryPrice(sanitizeDecimal(event.target.value))}
          />
        </div>
        <div className="add-crypto-watch-popout__checks">
          <Checkbox
            checked={autoBuyEnabled}
            onChange={(event) => setAutoBuyEnabled(event.currentTarget.checked)}
            label="자동매수"
          />
          <Checkbox
            checked={autoSellEnabled}
            onChange={(event) => setAutoSellEnabled(event.currentTarget.checked)}
            label="자동매도"
          />
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">최대 관리차수</span>
          <TextInput
            aria-label="최대 관리차수"
            dense
            value={maxStages}
            onChange={(event) => setMaxStages(sanitizeDecimal(event.target.value))}
          />
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">차수별 매수금액</span>
          <TextInput
            aria-label="차수별 매수금액"
            dense
            value={amountKrw}
            onChange={(event) => setAmountKrw(sanitizeDecimal(event.target.value))}
          />
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">2차 이후 하락률</span>
          <TextInput
            aria-label="2차 이후 하락률"
            dense
            value={dropPct}
            onChange={(event) => setDropPct(sanitizeDecimal(event.target.value))}
          />
        </div>
        <div className="add-crypto-watch-popout__field">
          <span className="muted">차수별 익절률</span>
          <TextInput
            aria-label="차수별 익절률"
            dense
            value={profitPct}
            onChange={(event) => setProfitPct(sanitizeDecimal(event.target.value))}
          />
        </div>
        <div className="form-sticky-action-bar">
          <Button dense onClick={() => window.close()}>
            취소
          </Button>
          <Button
            dense
            variant="primary"
            loading={pending}
            disabled={accountId <= 0}
            onClick={() => void save()}
          >
            저장
          </Button>
        </div>
      </div>
    </div>
  );
};
