import { useColors } from '@renderer/shared/theme';
import { ChevronLeft, ChevronRight } from 'lucide-react';

type DatePickerNavigationButtonProps = {
  direction: 'prev' | 'next';
  disabled?: boolean;
  onClick: () => void;
};

export function DatePickerNavigationButton({
  direction,
  disabled = false,
  onClick,
}: DatePickerNavigationButtonProps) {
  const colors = useColors();
  const Icon = direction === 'prev' ? ChevronLeft : ChevronRight;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: '2.8rem',
        height: '2.8rem',
        borderRadius: '999px',
        border: `1px solid ${colors.border.default}`,
        backgroundColor: disabled ? colors.bg.subtle : colors.bg.elevated,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Icon size={16} color={disabled ? colors.text.disabled : colors.text.secondary} />
    </button>
  );
}
