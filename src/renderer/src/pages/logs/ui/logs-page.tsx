import { thousandSeparator } from '@renderer/shared/lib/formatter';
import { type ReactElement, useEffect, useState } from 'react';
import { formatLogTs } from '../config/log-table';
import { buildLogPayloadView } from '../lib/log-payload';
import { type LogEntry, type LogExportFormat, useLogTail } from '../model/use-log-tail';
import { LogDetailPanel } from './log-detail-panel';
import { LogsCategoryStatus } from './logs-category-status';
import { LogsTable } from './logs-table';
import { LogsToolbar } from './logs-toolbar';

export const LogsPage = (): ReactElement => {
  const { actions, data, filters, status } = useLogTail();
  const [selectedId, setSelectedId] = useState<LogEntry['id'] | null>(null);
  const [actionMessage, setActionMessage] = useState('');

  useEffect(() => {
    if (data.entries.length === 0) {
      setSelectedId(null);
      return;
    }

    if (selectedId !== null && data.entries.some((entry) => entry.id === selectedId)) {
      return;
    }

    setSelectedId(data.entries[0]?.id ?? null);
  }, [data.entries, selectedId]);

  const selectedEntry = data.entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedPayload = buildLogPayloadView(selectedEntry?.payloadJson ?? null);
  const selectedSummary = selectedEntry
    ? `${selectedEntry.category} · ${formatLogTs(selectedEntry.ts)}`
    : '로그를 선택하면 아래 상세 카드에서 payload를 확인할 수 있습니다.';
  const statusText =
    actionMessage ||
    (status.isFilterSettling || status.isPlaceholderData
      ? '필터를 적용하는 중입니다. 이전 결과를 유지하고 있습니다.'
      : '행을 선택하면 아래에서 payload를 정렬된 JSON으로 확인할 수 있습니다.');
  const exportDisabled = status.isFilterSettling || status.isPlaceholderData;

  const handleExport = async (format: LogExportFormat): Promise<void> => {
    const result = await actions.exportLogs(format);
    if (result.canceled) {
      setActionMessage(`${format.toUpperCase()} 저장이 취소되었습니다.`);
      return;
    }

    setActionMessage(
      `${result.filename ?? `${format}.tmp`} 저장 완료 · ${thousandSeparator(result.count ?? 0)}건`,
    );
  };

  const handleCopyPayload = async (): Promise<void> => {
    if (!selectedEntry?.payloadJson) {
      setActionMessage('복사할 payload 가 없습니다.');
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      setActionMessage('이 환경에서는 클립보드 복사를 사용할 수 없습니다.');
      return;
    }

    try {
      await navigator.clipboard.writeText(selectedPayload.pretty);
      setActionMessage('payload 복사 완료');
    } catch (error) {
      setActionMessage(
        `payload 복사 실패: ${error instanceof Error ? error.message : '알 수 없음'}`,
      );
    }
  };

  return (
    <div
      className="panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <LogsToolbar
        dateRange={filters.dateRange}
        entriesCount={data.entries.length}
        exportDisabled={exportDisabled}
        exportPending={status.exportPending}
        level={filters.level}
        onExport={handleExport}
        search={filters.search}
        stream={filters.stream}
        setDateRange={actions.setDateRange}
        setLevel={actions.setLevel}
        setSearch={actions.setSearch}
        setStream={actions.setStream}
      />
      <LogsCategoryStatus
        categories={filters.categories}
        setCategories={actions.setCategories}
        statusText={statusText}
      />
      <LogsTable
        entries={data.entries}
        error={status.error}
        isFilterSettling={status.isFilterSettling || status.isPlaceholderData}
        isPending={status.isPending}
        onSelect={setSelectedId}
        selectedId={selectedId}
      />
      <LogDetailPanel
        onCopyPayload={handleCopyPayload}
        payload={selectedPayload}
        selectedEntry={selectedEntry}
        selectedSummary={selectedSummary}
      />
    </div>
  );
};
