export interface PerformanceSample {
  task: string;
  priority: 'interactive' | 'normal' | 'background';
  queueMs: number;
  runMs: number;
  outcome: 'complete' | 'cancelled' | 'failed';
}
export interface ApplicationPerformanceSnapshot {
  lowResource: boolean;
  pending: number;
  running?: Pick<PerformanceSample, 'task' | 'priority'>;
  recent: PerformanceSample[];
  measuredAt: string;
  cpuPercent?: number;
  memoryMb?: number;
  preferenceError?: string;
}
export interface ApplicationPerformanceBridge {
  read: () => Promise<ApplicationPerformanceSnapshot>;
  save: (input: { lowResource: boolean }) => Promise<ApplicationPerformanceSnapshot>;
}
