// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EnvironmentRadioGroup } from './environment-radio-group';

describe('EnvironmentRadioGroup', () => {
  it('모의/실전 선택을 AppEnv 값으로 올린다', () => {
    const onChange = vi.fn();

    render(
      <EnvironmentRadioGroup name="env" ariaLabel="환경" value="MOCK" onChange={onChange} dense />,
    );

    expect(screen.getByRole('radio', { name: /^모의투자/ })).toBeChecked();

    fireEvent.click(screen.getByRole('radio', { name: /^실전/ }));

    expect(onChange).toHaveBeenCalledWith('PROD');
  });
});
