// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EditLotsModeToggle } from './edit-lots-mode-toggle';

describe('EditLotsModeToggle (수동편집 2단계 확인)', () => {
  it('자동매매 ON 상태 → 진입 버튼 disabled', () => {
    render(
      <EditLotsModeToggle
        accountId={1}
        masterSafetyOn={true}
        active={false}
        onEnter={() => {}}
        onExit={() => {}}
      />,
    );
    const btn = screen.getByRole('button', { name: /수동편집 모드/ });
    expect(btn).toBeDisabled();
  });

  it('OFF 상태 → 클릭 후 1단계 모달 노출, "다음" → 2단계로 전환', () => {
    render(
      <EditLotsModeToggle
        accountId={1}
        masterSafetyOn={false}
        active={false}
        onEnter={() => {}}
        onExit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /수동편집 모드/ }));
    // 1단계
    expect(screen.getByText(/차수 수동편집 모드 1\/2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }));
    expect(screen.getByText(/차수 수동편집 모드 2\/2/)).toBeInTheDocument();
  });

  it('2단계: "수동편집" 미입력 또는 체크박스 미선택 시 진입 버튼 비활성', () => {
    const onEnter = vi.fn();
    render(
      <EditLotsModeToggle
        accountId={1}
        masterSafetyOn={false}
        active={false}
        onEnter={onEnter}
        onExit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /수동편집 모드/ }));
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }));
    // 진입 버튼은 default variant + disabled
    const enterBtn = screen.getByRole('button', { name: '진입' });
    expect(enterBtn).toBeDisabled();
    // 체크박스만 켜고 phrase 없이
    fireEvent.click(screen.getByRole('checkbox', { name: '수동편집 위험 동의' }));
    expect(enterBtn).toBeDisabled();
    // phrase 잘못 입력
    fireEvent.change(screen.getByLabelText('수동편집 확인 문구'), {
      target: { value: '잘못된문구' },
    });
    expect(enterBtn).toBeDisabled();
    expect(onEnter).not.toHaveBeenCalled();
  });

  it('2단계: 체크박스 + "수동편집" 정확 입력 시 진입 버튼 활성 → onEnter 호출', () => {
    const onEnter = vi.fn(() => Promise.resolve());
    render(
      <EditLotsModeToggle
        accountId={1}
        masterSafetyOn={false}
        active={false}
        onEnter={onEnter}
        onExit={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /수동편집 모드/ }));
    fireEvent.click(screen.getByRole('button', { name: '다음 단계' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '수동편집 위험 동의' }));
    fireEvent.change(screen.getByLabelText('수동편집 확인 문구'), {
      target: { value: '수동편집' },
    });
    const enterBtn = screen.getByRole('button', { name: '진입' });
    expect(enterBtn).not.toBeDisabled();
    fireEvent.click(enterBtn);
    expect(onEnter).toHaveBeenCalled();
  });

  it('active=true → 종료 버튼만 노출', () => {
    const onExit = vi.fn();
    render(
      <EditLotsModeToggle
        accountId={1}
        masterSafetyOn={false}
        active={true}
        onEnter={() => {}}
        onExit={onExit}
      />,
    );
    const exitBtn = screen.getByRole('button', { name: '수동편집 모드 종료' });
    fireEvent.click(exitBtn);
    expect(onExit).toHaveBeenCalled();
  });
});
