const zone = 'Asia/Shanghai';
const monthFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });

export function explicitTimestamp(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return undefined;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}
export function shanghaiMonth(value: Date | number = new Date()): string {
  const parts = monthFormatter.formatToParts(value);
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`;
}
export function monthLabel(month: string): string { const [year, number] = month.split('-'); return `${year}年${Number(number)}月`; }
export function monthlyEntries<T extends { time: string }>(entries: T[], now: Date | number = new Date()) {
  const month = shanghaiMonth(now), current: T[] = [], unassigned: T[] = [];
  for (const entry of entries) {
    const timestamp = explicitTimestamp(entry.time);
    if (timestamp === undefined) unassigned.push(entry);
    else if (shanghaiMonth(timestamp) === month) current.push(entry);
  }
  return { month, label: monthLabel(month), current, unassigned };
}
export function recentProjects<T extends { updatedAt: string }>(projects: T[]): T[] {
  return projects.map((project, index) => ({ project, index, time: explicitTimestamp(project.updatedAt) })).sort((first, second) => {
    if (first.time !== undefined && second.time !== undefined) return second.time - first.time || first.index - second.index;
    if (first.time !== undefined) return -1;
    if (second.time !== undefined) return 1;
    return first.index - second.index;
  }).map(item => item.project);
}
export function projectTimeLabel(value: string): string {
  const timestamp = explicitTimestamp(value);
  return timestamp === undefined ? '历史时间未明确' : dateFormatter.format(timestamp);
}
