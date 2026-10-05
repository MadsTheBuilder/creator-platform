import type { YouTubeSnapshot } from './youtube';
export function statistic(values: Record<string, string | boolean>, key: string): number | null {
  const raw = values[key];
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}
export function displayNumber(value: number | null) {
  return value === null ? 'Unavailable' : value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
// Interactions per view as a percentage; unavailable when views or any interaction is unreported.
export function engagementRate(views: number | null | undefined, ...interactions: (number | null | undefined)[]): string {
  if (typeof views !== 'number' || views <= 0 || interactions.some(v => typeof v !== 'number')) return 'Unavailable';
  return `${((interactions as number[]).reduce((a, b) => a + b, 0) / views * 100).toFixed(1)}%`;
}
export type DailyReport = { startDate: string; endDate: string; points: { date: string; value: number }[]; total: number | null };
export function reportSeries(snapshot: YouTubeSnapshot, days: number, metric: 'views' | 'estimatedMinutesWatched'): DailyReport {
  const start = new Date(`${snapshot.window.endDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  const startDate = start.toISOString().slice(0, 10) > snapshot.window.startDate ? start.toISOString().slice(0, 10) : snapshot.window.startDate;
  const report: DailyReport = { startDate, endDate: snapshot.window.endDate, points: [], total: null };
  const headers = snapshot.analytics?.columnHeaders ?? [];
  const dayIndex = headers.findIndex(h => h.name === 'day'), valueIndex = headers.findIndex(h => h.name === metric);
  if (snapshot.analyticsError || !snapshot.analytics || dayIndex < 0 || valueIndex < 0) return report;
  for (const row of snapshot.analytics.rows ?? []) {
    const date = row[dayIndex], raw = row[valueIndex];
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < startDate || date > report.endDate) continue;
    const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
    if (!Number.isFinite(value) || value < 0) return { ...report, points: [] };
    report.points.push({ date, value });
  }
  report.points.sort((a, b) => a.date.localeCompare(b.date));
  report.total = report.points.reduce((sum, p) => sum + p.value, 0);
  return report;
}
