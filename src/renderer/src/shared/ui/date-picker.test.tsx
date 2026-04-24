// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';

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

function DatePickerHarness(props: {
  initial?: string;
  max?: string;
  min?: string;
  onCommit?: (nextValue: string) => void;
}): ReactElement {
  const { initial = '2026-04-10', max, min, onCommit } = props;
  const [value, setValue] = useState(initial);

  return (
    <div>
      <DatePicker
        aria-label="기준일 선택"
        max={max}
        min={min}
        value={value}
        onChange={(nextValue) => {
          onCommit?.(nextValue);
          setValue(nextValue);
        }}
      />
      <button type="button" onClick={() => setValue('2026-05-20')}>
        외부 변경
      </button>
    </div>
  );
}

describe('DatePicker', () => {
  it('첫 오픈에서도 calendar dialog를 바로 렌더한다', () => {
    render(<DatePickerHarness />);

    fireEvent.click(screen.getByRole('button', { name: '기준일 선택' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('날짜를 선택하면 onChange와 trigger label을 갱신한다', async () => {
    const onCommit = vi.fn();
    render(<DatePickerHarness onCommit={onCommit} />);

    const trigger = screen.getByRole('button', { name: '기준일 선택' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: '2026-04-18 선택' }));

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-18');
      expect(trigger).toHaveTextContent('2026-04-18');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('연도와 월을 전환한 뒤 날짜를 선택할 수 있다', async () => {
    const onCommit = vi.fn();
    render(<DatePickerHarness onCommit={onCommit} />);

    fireEvent.click(screen.getByRole('button', { name: '기준일 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2027년 선택' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '2027년 선택' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '6월 선택' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '6월 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '2027-06-18 선택' }));

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2027-06-18');
      expect(screen.getByRole('button', { name: '기준일 선택' })).toHaveTextContent('2027-06-18');
    });
  });

  it('범위 밖 날짜는 비활성화된다', async () => {
    render(<DatePickerHarness initial="2026-04-10" min="2026-04-20" />);

    fireEvent.click(screen.getByRole('button', { name: '기준일 선택' }));

    const disabledSelectedDay = await screen.findByRole('button', { name: '2026-04-10 선택' });
    expect(disabledSelectedDay).toBeDisabled();
  });

  it('외부 controlled value 변경이 trigger label에 즉시 반영된다', async () => {
    render(<DatePickerHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '외부 변경' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '기준일 선택' })).toHaveTextContent('2026-05-20');
    });
  });
});
