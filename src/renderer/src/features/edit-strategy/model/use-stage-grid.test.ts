import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useStageGrid } from './use-stage-grid';

const INITIAL = { dropPct: '3', profitPct: '5' };

describe('useStageGrid — autoFill', () => {
  it('PREV_LOT: 모든 차수 dropPct = interval (직전 대비 동일)', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '3',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 5,
      });
    });

    const rows = result.current.rows;
    expect(rows).toHaveLength(5);
    rows.forEach((row, i) => {
      expect(row.stage).toBe(i + 1);
      expect(row.dropPct).toBe('3');
      expect(row.amountKrw).toBe('100000');
    });
  });

  it('FIRST_LOT: N차 dropPct = N * interval (1차 기준 누적)', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '2',
        amountKrw: '200000',
        baseline: 'FIRST_LOT',
        maxStages: 4,
      });
    });

    const rows = result.current.rows;
    expect(rows).toHaveLength(4);
    expect(rows[0]?.dropPct).toBe('2'); // 1 * 2
    expect(rows[1]?.dropPct).toBe('4'); // 2 * 2
    expect(rows[2]?.dropPct).toBe('6'); // 3 * 2
    expect(rows[3]?.dropPct).toBe('8'); // 4 * 2
    rows.forEach((row) => {
      expect(row.amountKrw).toBe('200000');
    });
  });

  it('50차까지 채우기 — rows 길이 50', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '1',
        amountKrw: '50000',
        baseline: 'PREV_LOT',
        maxStages: 50,
      });
    });

    expect(result.current.rows).toHaveLength(50);
    expect(result.current.rows[49]?.stage).toBe(50);
  });

  it('interval 0 이하 → rows 변경 없음', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '0',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 5,
      });
    });

    expect(result.current.rows).toHaveLength(0);
  });

  it('interval 음수 → rows 변경 없음', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '-3',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 5,
      });
    });

    expect(result.current.rows).toHaveLength(0);
  });

  it('재호출 시 rows 덮어씌움', () => {
    const { result } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      result.current.autoFill({
        dropPctInterval: '3',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 10,
      });
    });

    expect(result.current.rows).toHaveLength(10);

    act(() => {
      result.current.autoFill({
        dropPctInterval: '5',
        amountKrw: '50000',
        baseline: 'FIRST_LOT',
        maxStages: 3,
      });
    });

    const rows = result.current.rows;
    expect(rows).toHaveLength(3);
    expect(rows[0]?.dropPct).toBe('5');
    expect(rows[1]?.dropPct).toBe('10');
    expect(rows[2]?.dropPct).toBe('15');
  });

  it('PREV_LOT vs FIRST_LOT 1차 dropPct 동일, 2차부터 차이', () => {
    const { result: prevResult } = renderHook(() => useStageGrid(INITIAL));
    const { result: firstResult } = renderHook(() => useStageGrid(INITIAL));

    act(() => {
      prevResult.current.autoFill({
        dropPctInterval: '3',
        amountKrw: '100000',
        baseline: 'PREV_LOT',
        maxStages: 3,
      });
    });

    act(() => {
      firstResult.current.autoFill({
        dropPctInterval: '3',
        amountKrw: '100000',
        baseline: 'FIRST_LOT',
        maxStages: 3,
      });
    });

    // 1차는 두 기준 모두 동일
    expect(prevResult.current.rows[0]?.dropPct).toBe('3');
    expect(firstResult.current.rows[0]?.dropPct).toBe('3');

    // 2차부터 차이: PREV_LOT=3, FIRST_LOT=6
    expect(prevResult.current.rows[1]?.dropPct).toBe('3');
    expect(firstResult.current.rows[1]?.dropPct).toBe('6');

    // 3차: PREV_LOT=3, FIRST_LOT=9
    expect(prevResult.current.rows[2]?.dropPct).toBe('3');
    expect(firstResult.current.rows[2]?.dropPct).toBe('9');
  });
});
