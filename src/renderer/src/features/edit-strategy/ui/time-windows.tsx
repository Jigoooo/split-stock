import { useActiveAccountId } from '@renderer/entities/account';
import {
  hhmmToMinutes,
  minutesToHHMM,
  type TradeSide,
  type TradeSlot,
  useTradingWindows,
} from '@renderer/entities/trading-window';
import { trpc } from '@renderer/shared/api/trpc';
import { Button, Switch, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { useState, useTransition } from 'react';

interface SlotRowProps {
  side: TradeSide;
  slot: TradeSlot;
  enabled: boolean;
  startMinute: number;
  endMinute: number;
  accountId: number;
  onMutated: () => void;
}

const SlotRow = ({
  side,
  slot,
  enabled,
  startMinute,
  endMinute,
  accountId,
  onMutated,
}: SlotRowProps): ReactElement => {
  const [startRaw, setStartRaw] = useState(() => minutesToHHMM(startMinute));
  const [endRaw, setEndRaw] = useState(() => minutesToHHMM(endMinute));
  const [startErr, setStartErr] = useState('');
  const [endErr, setEndErr] = useState('');
  const [isPending, startTransition] = useTransition();

  const upsert = trpc.tradingWindows.upsert.useMutation({ onSuccess: onMutated });

  const handleToggle = (checked: boolean): void => {
    const s = hhmmToMinutes(startRaw);
    const e = hhmmToMinutes(endRaw);
    if (s === null || e === null) return;
    startTransition(() => {
      upsert.mutate({ accountId, side, slot, enabled: checked, startMinute: s, endMinute: e });
    });
  };

  const handleSave = (): void => {
    const s = hhmmToMinutes(startRaw);
    const e = hhmmToMinutes(endRaw);
    let hasErr = false;
    if (s === null) {
      setStartErr('HH:MM 형식으로 입력하세요');
      hasErr = true;
    } else {
      setStartErr('');
    }
    if (e === null) {
      setEndErr('HH:MM 형식으로 입력하세요');
      hasErr = true;
    } else {
      setEndErr('');
    }
    if (hasErr || s === null || e === null) return;
    startTransition(() => {
      upsert.mutate({ accountId, side, slot, enabled, startMinute: s, endMinute: e });
    });
  };

  const startId = `tw-${side}-${slot}-start`;
  const endId = `tw-${side}-${slot}-end`;

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(10rem, 1fr) minmax(9rem, 11rem) minmax(9rem, 11rem) auto auto',
        gap: '0.6rem',
        alignItems: 'center',
        padding: '0.8rem',
        border: '0.1rem solid var(--border)',
        borderRadius: '0.6rem',
        background: enabled ? 'var(--bg)' : 'var(--bg-2)',
        opacity: enabled ? 1 : 0.72,
      }}
    >
      <div style={{ display: 'grid', gap: '0.2rem', minWidth: 0 }}>
        <span style={{ fontWeight: 700 }}>{slot}차 매수 시간대</span>
        <span className="muted" style={{ fontSize: '1.05rem' }}>
          자동매수 주문 제출 허용 구간
        </span>
      </div>
      <div style={{ display: 'grid', gap: '0.15rem' }}>
        <label htmlFor={startId} className="muted" style={{ fontSize: '1.0rem' }}>
          시작
        </label>
        <TextInput
          id={startId}
          value={startRaw}
          onChange={(e) => setStartRaw(e.target.value)}
          placeholder="09:00"
          aria-label={`${side} 슬롯 ${slot} 시작 시간`}
          disabled={!enabled || isPending}
          dense
        />
        {startErr ? (
          <span className="chip chip--down" role="alert" style={{ fontSize: '1.0rem' }}>
            {startErr}
          </span>
        ) : null}
      </div>
      <div style={{ display: 'grid', gap: '0.15rem' }}>
        <label htmlFor={endId} className="muted" style={{ fontSize: '1.0rem' }}>
          종료
        </label>
        <TextInput
          id={endId}
          value={endRaw}
          onChange={(e) => setEndRaw(e.target.value)}
          placeholder="15:30"
          aria-label={`${side} 슬롯 ${slot} 종료 시간`}
          disabled={!enabled || isPending}
          dense
        />
        {endErr ? (
          <span className="chip chip--down" role="alert" style={{ fontSize: '1.0rem' }}>
            {endErr}
          </span>
        ) : null}
      </div>
      <Button onClick={handleSave} disabled={!enabled || isPending} dense aria-label="저장">
        저장
      </Button>
      <Switch
        checked={enabled}
        onChange={handleToggle}
        disabled={isPending}
        label={enabled ? '사용' : '끄기'}
        aria-label={`${side} 슬롯 ${slot} 사용 여부`}
      />
    </div>
  );
};

interface SideSectionProps {
  side: TradeSide;
  accountId: number;
  windows: ReturnType<typeof useTradingWindows>['windows'];
  onMutated: () => void;
}

const SideSection = ({ side, accountId, windows, onMutated }: SideSectionProps): ReactElement => {
  const slots: TradeSlot[] = [1, 2, 3];

  return (
    <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
      <legend className="muted" style={{ fontWeight: 600, marginBottom: '0.4rem' }}>
        매수 허용 시간대
      </legend>
      <div style={{ display: 'grid', gap: '0.5rem' }}>
        {slots.map((slot) => {
          const existing = windows.find((w) => w.side === side && w.slot === slot);
          return (
            <SlotRow
              key={`${side}-${slot}`}
              side={side}
              slot={slot}
              enabled={existing?.enabled ?? false}
              startMinute={existing?.startMinute ?? 540}
              endMinute={existing?.endMinute ?? 930}
              accountId={accountId}
              onMutated={onMutated}
            />
          );
        })}
      </div>
    </fieldset>
  );
};

/**
 * 매매 시간대 설정 폼.
 * 자동매수 슬롯 1~3, 슬롯 미설정 시 항상 허용.
 */
export const TimeWindows = (): ReactElement => {
  const { accountId } = useActiveAccountId();
  const utils = trpc.useUtils();
  const { isPending, error, windows } = useTradingWindows(accountId);

  const refetch = (): void => {
    void utils.tradingWindows.list.invalidate();
  };

  if (accountId === null) {
    return (
      <section aria-label="매매시간대">
        <p className="muted">활성 계좌가 없습니다.</p>
      </section>
    );
  }

  if (isPending) {
    return (
      <section aria-label="매매시간대">
        <p className="muted">로딩 중…</p>
      </section>
    );
  }

  if (error) {
    return (
      <section aria-label="매매시간대">
        <p className="chip chip--down" role="alert">
          {error.message}
        </p>
      </section>
    );
  }

  return (
    <section aria-label="매매시간대" style={{ display: 'grid', gap: '1rem' }}>
      <div className="muted" style={{ fontSize: '1.1rem', fontWeight: 600 }}>
        자동매수 허용 시간대 (슬롯 미설정 시 항상 허용)
      </div>
      <SideSection side="BUY" accountId={accountId} windows={windows} onMutated={refetch} />
    </section>
  );
};
