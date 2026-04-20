import type { LotEntry } from '@renderer/entities/account';
import { trpc } from '@renderer/shared/api/trpc';
import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { LineChart } from 'lucide-react';
import { type CSSProperties, type ReactElement, useTransition } from 'react';
import type { PositionsGridRow } from '../model/use-positions-grid';
import { LotStageCells } from './lot-stage-cells';

export interface PositionRowProps {
  row: PositionsGridRow;
  /** 그리드 전체 차수 컬럼 수. */
  gridMaxStages: number;
  /** 현재 선택된 종목 코드 (시각적 강조용). */
  selectedPdno: string | null;
  /** 현재 expand 상태. */
  expanded: boolean;
  /** [+] 클릭 → expand toggle. useTransition 으로 deferred 처리. */
  onToggleExpand: (pdno: string) => void;
  /** 행 클릭 → 종목 선택. */
  onSelect: (pdno: string) => void;
  /** 차트 아이콘 클릭 → trade popout + 종목 assign. */
  onChartPopout?: (pdno: string, name: string) => void;
  /** 가상화 스타일 (absolute positioning). */
  style?: CSSProperties;
  /** 활성 계좌 ID — toggleSymbol mutation 에 필요. */
  accountId: number;
  /**
   * 종목별 자동매매 상태.
   * - true: 명시적 ON
   * - false: 명시적 OFF
   * - null: 미지정 (기본값 — master ON 이면 거래 가능)
   */
  autoOn: boolean | null;
}

/**
 * 한 종목 행. 메인 행 + (expanded 면) 차수별 sub-row.
 * 컬럼 순서: [+] / 종목명 / 등락 / 수량 / 매입가 / 현재가 / 평가손익 / 수익률 / 매입금액 / 평가금액 / 자동 / 1차 / 2차 / ... / N차
 */
export const PositionRow = (props: PositionRowProps): ReactElement => {
  const {
    accountId,
    autoOn,
    expanded,
    gridMaxStages,
    onChartPopout,
    onSelect,
    onToggleExpand,
    row,
    selectedPdno,
    style,
  } = props;
  const [isPending, startTransition] = useTransition();

  const utils = trpc.useUtils();
  const toggleSymbol = trpc.safety.toggleSymbol.useMutation({
    onSuccess: () => utils.safety.getState.invalidate({ accountId }),
  });
  const { lots, position } = row;
  const isSelected = selectedPdno === position.code;

  const sign = position.pnlAmount === 0 ? 'flat' : position.pnlAmount > 0 ? 'up' : 'down';
  const pnlColorClass = sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';

  const buyAmount = position.qty * position.avgPrice;

  const handleToggle = (): void => {
    startTransition(() => onToggleExpand(position.code));
  };

  return (
    <div style={style} data-position-row={position.code}>
      <table className="hts-table" style={{ tableLayout: 'fixed', width: '100%', marginBottom: 0 }}>
        <colgroup>
          <col style={{ width: '2.4rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '6rem' }} />
          <col style={{ width: '6rem' }} />
          <col style={{ width: '7rem' }} />
          <col style={{ width: '5rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '8rem' }} />
          <col style={{ width: '3.2rem' }} />
          {stageColumnWidths(gridMaxStages).map((nth) => (
            <col key={`stage-col-${nth}`} style={{ width: '5.5rem' }} />
          ))}
          <col style={{ width: '2.8rem' }} />
        </colgroup>
        <tbody>
          <tr
            data-selected={isSelected}
            onClick={() => onSelect(position.code)}
            style={{ cursor: 'pointer' }}
          >
            <td>
              <button
                type="button"
                aria-label={expanded ? '차수 접기' : '차수 펼치기'}
                aria-expanded={expanded}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggle();
                }}
                disabled={isPending}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
                  borderRadius: 2,
                  width: '1.6rem',
                  height: '1.6rem',
                  cursor: 'pointer',
                  fontFamily: 'monospace',
                  fontSize: '1rem',
                  lineHeight: 1,
                  padding: 0,
                }}
              >
                {expanded ? '−' : '+'}
              </button>
            </td>
            <td>{position.name}</td>
            <td className={`num ${pnlColorClass}`}>{position.pnlRate.toFixed(2)}%</td>
            <td className="num">{thousandSeparator(position.qty)}</td>
            <td className="num">{thousandSeparator(position.avgPrice)}</td>
            <td className="num">{thousandSeparator(position.currentPrice)}</td>
            <td className={`num ${pnlColorClass}`}>{formatSigned(position.pnlAmount)}</td>
            <td className={`num ${pnlColorClass}`}>{position.pnlRate.toFixed(2)}%</td>
            <td className="num">{thousandSeparator(Math.round(buyAmount))}</td>
            <td className="num">{thousandSeparator(Math.round(position.evalAmount))}</td>
            <td>
              <button
                type="button"
                aria-label={`${position.name} 자동매매 ${autoOn === false ? 'OFF' : 'ON'}`}
                aria-pressed={autoOn !== false}
                disabled={toggleSymbol.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleSymbol.mutate({
                    accountId,
                    pdno: position.code,
                    on: autoOn === false,
                  });
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: 0,
                  cursor: toggleSymbol.isPending ? 'wait' : 'pointer',
                  fontWeight: 600,
                  fontSize: '1rem',
                  color: autoOn === false ? 'var(--hts-down, #e53935)' : 'var(--hts-up, #1976d2)',
                }}
              >
                {autoOn === false ? 'OFF' : 'ON'}
              </button>
            </td>
            <LotStageCells lots={lots} gridMaxStages={gridMaxStages} />
            <td>
              <button
                type="button"
                aria-label={`${position.name} 차트`}
                onClick={(e) => {
                  e.stopPropagation();
                  onChartPopout?.(position.code, position.name);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  padding: '0.1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  color: 'var(--hts-muted, rgba(0,0,0,0.45))',
                }}
                title="차트 팝아웃"
              >
                <LineChart size={13} />
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      {/* expand: 차수별 상세 sub-row (가상화 행 안에서 동적 높이 — measureElement 가 처리) */}
      {expanded ? <ExpandedLots lots={lots} /> : null}
    </div>
  );
};

function formatSigned(value: number): string {
  if (!Number.isFinite(value)) return '-';
  const sign = value > 0 ? '+' : '';
  return `${sign}${thousandSeparator(Math.round(value))}`;
}

function stageColumnWidths(count: number): number[] {
  const out: number[] = [];
  for (let n = 1; n <= count; n += 1) out.push(n);
  return out;
}

interface ExpandedLotsProps {
  lots: LotEntry[];
}

const ExpandedLots = ({ lots }: ExpandedLotsProps): ReactElement => {
  if (lots.length === 0) {
    return (
      <div
        className="muted"
        style={{
          padding: '0.4rem 1rem',
          fontSize: '1.05rem',
          background: 'var(--hts-accent-bg, rgba(0,0,0,0.02))',
        }}
      >
        보유 차수 없음
      </div>
    );
  }
  return (
    <div
      style={{
        padding: '0.3rem 0.6rem',
        background: 'var(--hts-accent-bg, rgba(0,0,0,0.02))',
        borderTop: '1px solid var(--hts-line, rgba(0,0,0,0.06))',
      }}
    >
      <table className="hts-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th>차수</th>
            <th className="num">매입가</th>
            <th className="num">수량</th>
            <th className="num">투입금액</th>
            <th>상태</th>
            <th className="muted">매수일</th>
          </tr>
        </thead>
        <tbody>
          {lots.map((lot) => (
            <tr key={`${lot.nth}-${lot.boughtAt}`}>
              <td>{lot.nth}차</td>
              <td className="num">{thousandSeparator(lot.buyPrice)}</td>
              <td className="num">{thousandSeparator(lot.qty)}</td>
              <td className="num">{thousandSeparator(Math.round(lot.amountKrw))}</td>
              <td>{lot.status}</td>
              <td className="muted">{new Date(lot.boughtAt).toLocaleDateString('ko-KR')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
