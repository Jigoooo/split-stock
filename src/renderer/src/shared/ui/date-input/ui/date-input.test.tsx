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

function getDateSegments(label = '기준일'): Record<'day' | 'month' | 'year', HTMLInputElement> {
  return {
    day: screen.getByLabelText(`${label} 일`),
    month: screen.getByLabelText(`${label} 월`),
    year: screen.getByLabelText(`${label} 연도`),
  };
}

describe('DateInput', () => {
  it('직접 입력은 blur 전까지 외부 onChange를 올리지 않고 blur 시 YYYY-MM-DD로 정규화한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const { day, month, year } = getDateSegments();
    expect(year).toHaveClass('hts-date-shell__field');

    fireEvent.change(month, { target: { value: '4' } });

    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.blur(month, { relatedTarget: day });

    await waitFor(() => {
      expect(month).toHaveValue('04');
    });

    fireEvent.change(day, { target: { value: '1' } });
    fireEvent.blur(day);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-01');
      expect(year).toHaveValue('2026');
      expect(month).toHaveValue('04');
      expect(day).toHaveValue('01');
    });
  });

  it('월말 보정과 min/max clamp를 적용한다', async () => {
    const onCommit = vi.fn();
    const { unmount } = render(
      <DateHarness initial="2026-04-10" max="2026-04-20" min="2026-04-10" onCommit={onCommit} />,
    );

    const { day } = getDateSegments();
    fireEvent.change(day, { target: { value: '99' } });
    fireEvent.blur(day);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-20');
      expect(day).toHaveValue('20');
    });
    unmount();
  });

  it('윤년 보정을 적용한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const { day, month, year } = getDateSegments();
    fireEvent.change(year, { target: { value: '2024' } });
    fireEvent.change(month, { target: { value: '2' } });
    fireEvent.change(day, { target: { value: '31' } });
    fireEvent.blur(day);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2024-02-29');
      expect(year).toHaveValue('2024');
      expect(month).toHaveValue('02');
      expect(day).toHaveValue('29');
    });
  });

  it('외부 controlled value 변경이 draft보다 우선한다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    const { day } = getDateSegments();
    fireEvent.change(day, { target: { value: '1' } });
    expect(day).toHaveValue('1');

    fireEvent.click(screen.getByRole('button', { name: '외부 변경' }));

    await waitFor(() => {
      expect(day).toHaveValue('20');
    });
  });

  it('year view가 열린 상태에서 외부 controlled value가 바뀌면 연도 페이지도 새 값으로 동기화된다', async () => {
    function YearPageSyncHarness(): ReactElement {
      const [value, setValue] = useState('2026-04-10');

      return (
        <div>
          <DateInput aria-label="기준일" value={value} onChange={() => undefined} />
          <button type="button" onClick={() => setValue('2035-05-20')}>
            먼 미래로 변경
          </button>
        </div>
      );
    }

    render(<YearPageSyncHarness />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2027년 선택' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '먼 미래로 변경' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2028년 선택' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2039년 선택' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '2027년 선택' })).not.toBeInTheDocument();
    });
  });

  it('세그먼트 입력은 자동 다음 칸 이동과 구분자 키 이동을 지원한다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    const { day, month, year } = getDateSegments();
    year.focus();
    fireEvent.change(year, { target: { value: '2027' } });

    await waitFor(() => {
      expect(month).toHaveFocus();
    });

    fireEvent.keyDown(month, { key: '-' });

    await waitFor(() => {
      expect(day).toHaveFocus();
    });
  });

  it('연도에서 월로 이동할 때도 앞 세그먼트를 즉시 commit한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const { month, year } = getDateSegments();
    fireEvent.change(year, { target: { value: '2027' } });
    fireEvent.blur(year, { relatedTarget: month });

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2027-04-10');
      expect(year).toHaveValue('2027');
    });
  });

  it('빈 초기값에서는 incomplete draft를 blur해도 입력값을 유지한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="" onCommit={onCommit} />);

    const { month, year } = getDateSegments();
    fireEvent.change(year, { target: { value: '2027' } });
    fireEvent.blur(year, { relatedTarget: month });

    await waitFor(() => {
      expect(year).toHaveValue('2027');
    });

    fireEvent.change(month, { target: { value: '4' } });
    fireEvent.blur(month);

    await waitFor(() => {
      expect(year).toHaveValue('2027');
      expect(month).toHaveValue('4');
    });

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('연도 선택은 월 단계로 이동하고 월/일 선택 후 닫힐 때 포커스를 input으로 복귀한다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const { year } = getDateSegments();
    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '2027년 선택' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '6월 선택' })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '6월 선택' }));
    fireEvent.click(screen.getByRole('button', { name: '2027-06-18 선택' }));

    await waitFor(() => {
      expect(onCommit).toHaveBeenLastCalledWith('2027-06-18');
      expect(year).toHaveValue('2027');
      expect(year).toHaveFocus();
    });
  });

  it('trigger로 닫을 때도 draft를 commit하고 달력을 닫는다', async () => {
    const onCommit = vi.fn();
    render(<DateHarness initial="2026-04-10" onCommit={onCommit} />);

    const { day } = getDateSegments();
    const trigger = screen.getByRole('button', { name: '날짜 선택기 열기' });

    fireEvent.click(trigger);

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    fireEvent.change(day, { target: { value: '1' } });
    fireEvent.click(trigger);

    await waitFor(() => {
      expect(onCommit).toHaveBeenCalledWith('2026-04-01');
      expect(day).toHaveValue('01');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('첫 오픈에서도 추가 tick 없이 dialog를 바로 렌더한다', () => {
    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('일 달력에서 방향키로 날짜 셀 포커스를 이동한다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    const selectedDay = await screen.findByRole('button', { name: '2026-04-10 선택' });
    selectedDay.focus();
    fireEvent.keyDown(selectedDay, { key: 'ArrowRight' });

    expect(screen.getByRole('button', { name: '2026-04-11 선택' })).toHaveFocus();
  });

  it('popup이 열린 상태에서 draft를 수정해도 calendar는 열린 채 유지된다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    const { day } = getDateSegments();
    fireEvent.change(day, { target: { value: '11' } });

    await waitFor(() => {
      expect(day).toHaveValue('11');
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2026-04-10 선택' })).toBeInTheDocument();
    });
  });

  it('연/월 달력에서 닫아도 다음에 다시 열면 일달력으로 시작한다', async () => {
    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));
    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2027년 선택' })).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2026-04-10 선택' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '2027년 선택' })).not.toBeInTheDocument();
    });
  });

  it('범위 밖으로 disable된 날짜는 selected 강조를 유지하지 않는다', async () => {
    render(<DateHarness initial="2026-04-10" min="2026-04-20" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    const disabledSelectedDay = await screen.findByRole('button', { name: '2026-04-10 선택' });
    expect(disabledSelectedDay).toBeDisabled();
    expect(disabledSelectedDay).not.toHaveClass('hts-date-popup__day--selected');
  });

  it('min 이전 기간은 연/월 선택과 이전 이동이 비활성화된다', async () => {
    render(<DateHarness initial="2026-04-20" min="2026-04-20" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    expect(screen.getByRole('button', { name: '이전 달' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '연도 선택 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '2025년 선택' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '2026년 선택' })).not.toBeDisabled();
    });

    fireEvent.click(screen.getByRole('button', { name: '2026년 선택' }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '3월 선택' })).toBeDisabled();
      expect(screen.getByRole('button', { name: '4월 선택' })).not.toBeDisabled();
      expect(screen.getByRole('button', { name: '이전 연도' })).toBeDisabled();
    });
  });

  it('modal overlay 안에서도 popup을 body로 portal해 clipping을 피한다', async () => {
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
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(within(overlay as HTMLElement).queryByRole('dialog')).toBeNull();
    });
  });

  it('하단 공간이 부족하면 calendar popup을 위쪽으로 뒤집는다', async () => {
    const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this instanceof HTMLElement && this.classList.contains('hts-date-root')) {
        return {
          bottom: 744,
          height: 32,
          left: 24,
          right: 240,
          toJSON: () => ({}),
          top: 712,
          width: 216,
          x: 24,
          y: 712,
        };
      }

      if (this instanceof HTMLElement && this.classList.contains('hts-control-popup--date')) {
        return {
          bottom: 320,
          height: 320,
          left: 0,
          right: 296,
          toJSON: () => ({}),
          top: 0,
          width: 296,
          x: 0,
          y: 0,
        };
      }

      return previousGetBoundingClientRect.call(this);
    };

    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAttribute('data-side', 'top');
    });

    HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect;
  });

  it('우측 공간이 부족하면 anchor 끝에 맞춰 popup을 정렬한다', async () => {
    const previousGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

    HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
      if (this instanceof HTMLElement && this.classList.contains('hts-date-root')) {
        return {
          bottom: 52,
          height: 32,
          left: 980,
          right: 1012,
          toJSON: () => ({}),
          top: 20,
          width: 32,
          x: 980,
          y: 20,
        };
      }

      if (this instanceof HTMLElement && this.classList.contains('hts-control-popup--date')) {
        return {
          bottom: 320,
          height: 320,
          left: 0,
          right: 296,
          toJSON: () => ({}),
          top: 0,
          width: 296,
          x: 0,
          y: 0,
        };
      }

      return previousGetBoundingClientRect.call(this);
    };

    render(<DateHarness initial="2026-04-10" />);

    fireEvent.click(screen.getByRole('button', { name: '날짜 선택기 열기' }));

    await waitFor(() => {
      expect(screen.getByRole('dialog')).toHaveAttribute('data-align', 'end');
    });

    HTMLElement.prototype.getBoundingClientRect = previousGetBoundingClientRect;
  });
});
