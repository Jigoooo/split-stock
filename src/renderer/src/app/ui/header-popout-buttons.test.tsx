// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HeaderPopoutButtons } from './header-popout-buttons';

describe('HeaderPopoutButtons', () => {
  it('작업 팝아웃 런처를 모두 노출하고 route를 연다', async () => {
    const popout = {
      isOpen: (route: string) => route === 'reports',
      popout: vi.fn().mockResolvedValue(undefined),
    };

    render(<HeaderPopoutButtons popout={popout} />);

    for (const label of ['트레이드', '이벤트 로그', '리포트', '설정']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: '수익률 계산기' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '종목 선택' })).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: '리포트' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '트레이드' }));

    await waitFor(() => {
      expect(popout.popout).toHaveBeenCalledWith('trade');
    });
    expect(await screen.findByText('트레이드 창 열림')).toBeInTheDocument();
  });
});
