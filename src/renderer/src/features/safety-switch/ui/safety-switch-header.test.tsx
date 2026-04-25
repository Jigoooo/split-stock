// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const useSafetySwitchMock = vi.fn();

vi.mock('../model/use-safety-switch', () => ({
  useSafetySwitch: () => useSafetySwitchMock(),
}));

import { SafetySwitchHeader } from './safety-switch-header';

describe('SafetySwitchHeader', () => {
  it('master=true면 주문 가능 스위치를 보여준다', () => {
    const setMaster = vi.fn();
    useSafetySwitchMock.mockReturnValue({
      clearErrorLock: vi.fn(),
      clearPending: false,
      error: null,
      isPending: false,
      setMaster,
      setMasterPending: false,
      snapshot: {
        master: true,
        errorLock: { active: false, reason: null },
      },
    });

    render(<SafetySwitchHeader />);

    const switchControl = screen.getByRole('switch', { name: '주문 가능' });
    expect(switchControl).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(switchControl);
    expect(setMaster).toHaveBeenCalledWith(false);
  });

  it('master=false면 주문 차단 스위치를 보여준다', () => {
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

    expect(screen.getByRole('switch', { name: '주문 차단' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(screen.getByText('차단')).toBeInTheDocument();
  });
});
