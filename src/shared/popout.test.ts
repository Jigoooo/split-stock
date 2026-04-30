import { describe, expect, it } from 'vitest';
import {
  getPopoutLabel,
  getPopoutRouteConfig,
  getPopoutWindowTitle,
  isPopoutRoute,
  POPOUT_ROUTES,
} from './popout';

describe('popout config', () => {
  it('허용된 route만 통과시킨다', () => {
    expect(isPopoutRoute('logs')).toBe(true);
    expect(isPopoutRoute('add-watch-order')).toBe(true);
    expect(isPopoutRoute('unknown')).toBe(false);
  });

  it('타이틀과 라벨을 중앙 정의에서 제공한다', () => {
    expect(POPOUT_ROUTES).toContain('settings');
    expect(getPopoutLabel('logs')).toBe('이벤트 로그');
    expect(getPopoutWindowTitle('settings')).toBe('Split Stock · 설정');
  });

  it('자동감시 추가 팝업은 콘텐츠 높이 기반 리사이즈를 허용한다', () => {
    expect(getPopoutRouteConfig('add-watch-order')).toMatchObject({
      autoContentHeight: true,
      defaultWidth: 1240,
      minWidth: 900,
    });
    expect(getPopoutRouteConfig('add-watch-order').minHeight).toBeUndefined();
  });

  it('이벤트 로그 팝업은 로그 테이블을 위해 넓은 기본 폭을 사용한다', () => {
    expect(getPopoutRouteConfig('logs')).toMatchObject({
      defaultWidth: 1280,
      minWidth: 900,
    });
  });
});
