import type { ReactElement } from 'react';
import type { PopoutApi } from '../model/use-popout-state';

export interface HeaderPopoutButtonsProps {
  popout: PopoutApi;
}

export const HeaderPopoutButtons = ({ popout }: HeaderPopoutButtonsProps): ReactElement => {
  return (
    <>
      <button
        type="button"
        className="hts-btn"
        onClick={() => {
          void popout.popout('reports');
        }}
        aria-pressed={popout.isOpen('reports')}
        title="팝아웃 창"
      >
        📊 리포트{popout.isOpen('reports') ? ' (열림)' : ''}
      </button>
      <button
        type="button"
        className="hts-btn"
        onClick={() => {
          void popout.popout('settings');
        }}
        aria-pressed={popout.isOpen('settings')}
        title="팝아웃 창"
      >
        ⚙ 설정{popout.isOpen('settings') ? ' (열림)' : ''}
      </button>
    </>
  );
};
