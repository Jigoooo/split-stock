// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { type ReactElement, useState } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Select } from './select';

const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return {
      bottom: 52,
      height: 32,
      left: 24,
      right: 204,
      toJSON: () => ({}),
      top: 20,
      width: 180,
      x: 24,
      y: 20,
    };
  };
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
});

function SelectHarness(props: {
  initial?: string;
  onValueChange?: (nextValue: string) => void;
}): ReactElement {
  const { initial = 'alpha', onValueChange } = props;
  const [value, setValue] = useState(initial);

  return (
    <div>
      <label htmlFor="test-select">환경</label>
      <Select
        aria-label="환경 선택"
        className="custom-select"
        data-testid="test-select"
        id="test-select"
        name="env"
        style={{ width: '18rem' }}
        value={value}
        onChange={(event) => {
          onValueChange?.(event.target.value);
          setValue(event.target.value);
        }}
      >
        <option value="">전체</option>
        <option value="alpha">Alpha</option>
        <option disabled value="beta">
          Beta
        </option>
        <option value="gamma">Gamma</option>
      </Select>
    </div>
  );
}

function SelectRerenderHarness(): ReactElement {
  const [tick, setTick] = useState(0);

  return (
    <div>
      <button type="button" onClick={() => setTick((prev) => prev + 1)}>
        rerender {tick}
      </button>
      <Select aria-label="환경 선택" value="alpha" onChange={() => undefined}>
        <option value="">전체</option>
        <option value="alpha">Alpha</option>
        <option value="gamma">Gamma</option>
      </Select>
    </div>
  );
}

describe('Select', () => {
  it('닫힌 상태의 부모 rerender만으로 option snapshot sync 루프에 빠지지 않는다', () => {
    render(<SelectRerenderHarness />);

    expect(screen.getByRole('combobox', { name: '환경 선택' })).toHaveTextContent('Alpha');

    fireEvent.click(screen.getByRole('button', { name: 'rerender 0' }));

    expect(screen.getByRole('combobox', { name: '환경 선택' })).toHaveTextContent('Alpha');
  });

  it('열린 상태에서도 option register effect가 무한 루프에 빠지지 않는다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      render(<SelectHarness />);

      fireEvent.click(screen.getByRole('combobox', { name: '환경 선택' }));

      await waitFor(() => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      });

      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('Maximum update depth exceeded');
    } finally {
      errorSpy.mockRestore();
    }
  });

  it('첫 오픈에서도 추가 layout tick 없이 listbox를 바로 렌더한다', () => {
    render(<SelectHarness />);

    fireEvent.click(screen.getByRole('combobox', { name: '환경 선택' }));

    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('label htmlFor로 포커스되고 hidden input과 runtime change payload를 유지한다', async () => {
    const onValueChange = vi.fn();
    const { container } = render(<SelectHarness onValueChange={onValueChange} />);

    fireEvent.click(screen.getByText('환경'));

    const combobox = screen.getByRole('combobox', { name: '환경 선택' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(combobox).toHaveClass('custom-select');
    expect(combobox).toHaveStyle({ width: '18rem' });

    const hiddenInput = container.querySelector('input[type="hidden"][name="env"]');
    expect(hiddenInput).toHaveValue('alpha');

    fireEvent.click(combobox);
    fireEvent.click(screen.getByRole('option', { name: '전체' }));

    await waitFor(() => {
      expect(onValueChange).toHaveBeenCalledWith('');
      expect(hiddenInput).toHaveValue('');
    });
  });

  it('Arrow/Home/End/Enter 흐름과 disabled option skip, Escape focus 복귀를 지원한다', async () => {
    render(<SelectHarness />);

    const combobox = screen.getByRole('combobox', { name: '환경 선택' });
    combobox.focus();

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    fireEvent.keyDown(combobox, { key: 'End' });
    fireEvent.keyDown(combobox, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: '환경 선택' })).toHaveTextContent('Gamma');
    });

    fireEvent.keyDown(combobox, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeInTheDocument();

    fireEvent.keyDown(combobox, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(combobox).toHaveFocus();
    });
  });

  it('modal overlay 안에서는 popup을 같은 overlay 안으로 portal한다', async () => {
    const { container } = render(
      <div className="modal-overlay">
        <div className="modal">
          <SelectHarness />
        </div>
      </div>,
    );

    fireEvent.click(screen.getByRole('combobox', { name: '환경 선택' }));

    const overlay = container.querySelector('.modal-overlay');
    expect(overlay).not.toBeNull();

    await waitFor(() => {
      expect(within(overlay as HTMLElement).getByRole('listbox')).toBeInTheDocument();
    });
  });
});
