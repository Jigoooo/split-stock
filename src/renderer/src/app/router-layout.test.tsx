// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PopoutBootShell, PopoutRoutePage } from './router-layout';

describe('popout route loading shell', () => {
  beforeEach(() => {
    window.location.hash = '#/popout/stock-picker';
    window.appShell = {
      openPopout: vi.fn().mockResolvedValue({ ok: true }),
      onPopoutClosed: vi.fn(() => vi.fn()),
      assignStock: vi.fn(),
      onStockAssigned: vi.fn(() => vi.fn()),
      broadcastAccountChanged: vi.fn(),
      onAccountChanged: vi.fn(() => vi.fn()),
      broadcastSettingsChanged: vi.fn(),
      onSettingsChanged: vi.fn(() => vi.fn()),
      setAlwaysOnTop: vi.fn().mockResolvedValue(undefined),
      fitContentHeight: vi.fn().mockResolvedValue(undefined),
      markPopoutShellReady: vi.fn(),
      markRouteReady: vi.fn(),
    };
  });

  it('route lazy chunk가 오기 전에도 full-window loading shell을 보여준다', () => {
    render(<PopoutRoutePage route="stock-picker" />);

    expect(screen.getByRole('status', { name: '종목 선택 로드 중' })).toBeInTheDocument();
  });

  it('loading shell이 commit된 뒤 main에 shell-ready를 알린다', async () => {
    render(<PopoutRoutePage route="stock-picker" />);

    await waitFor(() => {
      expect(window.appShell?.markPopoutShellReady).toHaveBeenCalledWith('stock-picker');
    });
  });

  it('PopoutBootShell은 네트워크 없이 route 이름 기반 상태만 렌더한다', () => {
    render(<PopoutBootShell route="logs" />);

    expect(screen.getByRole('status', { name: '이벤트 로그 로드 중' })).toHaveTextContent(
      '화면 구성을 불러오고 있습니다.',
    );
  });
});
