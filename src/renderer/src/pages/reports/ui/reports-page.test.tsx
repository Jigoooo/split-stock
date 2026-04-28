// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const setFromStr = vi.fn();
const setToStr = vi.fn();

vi.mock('../model/use-reports', () => ({
  useReports: () => ({
    dailyPnlError: null,
    dailyPnlPending: false,
    dailyPnlPoints: [],
    exportCsv: vi.fn(),
    fromStr: '2026-04-20',
    pnlByLotNth: [],
    pnlByLotNthError: null,
    pnlByLotNthPending: false,
    setFromStr,
    setToStr,
    summary: null,
    summaryError: null,
    summaryPending: false,
    toStr: '2026-04-20',
    winRateTimeline: [],
    winRateTimelineError: null,
    winRateTimelinePending: false,
  }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    monitoring: {
      getRealtimeStats: {
        useQuery: () => ({ data: null }),
      },
    },
    reports: {
      getDailyOpsSummary: {
        useQuery: () => ({ data: null, error: null, isPending: false }),
      },
    },
  },
}));

import { ReportsPage } from './reports-page';

describe('ReportsPage', () => {
  it('partial draft는 blur 전까지 range setter로 새지 않고 commit 시 정규화된다', async () => {
    setFromStr.mockReset();
    render(<ReportsPage />);

    const monthInput = screen.getByLabelText('리포트 시작일 월');
    const dayInput = screen.getByLabelText('리포트 시작일 일');
    fireEvent.change(monthInput, { target: { value: '4' } });

    expect(setFromStr).not.toHaveBeenCalled();

    fireEvent.blur(monthInput, { relatedTarget: dayInput });
    fireEvent.change(dayInput, { target: { value: '1' } });
    fireEvent.blur(dayInput);

    await waitFor(() => {
      expect(setFromStr).toHaveBeenCalledWith('2026-04-01');
    });
  });
});
