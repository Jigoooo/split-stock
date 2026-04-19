// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountSummaryPanel } from './account-summary-panel';

describe('AccountSummaryPanel', () => {
  it('숫자를 세 자리 구분자로 표시한다', () => {
    render(<AccountSummaryPanel deposit={1234567} totalEval={9876543} positionsCount={12} />);

    expect(screen.getByText('1,234,567')).toBeInTheDocument();
    expect(screen.getByText('9,876,543')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
