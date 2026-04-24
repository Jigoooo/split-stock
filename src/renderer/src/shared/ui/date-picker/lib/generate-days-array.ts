import { addDays, eachDayOfInterval, endOfMonth, getDay, startOfMonth, subDays } from 'date-fns';

export function generateDaysArray(year: number, month: number) {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(new Date(year, month));
  const daysInMonth = eachDayOfInterval({ start, end });
  const startPaddingDays = Array.from({ length: getDay(start) })
    .map((_, index) => subDays(start, index + 1))
    .reverse();
  const endPaddingDays = Array.from({ length: 6 - getDay(end) }).map((_, index) =>
    addDays(end, index + 1),
  );

  return [...startPaddingDays, ...daysInMonth, ...endPaddingDays];
}
