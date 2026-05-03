import { Button, Checkbox, SegmentedToggle, Select, TextInput } from '@renderer/shared/ui';
import type { ReactElement } from 'react';
import { formatCryptoAmount, formatCryptoVolume } from '../model/crypto-format';

type Side = 'bid' | 'ask';
type Mode = 'limit' | 'market';

const sanitizeDecimal = (value: string): string => {
  const normalized = value.replace(/[^0-9.]/g, '');
  const [whole = '', ...fractions] = normalized.split('.');
  return fractions.length > 0 ? `${whole}.${fractions.join('')}` : whole;
};

export const CryptoOrderTicket = ({
  advancedOpen,
  availableBase,
  availableQuote,
  baseCurrency,
  canBuy,
  canSell,
  error,
  mode,
  onAdvancedOpenChange,
  onModeChange,
  onPriceChange,
  onSmpTypeChange,
  onSubmit,
  onTimeInForceChange,
  onVolumeChange,
  pending,
  price,
  quoteCurrency,
  side,
  smpType,
  timeInForce,
  volume,
}: {
  advancedOpen: boolean;
  /** 매도가능 base 통화 잔고 (BTC 등) */
  availableBase: string;
  /** 매수가능 quote 통화 잔고 (KRW 등) */
  availableQuote: string;
  baseCurrency: string;
  canBuy: boolean;
  canSell: boolean;
  error: string | null;
  mode: Mode;
  onAdvancedOpenChange: (open: boolean) => void;
  onModeChange: (mode: Mode) => void;
  onPriceChange: (value: string) => void;
  onSmpTypeChange: (value: string) => void;
  onSubmit: (side: Side) => Promise<void>;
  onTimeInForceChange: (value: string) => void;
  onVolumeChange: (value: string) => void;
  pending: boolean;
  price: string;
  quoteCurrency: string;
  side: Side;
  smpType: string;
  timeInForce: string;
  volume: string;
}): ReactElement => (
  <section className="panel order-ticket-form" aria-label="즉시 주문 티켓">
    <div className="panel__title">즉시 주문</div>
    <div className="order-ticket-form__scroll">
      <div className="panel__body order-ticket-form__content">
        <div className="order-ticket-form__field">
          <span className="order-ticket-form__label">구분</span>
          <SegmentedToggle
            ariaLabel="주문 유형"
            value={mode}
            onChange={onModeChange}
            dense
            fullWidth
            items={[
              { value: 'limit', label: '지정가' },
              { value: 'market', label: '시장가' },
            ]}
          />
        </div>
        <label className="order-ticket-form__field" htmlFor="crypto-order-price">
          <span className="order-ticket-form__label">
            {mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
          </span>
          <TextInput
            id="crypto-order-price"
            aria-label={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
            value={price}
            onChange={(event) => onPriceChange(sanitizeDecimal(event.target.value))}
            placeholder={mode === 'market' && side === 'bid' ? '주문금액' : '가격'}
            dense
            disabled={mode === 'market' && side === 'ask'}
          />
        </label>
        <label className="order-ticket-form__field" htmlFor="crypto-order-volume">
          <span className="order-ticket-form__label">수량</span>
          <TextInput
            id="crypto-order-volume"
            aria-label="수량"
            value={volume}
            onChange={(event) => onVolumeChange(sanitizeDecimal(event.target.value))}
            placeholder="수량"
            dense
            disabled={mode === 'market' && side === 'bid'}
          />
          <span className="muted order-ticket-form__hint">
            <span>
              매수가능{' '}
              <span className="num">
                {formatCryptoAmount(availableQuote, quoteCurrency)} {quoteCurrency}
              </span>
            </span>
            <span>
              매도가능{' '}
              <span className="num">
                {formatCryptoVolume(availableBase)} {baseCurrency}
              </span>
            </span>
          </span>
        </label>
        <Checkbox
          checked={advancedOpen}
          onChange={(event) => onAdvancedOpenChange(event.currentTarget.checked)}
          label="고급 주문 옵션"
        />
        {advancedOpen ? (
          <div style={{ display: 'grid', gap: '0.45rem' }}>
            <Select
              aria-label="Time in force"
              value={timeInForce}
              onChange={(event) => onTimeInForceChange(event.target.value)}
              dense
            >
              <option value="">없음</option>
              <option value="ioc">IOC</option>
              <option value="fok">FOK</option>
              <option value="post_only">Post only</option>
            </Select>
            <Select
              aria-label="SMP"
              value={smpType}
              onChange={(event) => onSmpTypeChange(event.target.value)}
              dense
              disabled={timeInForce === 'post_only'}
            >
              <option value="">없음</option>
              <option value="reduce">Reduce</option>
              <option value="cancel_maker">Cancel maker</option>
              <option value="cancel_taker">Cancel taker</option>
            </Select>
          </div>
        ) : null}
        {error ? <span className="chip chip--down">{error}</span> : null}
        <div className="panel__body order-ticket-form__actions">
          <Button
            variant="primary"
            loading={pending}
            loadingText="전송 중…"
            disabled={!canBuy}
            onClick={() => {
              void onSubmit('bid');
            }}
            dense
          >
            매수
          </Button>
          <Button
            variant="destructive"
            loading={pending}
            loadingText="전송 중…"
            disabled={!canSell}
            onClick={() => {
              void onSubmit('ask');
            }}
            dense
          >
            매도
          </Button>
        </div>
      </div>
    </div>
  </section>
);
