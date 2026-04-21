// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const setFromStr = vi.fn();
const setToStr = vi.fn();

vi.mock('../model/use-reports', () => ({
  useReports: () => ({
    exportCsv: vi.fn(),
    fromStr: '2026-04-20',
    setFromStr,
    setToStr,
    summary: null,
    summaryError: null,
    summaryPending: false,
    toStr: '2026-04-20',
  }),
}));

import { ReportsPage } from './reports-page';

describe('ReportsPage', () => {
  it('partial draft는 blur 전까지 range setter로 새지 않고 commit 시 정규화된다', async () => {
    setFromStr.mockReset();
    render(<ReportsPage />);

    const input = screen.getByLabelText('리포트 시작일');
    fireEvent.change(input, { target: { value: '2026-4-1' } });

    expect(setFromStr).not.toHaveBeenCalled();

    fireEvent.blur(input);

    await waitFor(() => {
      expect(setFromStr).toHaveBeenCalledWith('2026-04-01');
    });
  });
});
