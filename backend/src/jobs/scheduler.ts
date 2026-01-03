export interface ScheduledJob {
  name: string;
  interval: number; // milliseconds
  handler: () => Promise<void>;
  enabled: boolean;
}

interface RunningJob {
  job: ScheduledJob;
  timer: NodeJS.Timeout;
}

class JobScheduler {
  private jobs: Map<string, RunningJob> = new Map();
  private running: boolean = false;

  register(job: ScheduledJob): void {
    if (this.jobs.has(job.name)) {
      console.warn(`[Scheduler] Job "${job.name}" is already registered, skipping`);
      return;
    }

    if (!job.enabled) {
      console.log(`[Scheduler] Job "${job.name}" is disabled, not registering`);
      return;
    }

    // Create a placeholder entry (timer will be set on start)
    this.jobs.set(job.name, { job, timer: null as unknown as NodeJS.Timeout });
    console.log(`[Scheduler] Registered job "${job.name}" (interval: ${job.interval}ms)`);
  }

  start(): void {
    if (this.running) {
      console.warn('[Scheduler] Already running');
      return;
    }

    this.running = true;
    console.log('[Scheduler] Starting job scheduler...');

    for (const [name, runningJob] of this.jobs) {
      const { job } = runningJob;

      // Run immediately on start
      this.executeJob(job);

      // Then schedule for interval
      const timer = setInterval(() => {
        this.executeJob(job);
      }, job.interval);

      this.jobs.set(name, { job, timer });
      console.log(`[Scheduler] Started job "${name}"`);
    }

    console.log(`[Scheduler] All ${this.jobs.size} job(s) started`);
  }

  stop(): void {
    if (!this.running) {
      console.warn('[Scheduler] Not running');
      return;
    }

    console.log('[Scheduler] Stopping job scheduler...');

    for (const [name, runningJob] of this.jobs) {
      if (runningJob.timer) {
        clearInterval(runningJob.timer);
      }
      console.log(`[Scheduler] Stopped job "${name}"`);
    }

    this.running = false;
    console.log('[Scheduler] All jobs stopped');
  }

  async runJobNow(jobName: string): Promise<void> {
    const runningJob = this.jobs.get(jobName);
    if (!runningJob) {
      throw new Error(`Job "${jobName}" not found`);
    }
    await this.executeJob(runningJob.job);
  }

  private async executeJob(job: ScheduledJob): Promise<void> {
    try {
      await job.handler();
    } catch (error) {
      console.error(`[Scheduler] Error in job "${job.name}":`, error);
    }
  }

  getJobNames(): string[] {
    return Array.from(this.jobs.keys());
  }
}

export const scheduler = new JobScheduler();
