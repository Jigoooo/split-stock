import { TextInput } from '@renderer/shared/ui';
import { Search } from 'lucide-react';
import { type ReactElement, useState } from 'react';
import { formatCryptoAmount, formatCryptoPrice } from '../model/crypto-format';
import { formatPercent, formatSignedPrice } from '../model/crypto-formatters';

const CRYPTO_AUTOCOMPLETE_LIMIT = 8;

export const CryptoMarketBar = ({
  market,
  markets,
  onMarketChange,
  onTermChange,
  quote,
  selectedName,
  term,
  ticker,
  tickerFallback,
}: {
  market: string;
  markets: Array<{ koreanName: string; market: string }>;
  onMarketChange: (market: string) => void;
  onTermChange: (term: string) => void;
  quote: string;
  selectedName: string;
  term: string;
  ticker: {
    accTradePrice24h?: string;
    highPrice?: string;
    lowPrice?: string;
    openingPrice?: string;
    signedChangePrice?: string;
    signedChangeRate?: string;
    tradePrice?: string;
  } | null;
  tickerFallback: boolean;
}): ReactElement => {
  const [focused, setFocused] = useState(false);
  const visibleMarkets = markets.slice(0, CRYPTO_AUTOCOMPLETE_LIMIT);
  const showDropdown = focused && term.trim().length > 0;
  const commit = (nextMarket: string): void => {
    onMarketChange(nextMarket);
    onTermChange(nextMarket);
    setFocused(false);
  };

  return (
    <div className="panel crypto-market-bar">
      <div className="crypto-market-bar__autocomplete">
        <TextInput
          aria-label="코인 검색"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          value={term}
          onChange={(event) => onTermChange(event.target.value.toUpperCase())}
          onFocus={() => setFocused(true)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const first = visibleMarkets[0];
              if (first) commit(first.market);
            }
            if (event.key === 'Escape') setFocused(false);
          }}
          dense
          iconLeading={<Search size={14} />}
          placeholder="코인을 검색하세요"
          className="crypto-market-bar__search"
        />
        {showDropdown ? (
          <div
            className="panel crypto-market-bar__dropdown"
            role="listbox"
            aria-label="코인 검색 결과"
          >
            {visibleMarkets.length === 0 ? (
              <div className="panel__body muted">결과 없음</div>
            ) : (
              visibleMarkets.map((entry) => (
                <button
                  key={entry.market}
                  type="button"
                  role="option"
                  aria-selected={entry.market === market}
                  className={entry.market === market ? 'hts-btn hts-btn--primary' : 'hts-btn'}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    commit(entry.market);
                  }}
                >
                  <span className="num">{entry.market}</span>
                  <span>{entry.koreanName}</span>
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
      <span className="chip chip--up">
        {selectedName} ({market})
      </span>
      <span style={{ flex: 1 }} />
      <div className="crypto-market-bar__quotes">
        <strong
          className={[
            'crypto-market-bar__price',
            Number(ticker?.signedChangePrice ?? 0) < 0 ? 'num-down' : 'num-up',
          ].join(' ')}
        >
          현재가 {formatCryptoPrice(ticker?.tradePrice, market)} {quote}
        </strong>
        <span className="muted crypto-market-bar__change">
          {formatSignedPrice(ticker?.signedChangePrice, market)} ·{' '}
          {formatPercent(ticker?.signedChangeRate)}
        </span>
        <span>
          <span className="muted">시</span>{' '}
          <span className="num">{formatCryptoPrice(ticker?.openingPrice, market)}</span>
        </span>
        <span>
          <span className="muted">고</span>{' '}
          <span className="num num-up">{formatCryptoPrice(ticker?.highPrice, market)}</span>
        </span>
        <span>
          <span className="muted">저</span>{' '}
          <span className="num num-down">{formatCryptoPrice(ticker?.lowPrice, market)}</span>
        </span>
        <span>
          <span className="muted">거래대금</span>{' '}
          <span className="num">{formatCryptoAmount(ticker?.accTradePrice24h, quote)}</span>
        </span>
      </div>
      <span className={tickerFallback ? 'chip chip--down' : 'chip chip--live'}>
        {tickerFallback ? 'REST 폴백' : '실시간'}
      </span>
    </div>
  );
};
