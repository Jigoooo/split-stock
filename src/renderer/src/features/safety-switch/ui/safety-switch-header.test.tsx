// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useSafetySwitchMock = vi.fn();

vi.mock('../model/use-safety-switch', () => ({
  useSafetySwitch: () => useSafetySwitchMock(),
}));

import { SafetySwitchHeader } from './safety-switch-header';

describe('SafetySwitchHeader', () => {
  it('master=true면 주문 가능 버튼을 보여준다', () => {
    useSafetySwitchMock.mockReturnValue({
      clearErrorLock: vi.fn(),
      clearPending: false,
      error: null,
      isPending: false,
      setMaster: vi.fn(),
      setMasterPending: false,
      snapshot: {
        master: true,
        errorLock: { active: false, reason: null },
      },
    });

    render(<SafetySwitchHeader />);

    expect(screen.getByRole('button', { name: '주문 가능' })).toHaveClass('hts-btn--primary');
  });

  it('master=false면 주문 차단 버튼을 보여준다', () => {
    useSafetySwitchMock.mockReturnValue({
      clearErrorLock: vi.fn(),
      clearPending: false,
      error: null,
      isPending: false,
      setMaster: vi.fn(),
      setMasterPending: false,
      snapshot: {
        master: false,
        errorLock: { active: false, reason: null },
      },
    });

    render(<SafetySwitchHeader />);

    expect(screen.getByRole('button', { name: '주문 차단' })).toHaveClass('hts-btn--danger');
  });
});
