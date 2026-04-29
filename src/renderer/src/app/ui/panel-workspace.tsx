import { MainPage } from '@renderer/pages/main';
import type { ReactElement } from 'react';
import type { PopoutApi } from '../model/use-popout-state';

export interface PanelWorkspaceProps {
  /**
   * 팝아웃 컨트롤러. 메인 내부 CTA가 설정 popout을 열 때 사용한다.
   */
  popout: PopoutApi;
}

/**
 * 사용자 가시 메인 작업 영역.
 *
 * Wave 4 cutover 이후로는 단일 `<MainPage />` 만 마운트한다 — 좌(포지션/자동감시)
 * + 우(매매내역) 좌우 split 으로 ASIS 매직스플릿 메인 스타일을 재현.
 *
 * 기존 3-panel(대시보드/이벤트로그/주문) 구조는 popout 전용으로 보존되며 PopoutPage 에서만 마운트.
 */
export const PanelWorkspace = ({ popout }: PanelWorkspaceProps): ReactElement => {
  return (
    <MainPage
      onOpenStockPicker={() => popout.popout('stock-picker')}
      onOpenStrategySettings={() => popout.popout('settings')}
    />
  );
};
