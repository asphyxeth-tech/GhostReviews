/**
 * Thin HTTP client for Tower's Control Plane API (https://api.tower.dev/v1).
 *
 * Tower runs are async: trigger returns immediately with a run number, then
 * you poll status until terminal (`exited` = success) and fetch stdout from
 * the logs endpoint. The Next.js routes in src/app/api/analyze-tower/
 * compose these primitives into the request/poll/result flow the browser
 * sees.
 *
 * Auth: TOWER_API_KEY env var, sent as the X-API-Key header.
 * Generate one at https://app.tower.dev/ -> team settings -> API Keys.
 */

import type { AnalysisReport } from "./analysis-schema";

const TOWER_BASE_URL = "https://api.tower.dev/v1";

const TERMINAL_STATUSES = new Set([
  "exited",
  "crashed",
  "errored",
  "cancelled",
]);

export type TowerRunStatus =
  | "scheduled"
  | "retrying"
  | "pending"
  | "starting"
  | "running"
  | "crashed"
  | "errored"
  | "exited"
  | "cancelled";

export type TowerRun = {
  number: number;
  status: TowerRunStatus;
  app_name?: string;
  scheduled_at?: string;
  started_at?: string;
  ended_at?: string;
};

export type TowerLogLine = {
  content: string;
  channel: "program" | "setup";
  reported_at: string;
  line_num: number;
};

export type TowerConfig = {
  apiKey: string;
  appName: string;
  environment?: string;
};

export class TowerError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TowerError";
  }
}

export function getTowerConfig(): TowerConfig {
  const apiKey = process.env.TOWER_API_KEY;
  const appName = process.env.TOWER_APP_NAME || "ghost-reviews-pipeline";
  if (!apiKey) {
    throw new TowerError(
      "TOWER_API_KEY is not set in the server environment.",
      500,
    );
  }
  return { apiKey, appName };
}

async function towerFetch(
  path: string,
  apiKey: string,
  init: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${TOWER_BASE_URL}${path}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  return res;
}

export async function triggerTowerRun(
  config: TowerConfig,
  parameters: Record<string, string>,
): Promise<TowerRun> {
  const body = {
    environment: config.environment ?? "default",
    parameters,
  };
  const res = await towerFetch(`/apps/${config.appName}/runs`, config.apiKey, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TowerError(
      `Tower trigger failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const json = (await res.json()) as { run?: TowerRun };
  if (!json.run || typeof json.run.number !== "number") {
    throw new TowerError("Tower trigger response missing run.number");
  }
  return json.run;
}

export async function getTowerRun(
  config: TowerConfig,
  runSeq: number,
): Promise<TowerRun> {
  const res = await towerFetch(
    `/apps/${config.appName}/runs/${runSeq}`,
    config.apiKey,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TowerError(
      `Tower getRun failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const json = (await res.json()) as { run?: TowerRun };
  if (!json.run) throw new TowerError("Tower getRun response missing run");
  return json.run;
}

export async function getTowerRunLogs(
  config: TowerConfig,
  runSeq: number,
): Promise<TowerLogLine[]> {
  const res = await towerFetch(
    `/apps/${config.appName}/runs/${runSeq}/logs`,
    config.apiKey,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TowerError(
      `Tower getRunLogs failed (${res.status}): ${text || res.statusText}`,
      res.status,
    );
  }
  const json = (await res.json()) as { log_lines?: TowerLogLine[] };
  return json.log_lines ?? [];
}

export function isTerminalStatus(status: TowerRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/**
 * Walk the log lines looking for the sentinel emitted by pipeline/task.py
 * (`__GHOST_RESULT__:{...json...}` on a single line) and parse the embedded
 * AnalyzeResponse-shaped JSON. Returns null if no sentinel is present.
 */
export function extractResultFromLogs(
  logs: TowerLogLine[],
): { mode: string; business_url: string; report: AnalysisReport } | null {
  const PREFIX = "__GHOST_RESULT__:";
  for (const line of logs) {
    if (line.channel !== "program") continue;
    const idx = line.content.indexOf(PREFIX);
    if (idx === -1) continue;
    const jsonStr = line.content.slice(idx + PREFIX.length).trim();
    try {
      return JSON.parse(jsonStr);
    } catch {
      continue;
    }
  }
  return null;
}
