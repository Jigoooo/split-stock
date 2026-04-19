import { trpc } from '@renderer/shared/api/trpc';
import { startTransition, useState } from 'react';

export interface UseLotLogResult {
  dates: string[];
  datesLoading: boolean;
  selectedDate: string | null;
  selectDate: (date: string) => void;
  search: string;
  setSearch: (v: string) => void;
  snapshots: SnapshotRow[];
  snapshotsLoading: boolean;
}

export interface LotEntry {
  nth: number;
  buyPrice: number;
  qty: number;
  amountKrw: number;
  status: string;
}

export interface SnapshotRow {
  pdno: string;
  name: string;
  currentPrice: number;
  lots: LotEntry[];
}

export function useLotLog(): UseLotLogResult {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [search, setSearchRaw] = useState('');
  const [pendingSearch, setPendingSearch] = useState('');

  const datesQuery = trpc.lots.listSnapshotDates.useQuery({});
  const dates = datesQuery.data?.dates ?? [];

  // 첫 번째 날짜 자동 선택
  const activeDate = selectedDate ?? dates[0] ?? null;

  const snapshotsQuery = trpc.lots.snapshot.useQuery(
    { date: activeDate ?? '', pdno: undefined },
    { enabled: activeDate !== null },
  );

  const rawSnapshots = snapshotsQuery.data?.snapshots ?? [];

  // useTransition으로 검색 필터 적용
  const filtered =
    pendingSearch.trim() === ''
      ? rawSnapshots
      : rawSnapshots.filter(
          (s) => s.pdno.includes(pendingSearch.trim()) || s.name.includes(pendingSearch.trim()),
        );

  const setSearch = (v: string): void => {
    setSearchRaw(v);
    startTransition(() => {
      setPendingSearch(v);
    });
  };

  const selectDate = (date: string): void => {
    startTransition(() => {
      setSelectedDate(date);
    });
  };

  return {
    dates,
    datesLoading: datesQuery.isPending,
    selectedDate: activeDate,
    selectDate,
    search,
    setSearch,
    snapshots: filtered.map((s) => ({
      pdno: s.pdno,
      name: s.name,
      currentPrice: s.currentPrice,
      lots: s.lots.map((l) => ({
        nth: l.nth,
        buyPrice: l.buyPrice,
        qty: l.qty,
        amountKrw: l.amountKrw,
        status: l.status,
      })),
    })),
    snapshotsLoading: snapshotsQuery.isPending,
  };
}
