// @vitest-environment jsdom

import { PROD_CONFIRM_PHRASE } from '@renderer/shared/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SwitchEnvDialog } from './switch-env-dialog';

function Harness({
  target,
  onConfirm = vi.fn(),
}: {
  target: 'MOCK' | 'PROD';
  onConfirm?: (t: 'MOCK' | 'PROD') => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <SwitchEnvDialog
      open={open}
      target={target}
      onConfirm={(t) => {
        onConfirm(t);
        setOpen(false);
      }}
      onCancel={() => setOpen(false)}
    />
  );
}

describe('SwitchEnvDialog — MOCK', () => {
  it('MOCK 전환은 단일 단계로 즉시 전환 가능', () => {
    const onConfirm = vi.fn();
    render(<Harness target="MOCK" onConfirm={onConfirm} />);
    const confirmBtn = screen.getByRole('button', { name: '전환' });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('MOCK');
  });
});

describe('SwitchEnvDialog — PROD (ProdConfirmModal 위임)', () => {
  it('처음부터 체크박스 + phrase 입력 노출', () => {
    render(<Harness target="PROD" />);
    expect(screen.getByRole('checkbox', { name: '실전 모드 동의' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '실전전환 확인 문구' })).toBeInTheDocument();
  });

  it('체크박스 미체크 또는 문구 불일치 → confirm 버튼 disabled', () => {
    render(<Harness target="PROD" />);

    const confirmBtn = screen.getByRole('button', { name: '실전 전환 (실전)' });
    expect(confirmBtn).toBeDisabled();

    // 체크박스만
    fireEvent.click(screen.getByRole('checkbox', { name: '실전 모드 동의' }));
    expect(confirmBtn).toBeDisabled();

    // 문구 오타
    fireEvent.change(screen.getByRole('textbox', { name: '실전전환 확인 문구' }), {
      target: { value: '실전' },
    });
    expect(confirmBtn).toBeDisabled();
  });

  it('체크박스 ON + "실전전환" 정확 타이핑 시 버튼 enabled + confirm 호출', () => {
    const onConfirm = vi.fn();
    render(<Harness target="PROD" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole('checkbox', { name: '실전 모드 동의' }));
    fireEvent.change(screen.getByRole('textbox', { name: '실전전환 확인 문구' }), {
      target: { value: PROD_CONFIRM_PHRASE },
    });

    const confirmBtn = screen.getByRole('button', { name: '실전 전환 (실전)' });
    expect(confirmBtn).not.toBeDisabled();
    fireEvent.click(confirmBtn);
    expect(onConfirm).toHaveBeenCalledWith('PROD');
  });
});

describe('SwitchEnvDialog — 닫힘/취소', () => {
  it('open=false 이면 null 렌더', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <SwitchEnvDialog open={false} target="PROD" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('취소 버튼 → onCancel 호출', () => {
    const onCancel = vi.fn();
    render(<SwitchEnvDialog open target="PROD" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: '취소' }));
    expect(onCancel).toHaveBeenCalled();
  });
});
