import type { ReactElement } from 'react';
import { LOG_CATEGORIES, LOG_LEVELS, useLogTail } from '../model/use-log-tail';

export const LogsPage = (): ReactElement => {
  const { category, entries, error, isPending, level, setCategory, setLevel } = useLogTail();

  return (
    <div className="panel">
      <div className="panel__title">이벤트 로그 (실시간 tail)</div>
      <div
        className="panel__body"
        style={{ display: 'flex', gap: '0.8rem', alignItems: 'center', flexWrap: 'wrap' }}
      >
        <label>
          레벨:{' '}
          <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
            {LOG_LEVELS.map((l) => (
              <option key={l} value={l}>
                {l || '전체'}
              </option>
            ))}
          </select>
        </label>
        <label>
          카테고리:{' '}
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
            {LOG_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c || '전체'}
              </option>
            ))}
          </select>
        </label>
        <span className="muted" style={{ marginLeft: 'auto' }}>
          2초마다 새로고침 · {entries.length}건 표시
        </span>
      </div>
      <div className="panel__body" style={{ padding: 0 }}>
        <table className="hts-table">
          <thead>
            <tr>
              <th style={{ width: '12rem' }}>시각</th>
              <th style={{ width: '5rem' }}>레벨</th>
              <th style={{ width: '6rem' }}>카테고리</th>
              <th>메시지</th>
              <th>payload</th>
            </tr>
          </thead>
          <tbody>
            {isPending ? (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                  로드 중…
                </td>
              </tr>
            ) : null}
            {error ? (
              <tr>
                <td colSpan={5}>
                  <span className="chip chip--down">{error.message}</span>
                </td>
              </tr>
            ) : null}
            {entries.length === 0 && (
              <tr>
                <td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
                  기록된 로그가 없습니다.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id}>
                <td className="num">{formatTs(e.ts)}</td>
                <td>
                  <span className={levelClass(e.level)}>{e.level}</span>
                </td>
                <td>{e.category}</td>
                <td>{e.message}</td>
                <td className="muted" style={{ fontFamily: 'monospace', fontSize: '1.05rem' }}>
                  {e.payloadJson ?? ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

function formatTs(ts: Date | number | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('ko-KR', { hour12: false });
}

function levelClass(level: string): string {
  if (level === 'ERROR') return 'chip chip--down';
  if (level === 'WARN') return 'chip';
  return 'chip chip--up';
}
