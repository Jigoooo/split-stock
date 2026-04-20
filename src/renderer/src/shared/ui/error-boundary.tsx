import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';

export interface ErrorBoundaryProps {
  /** 자식이 throw 할 때 fallback UI. error 와 reset 콜백을 받는다. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** 식별용 이름 (콘솔 출력 / fallback 표시) */
  name?: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 섹션 단위 ErrorBoundary.
 * - 한 폼이 throw 해도 페이지 전체가 흰화면이 되지 않도록 panel 단위로 감싼다.
 * - React 19 에서도 class component 만 componentDidCatch 를 지원한다.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error(`[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`, error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="panel" role="alert">
        <div className="panel__title">
          {this.props.name ? `${this.props.name} 오류` : '섹션 오류'}
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.4rem' }}>
          <span className="chip chip--down">{error.message}</span>
          <button
            type="button"
            onClick={this.reset}
            style={{
              alignSelf: 'flex-start',
              padding: '0.25rem 0.6rem',
              fontSize: '1rem',
              cursor: 'pointer',
              border: '1px solid var(--hts-line, rgba(0,0,0,0.2))',
              borderRadius: 3,
              background: 'transparent',
            }}
          >
            다시 시도
          </button>
        </div>
      </div>
    );
  }
}

/**
 * 함수형 헬퍼: 짧게 감쌀 때.
 */
export function withSectionBoundary(name: string, node: ReactNode): ReactElement {
  return <ErrorBoundary name={name}>{node}</ErrorBoundary>;
}
