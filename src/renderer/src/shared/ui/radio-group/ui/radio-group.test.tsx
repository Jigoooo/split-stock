// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RadioGroup } from './radio-group';

describe('RadioGroup', () => {
  it('선택 전환을 onChange로 올린다', () => {
    const onChange = vi.fn();

    render(
      <RadioGroup
        name="env"
        ariaLabel="환경"
        value="MOCK"
        onChange={onChange}
        items={[
          { value: 'MOCK', label: '모의투자' },
          { value: 'PROD', label: '실전' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('radio', { name: '실전' }));

    expect(onChange).toHaveBeenCalledWith('PROD');
  });
});
