import { MainPage } from '@renderer/pages/main';
import type { ReactElement } from 'react';
import type { PopoutApi } from '../model/use-popout-state';

export interface PanelWorkspaceProps {
  /**
   * 팝아웃 컨트롤러. 현재 메인 화면(MainPage) 자체는 팝아웃 분리 대상이 아니므로
   * 사용하지 않지만, AppShell → PanelWorkspace 호출 시그니처 호환을 위해 유지한다.
   * (header 의 외부 팝아웃 버튼들은 AppShell 이 직접 props 로 전달받아 처리.)
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
export const PanelWorkspace = (_props: PanelWorkspaceProps): ReactElement => {
  return <MainPage />;
};
