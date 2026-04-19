import { useGetFeeSettings } from '@renderer/entities/fee-settings';
import { type ReactElement, useState } from 'react';
import {
  calculateProfitAmount,
  calculateProfitRate,
  type ProfitCalcInput,
  type ProfitRateInput,
} from '../model/use-profit-calc';

interface Tab {
  id: 'profit' | 'rate';
  label: string;
}

const TABS: Tab[] = [
  { id: 'profit', label: '수익률 계산' },
  { id: 'rate', label: '금액 계산' },
];

export const ProfitCalculatorPage = (): ReactElement => {
  const [activeTab, setActiveTab] = useState<'profit' | 'rate'>('profit');
  const [alwaysOnTop, setAlwaysOnTop] = useState(false);

  // 수수료 설정 조회 (current env: real 사용)
  const { data: feeSettings } = useGetFeeSettings('real');
  const buyFeeRate = feeSettings?.buy ?? 0.015;
  const sellFeeRate = feeSettings?.sell ?? 0.015;
  const taxRate = feeSettings?.tax ?? 0.225;

  // 탭 1: 수익률 계산
  const [profitInput, setProfitInput] = useState({
    buyAmount: 1000000,
    profitRate: 5,
    includeFees: false,
  });

  const profitCalcInput: ProfitCalcInput = {
    buyAmount: profitInput.buyAmount,
    profitRate: profitInput.profitRate,
    buyFeeRate,
    sellFeeRate,
    taxRate,
    includeFees: profitInput.includeFees,
  };
  const profitResult = calculateProfitAmount(profitCalcInput);

  // 탭 2: 금액 계산
  const [rateInput, setRateInput] = useState({
    buyAmount: 1000000,
    sellAmount: 1050000,
    includeFees: false,
  });

  const rateCalcInput: ProfitRateInput = {
    buyAmount: rateInput.buyAmount,
    sellAmount: rateInput.sellAmount,
    buyFeeRate,
    sellFeeRate,
    taxRate,
    includeFees: rateInput.includeFees,
  };
  const rateResult = calculateProfitRate(rateCalcInput);

  const handleAlwaysOnTop = async (value: boolean) => {
    setAlwaysOnTop(value);
    // IPC 호출: main process에 alwaysOnTop 설정
    if (window.appShell?.setAlwaysOnTop) {
      await window.appShell.setAlwaysOnTop(value);
    }
  };

  return (
    <div style={styles.container}>
      {/* 헤더 */}
      <div style={styles.header}>
        <h1 style={styles.title}>수익률 계산기</h1>
        <label style={styles.alwaysOnTopLabel}>
          <input
            type="checkbox"
            checked={alwaysOnTop}
            onChange={(e) => handleAlwaysOnTop(e.target.checked)}
            style={styles.checkbox}
          />
          창 항상 위로
        </label>
      </div>

      {/* 탭 네비게이션 */}
      <div style={styles.tabNav}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabButton,
              ...(activeTab === tab.id ? styles.tabButtonActive : styles.tabButtonInactive),
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 콘텐츠 */}
      <div style={styles.content}>
        {activeTab === 'profit' ? (
          <div style={styles.form}>
            <div style={styles.formGroup}>
              <label htmlFor="profit-buy-amount" style={styles.label}>
                매수금액 (원)
              </label>
              <input
                id="profit-buy-amount"
                type="number"
                value={profitInput.buyAmount}
                onChange={(e) =>
                  setProfitInput({ ...profitInput, buyAmount: Number(e.target.value) })
                }
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label htmlFor="profit-rate" style={styles.label}>
                수익률 (%)
              </label>
              <input
                id="profit-rate"
                type="number"
                step="0.01"
                value={profitInput.profitRate}
                onChange={(e) =>
                  setProfitInput({ ...profitInput, profitRate: Number(e.target.value) })
                }
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <input
                  type="checkbox"
                  checked={profitInput.includeFees}
                  onChange={(e) =>
                    setProfitInput({ ...profitInput, includeFees: e.target.checked })
                  }
                  style={styles.checkbox}
                />
                수수료 및 세금 포함
              </label>
            </div>

            {profitInput.includeFees && (
              <div style={styles.feeInfo}>
                <div style={styles.feeRow}>
                  <span>매수 수수료율:</span>
                  <span>{buyFeeRate.toFixed(3)}%</span>
                </div>
                <div style={styles.feeRow}>
                  <span>매도 수수료율:</span>
                  <span>{sellFeeRate.toFixed(3)}%</span>
                </div>
                <div style={styles.feeRow}>
                  <span>세금률:</span>
                  <span>{taxRate.toFixed(3)}%</span>
                </div>
              </div>
            )}

            <div style={styles.results}>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>결과액:</span>
                <span style={styles.resultValue}>
                  {Math.round(profitResult.resultAmount).toLocaleString()} 원
                </span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>매수 수수료:</span>
                <span style={styles.resultValue}>
                  {Math.round(profitResult.buyFee).toLocaleString()} 원
                </span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>실제 매수 금액:</span>
                <span style={styles.resultValue}>
                  {Math.round(profitResult.netBuyAmount).toLocaleString()} 원
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.form}>
            <div style={styles.formGroup}>
              <label htmlFor="rate-buy-amount" style={styles.label}>
                매수금액 (원)
              </label>
              <input
                id="rate-buy-amount"
                type="number"
                value={rateInput.buyAmount}
                onChange={(e) => setRateInput({ ...rateInput, buyAmount: Number(e.target.value) })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label htmlFor="rate-sell-amount" style={styles.label}>
                매도금액 (원)
              </label>
              <input
                id="rate-sell-amount"
                type="number"
                value={rateInput.sellAmount}
                onChange={(e) => setRateInput({ ...rateInput, sellAmount: Number(e.target.value) })}
                style={styles.input}
              />
            </div>

            <div style={styles.formGroup}>
              <label style={styles.label}>
                <input
                  type="checkbox"
                  checked={rateInput.includeFees}
                  onChange={(e) => setRateInput({ ...rateInput, includeFees: e.target.checked })}
                  style={styles.checkbox}
                />
                수수료 및 세금 포함
              </label>
            </div>

            {rateInput.includeFees && (
              <div style={styles.feeInfo}>
                <div style={styles.feeRow}>
                  <span>매수 수수료율:</span>
                  <span>{buyFeeRate.toFixed(3)}%</span>
                </div>
                <div style={styles.feeRow}>
                  <span>매도 수수료율:</span>
                  <span>{sellFeeRate.toFixed(3)}%</span>
                </div>
                <div style={styles.feeRow}>
                  <span>세금률:</span>
                  <span>{taxRate.toFixed(3)}%</span>
                </div>
              </div>
            )}

            <div style={styles.results}>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>수익률:</span>
                <span style={styles.resultValue}>{rateResult.profitRate.toFixed(2)}%</span>
              </div>
              <div style={styles.resultRow}>
                <span style={styles.resultLabel}>수익:</span>
                <span style={styles.resultValue}>
                  {Math.round(rateResult.profit).toLocaleString()} 원
                </span>
              </div>
              {rateInput.includeFees && (
                <>
                  <div style={styles.resultRow}>
                    <span style={styles.resultLabel}>매수 수수료:</span>
                    <span style={styles.resultValue}>
                      {Math.round(rateResult.buyFee).toLocaleString()} 원
                    </span>
                  </div>
                  <div style={styles.resultRow}>
                    <span style={styles.resultLabel}>매도 수수료:</span>
                    <span style={styles.resultValue}>
                      {Math.round(rateResult.sellFee).toLocaleString()} 원
                    </span>
                  </div>
                  <div style={styles.resultRow}>
                    <span style={styles.resultLabel}>세금:</span>
                    <span style={styles.resultValue}>
                      {Math.round(rateResult.tax).toLocaleString()} 원
                    </span>
                  </div>
                  <div style={styles.resultRow}>
                    <span style={styles.resultLabel}>순수익:</span>
                    <span style={styles.resultValue}>
                      {Math.round(rateResult.netProfit).toLocaleString()} 원
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const styles = {
  container: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    height: '100vh',
    backgroundColor: '#f5f5f5',
    padding: '12px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  header: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid #e0e0e0',
  },
  title: {
    margin: 0,
    fontSize: '18px',
    fontWeight: 600,
  },
  alwaysOnTopLabel: {
    display: 'flex' as const,
    alignItems: 'center' as const,
    gap: '6px',
    fontSize: '13px',
    cursor: 'pointer' as const,
  },
  checkbox: {
    cursor: 'pointer' as const,
  },
  tabNav: {
    display: 'flex' as const,
    gap: '4px',
    marginBottom: '12px',
    borderBottom: '1px solid #e0e0e0',
  },
  tabButton: {
    padding: '8px 12px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer' as const,
    fontSize: '13px',
    fontWeight: 500,
    transition: 'all 0.2s ease',
  },
  tabButtonActive: {
    color: '#1976d2',
    borderBottom: '2px solid #1976d2',
    marginBottom: '-1px',
  },
  tabButtonInactive: {
    color: '#666',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  form: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '12px',
  },
  formGroup: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '4px',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: '#333',
  },
  input: {
    padding: '6px 8px',
    border: '1px solid #d0d0d0',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'inherit',
  },
  feeInfo: {
    padding: '8px 10px',
    backgroundColor: '#fff8e1',
    borderRadius: '4px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '4px',
  },
  feeRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: '12px',
    color: '#666',
  },
  results: {
    padding: '12px 10px',
    backgroundColor: '#e8f5e9',
    borderRadius: '4px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '8px',
  },
  resultRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: '13px',
  },
  resultLabel: {
    color: '#333',
    fontWeight: 500,
  },
  resultValue: {
    color: '#1976d2',
    fontWeight: 600,
    textAlign: 'right' as const,
  },
};
