import { useState } from 'react';
import { PROD_CONFIRM_PHRASE } from '../lib/constants';

export interface PhraseGateState {
  ack: boolean;
  setAck: (next: boolean) => void;
  phrase: string;
  setPhrase: (next: string) => void;
  phraseOk: boolean;
  canConfirm: boolean;
  reset: () => void;
}

/**
 * PROD 게이트 공통 로직: 체크박스 동의 + phrase 타이핑 검증.
 * ProdConfirmModal 내부 + SwitchEnvSection 인라인 패널이 공유.
 */
export function usePhraseGate(): PhraseGateState {
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState('');
  const phraseOk = phrase === PROD_CONFIRM_PHRASE;
  const canConfirm = ack && phraseOk;
  const reset = (): void => {
    setAck(false);
    setPhrase('');
  };
  return { ack, setAck, phrase, setPhrase, phraseOk, canConfirm, reset };
}
