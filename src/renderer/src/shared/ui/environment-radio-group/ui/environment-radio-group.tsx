import type { AppEnv } from '@shared/contracts';
import type { ReactElement, ReactNode } from 'react';
import { RadioGroup } from './radio-group';

export interface EnvironmentRadioGroupProps {
  value: AppEnv;
  onChange: (next: AppEnv) => void;
  name: string;
  ariaLabel: string;
  dense?: boolean;
  mockDescription?: ReactNode;
  prodDescription?: ReactNode;
}

export const EnvironmentRadioGroup = ({
  value,
  onChange,
  name,
  ariaLabel,
  dense = false,
  mockDescription,
  prodDescription,
}: EnvironmentRadioGroupProps): ReactElement => (
  <RadioGroup<AppEnv>
    name={name}
    ariaLabel={ariaLabel}
    value={value}
    onChange={onChange}
    dense={dense}
    items={[
      { value: 'MOCK', label: '모의투자', description: mockDescription },
      { value: 'PROD', label: '실전', description: prodDescription },
    ]}
  />
);
