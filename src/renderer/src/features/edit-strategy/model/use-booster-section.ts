import { useState } from 'react';

export interface BoosterSectionRaw {
  boosterPct: string;
  boosterAmountKrw: string;
}

export interface UseBoosterSectionReturn {
  raw: BoosterSectionRaw;
  update: (key: keyof BoosterSectionRaw) => (value: string) => void;
}

/**
 * 수익부스터 섹션 상태 hook.
 * - boosterPct: 감시% (퍼센트 문자열, 빈 문자열 = 미설정)
 * - boosterAmountKrw: 재매수금액 (원 문자열, 빈 문자열 = 미설정)
 */
export function useBoosterSection(initialRaw: BoosterSectionRaw): UseBoosterSectionReturn {
  const [raw, setRaw] = useState<BoosterSectionRaw>(initialRaw);

  const update = (key: keyof BoosterSectionRaw) => (value: string) => {
    setRaw((prev) => ({ ...prev, [key]: value }));
  };

  return { raw, update };
}
