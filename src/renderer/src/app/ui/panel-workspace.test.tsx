// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/pages/main', () => ({
  MainPage: () => <div>main-stub</div>,
}));

import { PanelWorkspace } from './panel-workspace';

describe('PanelWorkspace', () => {
  it('MainPage 를 단일 마운트한다 (Wave 4 cutover)', () => {
    render(
      <PanelWorkspace
        popout={{
          isOpen: () => false,
          popout: vi.fn(async () => {}),
        }}
      />,
    );

    expect(screen.getByText('main-stub')).toBeInTheDocument();
  });
});
