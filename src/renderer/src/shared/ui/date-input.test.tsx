// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DateInput } from './date-input';

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      bottom: 52,
      height: 32,
      left: 24,
      right: 240,
      toJSON: () => ({}),
      top: 20,
      width: 216,
      x: 24,
      y: 20,
    };
  };
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

function DateHarness(props: {
  initial?: string;
  max?: string;
  min?: string;
  onCommit?: (nextValue: string) => void;
}): ReactElement {
  const { initial = '2026-04-10', max, min, onCommit } = props;
  const [value, setValue] = useState(initial);

  return (
    <div>
      <DateInput
        aria-label="기준일"
        max={max}
        min={min}
        value={value}
        onChange={(event) => {
          onCommit?.(event.target.value);
          setValue(event.target.value);
        }}
      />
      <button type="button" onClick={() => setValue('2026-05-20')}>
        외부 변경
      </button>
    </div>
  );
}

describe('DateInput', () => {
  it('직접 입력은 blur 전까지 외부 onChange를 올리지 않고 blur 시 YYYY-MM-DD로 정규화한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const input = screen.getByLabelText('기준일');
    fireEvent.change(input, { target: { value: '2026-4-1' } });

    expect(input).toHaveValue('2026-4-1');
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(input);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-01');
      expect(input).toHaveValue('2026-04-01');
    });
  });

  it('월말 보정과 min/max clamp를 적용한다', async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <DateHarness initial="2026-04-10" max="2026-04-20" min="2026-04-10" onCommit={onCommit} />,
    );

    const input = screen.getByLabelText('기준일');
    fireEvent.change(input, { target: { value: '2026-4-99' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-20');
      expect(input).toHaveValue('2026-04-20');
    });
    unmount();
  });

  it('윤년 보정을 적용한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const input = screen.getByLabelText('기준일');
    fireEvent.change(input, { target: { value: '2024-02-31' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2024-02-29');
      expect(input).toHaveValue('2024-02-29');
    });
  });

  it('외부 controlled value 변경이 draft보다 우선한다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    const input = screen.getByLabelText('기준일');
    fireEvent.change(input, { target: { value: '2026-4-1' } });
    expect(input).toHaveValue('2026-4-1');

    fireEvent.click(screen.getByRole('button', { name: '외부 변경' }));

    await waitFor(() => {
      expect(input).toHaveValue('2026-05-20');
    });
  });

  it('달력에서 연/월/일을 선택하고 닫힐 때 포커스를 input으로 복귀한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const input = screen.getByLabelText('기준일');
    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '2027년 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '월 선택 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '6월 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '2027-06-18 선택' }));

    await waitFor(() => {
      expect(onCommit).toHaveBeenLastCalledWith('2027-06-18');
      expect(input).toHaveValue('2027-06-18');
      expect(input).toHaveFocus();
    });
  });

  it('modal overlay 안에서는 popup을 같은 overlay 안에 유지한다', async () => {
    const { container } = render(
      <div className="modal-overlay">
        <div className="modal">
          <DateHarness initial="2026-04-10" />
        </div>
      </div>,
    );

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    const overlay = container.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();

    await waitFor(() => {
      expect(within(overlay as HTMLElement).getByRole('dialog')).toBeInTheDocument();
    });
  });
});
