import type { ReactElement } from 'react';
import { memo } from 'react';
import { ControlPopup } from '../../control-popup';
import { joinClasses } from '../lib/date-input-values';
import { useDatePickerContext } from '../model/date-input-context';
import type { DateInputContentProps } from '../model/types';

export const DateInputContent = memo(
  ({ children, className, style }: DateInputContentProps): ReactElement => {
    const context = useDatePickerContext('DateInput.Content');

    return (
      <ControlPopup
        anchorRef={context.rootRef}
        className={joinClasses('hts-control-popup', 'hts-control-popup--date', className)}
        id={`${context.inputId}-calendar`}
        onDismiss={(reason) => context.dismissPopup(reason)}
        open={context.open}
        portalMode="body"
        popupRef={context.popupRef}
        role="dialog"
        style={style}
        widthMode="content"
        minWidth={296}
        animate={false}
      >
        {children}
      </ControlPopup>
    );
  },
);

DateInputContent.displayName = 'DateInputContent';
