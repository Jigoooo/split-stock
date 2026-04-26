// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMock = vi.fn(async () => {});
const useSaveCredentialsMock = vi.fn(() => ({
  save: saveMock,
  isPending: false,
  error: null,
}));

vi.mock('../model/use-save-credentials', () => ({
  useSaveCredentials: () => useSaveCredentialsMock(),
}));

import { CredentialsForm } from './credentials-form';

describe('CredentialsForm', () => {
  beforeEach(() => {
    saveMock.mockClear();
  });

  it('환경 선택과 입력값이 저장 payload에 그대로 반영된다', async () => {
    render(<CredentialsForm />);

    fireEvent.click(screen.getByRole('radio', { name: /^실전/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'App Key' }), {
      target: { value: 'app-key' },
    });
    fireEvent.change(screen.getByLabelText('App Secret'), {
      target: { value: 'app-secret' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '계좌 (앞 8자리)' }), {
      target: { value: '1234567890' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '상품코드 (뒤 2자리)' }), {
      target: { value: '0199' },
    });

    fireEvent.click(screen.getByRole('button', { name: '저장하고 접속' }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith({
        env: 'PROD',
        broker: 'KIS',
        appKey: 'app-key',
        appSecret: 'app-secret',
        accountNo8: '12345678',
        accountProdCd: '01',
      }),
    );
  });
});
