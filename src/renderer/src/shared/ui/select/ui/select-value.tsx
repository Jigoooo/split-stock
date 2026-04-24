import type { ReactElement } from 'react';
import { useSelectContext } from '../model/select-context';
import type { SelectValueProps } from '../model/types';

export const SelectValue = ({ placeholder = '선택하세요' }: SelectValueProps): ReactElement => {
  const context = useSelectContext('Select.Value');
  const selectedOption = context.optionLookup.byValue.get(context.value);

  if (!selectedOption) {
    return <span className="hts-select__label hts-select__label--placeholder">{placeholder}</span>;
  }

  return <span className="hts-select__label">{selectedOption.label}</span>;
};
