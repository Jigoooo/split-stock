// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/pages/dashboard', () => ({
  DashboardPage: () => <div>dashboard-stub</div>,
}));

vi.mock('@renderer/pages/logs', () => ({
  LogsPage: () => <div>logs-stub</div>,
}));

vi.mock('@renderer/pages/trade', () => ({
  TradePage: () => <div>trade-stub</div>,
}));

vi.mock('react-resizable-panels', () => ({
  Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Panel: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Separator: () => <div data-testid="separator" />,
  useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChanged: vi.fn() }),
}));

vi.mock('@renderer/shared/api/trpc', () => ({
  trpc: {
    auth: {
      getEnv: {
        useQuery: () => ({ data: { env: 'MOCK', accountId: 1 } }),
      },
    },
  },
}));

import { PanelWorkspace } from './panel-workspace';

describe('PanelWorkspace', () => {
  it('팝아웃이 열려 있어도 메인 패널 내용을 유지한다', () => {
    render(
      <PanelWorkspace
        popout={{
          isOpen: () => true,
          popout: vi.fn(async () => {}),
        }}
      />,
    );

    expect(screen.getByText('dashboard-stub')).toBeInTheDocument();
    expect(screen.getByText('logs-stub')).toBeInTheDocument();
    expect(screen.getByText('trade-stub')).toBeInTheDocument();
    expect(screen.queryByText('현재 이 화면은 팝아웃 창에서 표시 중입니다.')).toBeNull();
  });
});
