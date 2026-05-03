import { useActiveAccountId } from '@renderer/entities/account';
import {
  formatCryptoAmount,
  formatCryptoPrice,
  formatCryptoVolume,
  getCryptoQuote,
} from '@renderer/pages/main/model/crypto-format';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, Checkbox, dialog, Select, TextInput } from '@renderer/shared/ui';
import { type ReactElement, useEffect, useMemo, useState } from 'react';

type AutoMode = 'disabled' | 'dry-run' | 'live-small';

const sanitizeDecimal = (value: string): string => {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
};

const formatDateTime = (timestamp: number | null | undefined): string => {
  if (timestamp === null || timestamp === undefined) return '-';
  return new Date(timestamp).toLocaleString('ko-KR', { hour12: false });
};

/**
 * 코인 자동매매 운영 컨트롤(보호 설정·smoke·소액 실거래·루프 시작/중지)을 모은 고급/안전 탭.
 * 메인 화면의 자동매매 설정 패널이 국내주식과 동일한 인지 모델을 갖도록 운영 안전 장치는
 * 이 섹션으로 격리된다. (RALPLAN P0)
 */
export const CryptoAdvancedSettingsSection = (): ReactElement => {
  const { accountId: rawAccountId } = useActiveAccountId();
  const accountId = rawAccountId ?? 0;
  const utils = trpc.useUtils();

  const watchesQuery = trpc.crypto.listAutoWatches.useQuery(
    { accountId },
    { enabled: accountId > 0 },
  );
  const watches = watchesQuery.data?.watches ?? [];
  const markets = useMemo(() => {
    const set = new Set<string>();
    for (const watch of watches) set.add(watch.market);
    return Array.from(set);
  }, [watches]);

  const [market, setMarket] = useState<string>('');
  useEffect(() => {
    const first = markets[0];
    if (market === '' && first !== undefined) setMarket(first);
  }, [market, markets]);

  const statusQuery = trpc.crypto.getAutoStatus.useQuery(
    { accountId, market },
    { enabled: accountId > 0 && market.length > 0 },
  );

  const [mode, setMode] = useState<AutoMode>('disabled');
  const [emergencyDisabled, setEmergencyDisabled] = useState(false);
  const [maxOrderKrw, setMaxOrderKrw] = useState('5000');
  const [maxExposureKrw, setMaxExposureKrw] = useState('50000');

  useEffect(() => {
    const config = statusQuery.data?.config;
    if (!config) return;
    setMode(config.mode === 'dry-run' ? 'disabled' : config.mode);
    setEmergencyDisabled(config.emergencyDisabled);
    setMaxOrderKrw(config.maxOrderKrw);
    setMaxExposureKrw(config.maxTotalExposureKrw);
  }, [statusQuery.data?.config]);

  const saveAutoConfig = trpc.crypto.saveAutoConfig.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
    },
  });
  const runAutoLiveTick = trpc.crypto.runAutoLiveTick.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
    },
  });
  const startAuto = trpc.crypto.startAuto.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
    },
  });
  const stopAuto = trpc.crypto.stopAuto.useMutation({
    onSuccess: () => {
      void utils.crypto.getAutoStatus.invalidate({ accountId, market });
    },
  });

  const pending =
    saveAutoConfig.isPending ||
    runAutoLiveTick.isPending ||
    startAuto.isPending ||
    stopAuto.isPending;

  const gate = statusQuery.data?.gate ?? { ok: false, blockedReasons: ['상태 로드 전'] };
  const running = statusQuery.data?.runtimeRunning ?? false;
  const liveLots = statusQuery.data?.liveLots ?? [];
  const events = statusQuery.data?.recentEvents ?? [];
  const quote = market.length > 0 ? getCryptoQuote(market) : 'KRW';

  const handleSave = (): void => {
    if (market.length === 0) return;
    saveAutoConfig.mutate({
      accountId,
      market,
      config: {
        mode,
        emergencyDisabled,
        maxOrderKrw,
        maxTotalExposureKrw: maxExposureKrw,
      },
    });
  };

  const handleRunLive = (): void => {
    if (market.length === 0) return;
    void dialog
      .openAsync({
        type: 'WARNING',
        title: '코인 자동감시 live-small 실행',
        confirmText: '소액 live 실행',
        cancelText: '취소',
        isCancelWith: true,
        message: `${market} 자동감시 live-small 1 tick을 실행합니다.`,
      })
      .then((confirmed) => {
        if (confirmed) runAutoLiveTick.mutate({ accountId, market });
      });
  };

  if (markets.length === 0) {
    return (
      <div className="panel">
        <div className="panel__title">코인 자동매매 고급/안전</div>
        <div className="panel__body muted">
          {watchesQuery.isPending
            ? '자동감시 목록 로드 중…'
            : '등록된 코인 자동감시가 없습니다. 메인 화면에서 자동감시를 먼저 추가하세요.'}
        </div>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel__title">코인 자동매매 고급/안전</div>
      <div className="panel__body" style={{ display: 'grid', gap: '0.8rem' }}>
        <label
          htmlFor="crypto-advanced-market"
          style={{ display: 'grid', gap: '0.3rem', maxWidth: '20rem' }}
        >
          <span className="muted">마켓</span>
          <Select
            id="crypto-advanced-market"
            aria-label="고급 설정 대상 마켓"
            dense
            value={market}
            onChange={(event) => setMarket(event.target.value)}
          >
            {markets.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        </label>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <Checkbox
            checked={emergencyDisabled}
            onChange={(event) => setEmergencyDisabled(event.currentTarget.checked)}
            label="비상 중지"
          />
          <span className={running ? 'chip chip--live' : 'chip'}>
            {running ? '루프 실행 중' : '루프 중지'}
          </span>
          <span className={gate.ok ? 'chip chip--live' : 'chip chip--down'}>
            {gate.ok ? '실거래 조건 통과' : '실거래 조건 차단'}
          </span>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '0.6rem',
          }}
        >
          <label htmlFor="crypto-advanced-max-order-krw" style={{ display: 'grid', gap: '0.3rem' }}>
            <span className="muted">주문당 상한</span>
            <TextInput
              id="crypto-advanced-max-order-krw"
              aria-label="주문당 상한"
              dense
              value={maxOrderKrw}
              onChange={(event) => setMaxOrderKrw(sanitizeDecimal(event.target.value))}
            />
          </label>
          <label
            htmlFor="crypto-advanced-max-exposure-krw"
            style={{ display: 'grid', gap: '0.3rem' }}
          >
            <span className="muted">총 노출 상한</span>
            <TextInput
              id="crypto-advanced-max-exposure-krw"
              aria-label="총 노출 상한"
              dense
              value={maxExposureKrw}
              onChange={(event) => setMaxExposureKrw(sanitizeDecimal(event.target.value))}
            />
          </label>
        </div>

        {gate.blockedReasons.length > 0 ? (
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {gate.blockedReasons.map((reason) => (
              <span key={reason} className="chip chip--down">
                {reason}
              </span>
            ))}
          </div>
        ) : null}

        <div
          style={{
            display: 'flex',
            gap: '0.8rem',
            color: 'var(--text-muted, #888)',
            flexWrap: 'wrap',
            fontSize: '0.85em',
          }}
        >
          <span>
            read-only smoke {formatDateTime(statusQuery.data?.config.lastReadonlySmokeAt)}
          </span>
          <span>마지막 내부 검증 {formatDateTime(statusQuery.data?.config.lastDryRunAt)}</span>
          <span>
            마지막 실거래 실행 {formatDateTime(statusQuery.data?.config.lastLiveActionAt)}
          </span>
        </div>

        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <Button dense loading={pending} onClick={handleSave}>
            보호 설정 저장
          </Button>
          <Button
            dense
            disabled={pending || !gate.ok}
            variant="destructive"
            onClick={handleRunLive}
          >
            소액 실거래 1회
          </Button>
          <Button
            dense
            disabled={pending || running || (mode === 'live-small' && !gate.ok)}
            onClick={() => startAuto.mutate({ accountId, market })}
          >
            루프 시작
          </Button>
          <Button
            dense
            disabled={pending || !running}
            onClick={() => stopAuto.mutate({ accountId, market })}
          >
            루프 중지
          </Button>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '0.8rem',
          }}
        >
          <div>
            <strong>실거래 차수</strong>
            {liveLots.length === 0 ? <p className="muted">실거래 차수 없음</p> : null}
            {liveLots.slice(0, 4).map((lot) => (
              <p key={lot.id}>
                #{lot.sequence} {formatCryptoVolume(lot.quantity)} · 평단{' '}
                {formatCryptoPrice(lot.avgEntryKrw, market)} · 배정{' '}
                {formatCryptoAmount(lot.allocatedKrw, quote)}
              </p>
            ))}
          </div>
          <div>
            <strong>최근 판단</strong>
            {events.length === 0 ? <p className="muted">판단 이력 없음</p> : null}
            {events.slice(0, 4).map((event) => (
              <p key={event.id}>
                {formatDateTime(event.createdAt)} · {event.action} · {event.reason}
              </p>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
