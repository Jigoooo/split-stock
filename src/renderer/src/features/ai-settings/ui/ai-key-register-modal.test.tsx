// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AiKeyRegisterModal } from './ai-key-register-modal';

describe('AiKeyRegisterModal', () => {
  it('모델 선택 카드를 radio로 노출하고 설명을 hover 없이 표시한다', () => {
    render(<AiKeyRegisterModal editingConfig={null} onClose={vi.fn()} onSubmit={vi.fn()} />);

    const modelGroup = screen.getByRole('radiogroup', { name: 'AI 모델' });
    const haiku = within(modelGroup).getByRole('radio', { name: /Haiku 4\.5/ });
    const sonnet = within(modelGroup).getByRole('radio', { name: /Sonnet 4\.6/ });

    expect(haiku).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/가장 빠르고 저렴한 모델/)).toBeVisible();
    expect(screen.getByText(/Input \$0\.80/)).toBeVisible();

    fireEvent.click(sonnet);

    expect(sonnet).toHaveAttribute('aria-checked', 'true');
  });
});
