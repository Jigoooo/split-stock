import type { ReactElement } from 'react';

export interface DashboardPosition {
  code: string;
  name: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  evalAmount: number;
  pnlAmount: number;
  pnlRate: number;
}

export interface PositionsPanelProps {
  positions: DashboardPosition[];
  selectedPdno: string | null;
  onSelect: (position: { pdno: string; name: string }) => void;
}

export const PositionsPanel = ({
  positions,
  selectedPdno,
  onSelect,
}: PositionsPanelProps): ReactElement => {
  return (
    <div className="panel">
      <div className="panel__title">보유 종목</div>
      <div className="panel__body" style={{ padding: 0 }}>
        <table className="hts-table">
          <thead>
            <tr>
              <th>종목코드</th>
              <th>종목명</th>
              <th className="num">보유수량</th>
              <th className="num">평균단가</th>
              <th className="num">현재가</th>
              <th className="num">평가금액</th>
              <th className="num">손익</th>
              <th className="num">수익률</th>
            </tr>
          </thead>
          <tbody>
            {positions.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted" style={{ textAlign: 'center' }}>
                  보유 종목이 없습니다.
                </td>
              </tr>
            ) : null}
            {positions.map((position) => {
              const sign =
                position.pnlAmount === 0 ? 'flat' : position.pnlAmount > 0 ? 'up' : 'down';
              const colorClass =
                sign === 'up' ? 'num-up' : sign === 'down' ? 'num-down' : 'num-flat';
              const isSelected = selectedPdno === position.code;

              return (
                <tr
                  key={position.code}
                  onClick={() => onSelect({ pdno: position.code, name: position.name })}
                  style={{
                    cursor: 'pointer',
                    background: isSelected ? 'rgba(45, 79, 202, 0.08)' : undefined,
                  }}
                >
                  <td className="num">{position.code}</td>
                  <td>{position.name}</td>
                  <td className="num">{formatKrw(position.qty)}</td>
                  <td className="num">{formatKrw(position.avgPrice)}</td>
                  <td className="num">{formatKrw(position.currentPrice)}</td>
                  <td className="num">{formatKrw(position.evalAmount)}</td>
                  <td className={`num ${colorClass}`}>{formatKrw(position.pnlAmount, true)}</td>
                  <td className={`num ${colorClass}`}>{position.pnlRate.toFixed(2)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function formatKrw(value: number, signed = false): string {
  if (!Number.isFinite(value)) return '-';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${Math.round(value).toLocaleString('ko-KR')}`;
}
