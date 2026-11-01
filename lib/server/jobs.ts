import "server-only";
import { randomUUID } from "node:crypto";

export type Job = {
  id: string;
  kind: string;
  status: "running" | "done" | "error";
  progress: number;
  stage: string;
  result?: unknown;
  error?: string;
  createdAt: number;
};

// Kept on globalThis so jobs survive dev-server hot reloads.
const g = globalThis as unknown as { __creatorJobs?: Map<string, Job> };
const jobs = (g.__creatorJobs ??= new Map());

export function startJob(
  kind: string,
  work: (update: (patch: Partial<Pick<Job, "progress" | "stage">>) => void) => Promise<unknown>,
): Job {
  const job: Job = {
    id: randomUUID(),
    kind,
    status: "running",
    progress: 0,
    stage: "Starting",
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  work((patch) => Object.assign(job, patch))
    .then((result) => Object.assign(job, { status: "done", progress: 1, stage: "Done", result }))
    .catch((e: Error) => {
      console.error(`[job ${kind}]`, e);
      Object.assign(job, { status: "error", error: e.message });
    });
  // Forget jobs after an hour.
  for (const [id, j] of jobs) if (Date.now() - j.createdAt > 3_600_000) jobs.delete(id);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}
