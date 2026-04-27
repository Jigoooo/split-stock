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

    const sectionLabel = this.props.name ? `${this.props.name} 영역` : '이 섹션';
    return (
      <div className="panel" role="alert">
        <div className="panel__title">
          {this.props.name ? `${this.props.name} 오류` : '섹션 오류'}
        </div>
        <div className="panel__body" style={{ display: 'grid', gap: '0.6rem', lineHeight: 1.55 }}>
          <p style={{ margin: 0 }}>
            {sectionLabel}을 표시하는 중 문제가 발생했습니다. <strong>다시 시도</strong> 를 누르면
            영역만 다시 그립니다.
          </p>
          <details
            style={{
              padding: '0.5rem 0.7rem',
              border: '1px solid var(--border)',
              borderRadius: '0.3rem',
              background: 'var(--bg-3, var(--surface-hover))',
            }}
          >
            <summary
              style={{
                cursor: 'pointer',
                fontSize: '0.95rem',
                color: 'var(--fg-2)',
                fontWeight: 600,
              }}
            >
              기술 정보
            </summary>
            <pre
              style={{
                margin: '0.5rem 0 0',
                padding: '0.5rem',
                overflowX: 'auto',
                fontSize: '0.9rem',
                lineHeight: 1.4,
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: '0.25rem',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                color: 'var(--up)',
              }}
            >
              {error.name}: {error.message}
              {error.stack ? `\n\n${error.stack}` : ''}
            </pre>
          </details>
          <button
            type="button"
            onClick={this.reset}
            style={{
              alignSelf: 'flex-start',
              padding: '0.3rem 0.8rem',
              fontSize: '1rem',
              cursor: 'pointer',
              border: '1px solid var(--border-strong, var(--border))',
              borderRadius: 3,
              background: 'transparent',
              fontWeight: 600,
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
