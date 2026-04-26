export const profitCalculatorStyles = {
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
  container: {
    display: 'flex' as const,
    flexDirection: 'column' as const,
    height: '100vh',
    backgroundColor: 'var(--bg-2)',
    padding: '12px',
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
  },
  feeInfo: {
    padding: '8px 10px',
    backgroundColor: 'var(--bg-3)',
    borderRadius: '4px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '4px',
  },
  feeRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: '12px',
    color: 'var(--fg-2)',
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
  input: {
    padding: '6px 8px',
    border: '1px solid var(--border)',
    borderRadius: '4px',
    fontSize: '12px',
    fontFamily: 'inherit',
  },
  label: {
    fontSize: '12px',
    fontWeight: 500,
    color: 'var(--fg)',
  },
  resultLabel: {
    color: 'var(--fg)',
    fontWeight: 500,
  },
  resultRow: {
    display: 'flex' as const,
    justifyContent: 'space-between' as const,
    fontSize: '13px',
  },
  resultValue: {
    color: 'var(--fg)',
    fontWeight: 600,
    textAlign: 'right' as const,
  },
  results: {
    padding: '12px 10px',
    backgroundColor: 'var(--bg-3)',
    borderRadius: '4px',
    display: 'flex' as const,
    flexDirection: 'column' as const,
    gap: '8px',
  },
  tabButton: {
    padding: '8px 12px',
    border: 'none',
    backgroundColor: 'transparent',
    cursor: 'pointer' as const,
    fontSize: '13px',
    fontWeight: 500,
    transition: 'color 0.2s ease',
  },
  tabButtonActive: {
    color: 'var(--accent)',
    borderBottom: '2px solid var(--accent)',
    marginBottom: '-1px',
  },
  tabButtonInactive: {
    color: 'var(--fg-2)',
  },
  tabNav: {
    display: 'flex' as const,
    gap: '4px',
    marginBottom: '12px',
    borderBottom: '1px solid var(--border)',
  },
  toolbar: {
    display: 'flex' as const,
    justifyContent: 'flex-end' as const,
    alignItems: 'center' as const,
    marginBottom: '12px',
    paddingBottom: '8px',
    borderBottom: '1px solid var(--border)',
  },
};

/**
 * 손익 값 부호에 따라 한국식 HTS 색상을 반환한다.
 * - 양수(이익): `--up` (상승 빨강)
 * - 음수(손실): `--down` (하락 파랑)
 * - 0/중립: 기본 텍스트
 */
export function profitColor(value: number): { color: string } {
  if (value > 0) return { color: 'var(--up)' };
  if (value < 0) return { color: 'var(--down)' };
  return { color: 'var(--fg)' };
}
