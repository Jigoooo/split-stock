import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { EventLogger } from '../logging/event-logger';

export interface StartupPerfMark {
  name: string;
  at: number;
  wallTime: string;
  metadata?: Record<string, unknown>;
}

const marks: StartupPerfMark[] = [];
let loggerSink: EventLogger | null = null;
let jsonlPath: string | null = process.env.SPLIT_STOCK_STARTUP_PERF_JSONL || null;
let loggerFlushIndex = 0;
let jsonlFlushIndex = 0;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function configureStartupPerf(input: {
  logger?: EventLogger | null;
  jsonlPath?: string | null;
}): void {
  if (input.logger !== undefined) loggerSink = input.logger;
  if (input.jsonlPath !== undefined) jsonlPath = input.jsonlPath;
  flushStartupPerf();
}

export function markStartup(name: string, metadata?: Record<string, unknown>): StartupPerfMark {
  const mark: StartupPerfMark = {
    name,
    at: nowMs(),
    wallTime: new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  };
  marks.push(mark);
  writeLatestMark();
  return mark;
}

export function getStartupPerfMarks(): readonly StartupPerfMark[] {
  return marks;
}

export function flushStartupPerf(): void {
  if (loggerSink) {
    for (let i = loggerFlushIndex; i < marks.length; i += 1) {
      writeLoggerMark(marks[i] as StartupPerfMark);
    }
    loggerFlushIndex = marks.length;
  }
  if (jsonlPath) {
    for (let i = jsonlFlushIndex; i < marks.length; i += 1) {
      writeJsonlMark(marks[i] as StartupPerfMark);
    }
    jsonlFlushIndex = marks.length;
  }
}

function writeLatestMark(): void {
  const mark = marks.at(-1);
  if (!mark) return;
  if (loggerSink) {
    writeLoggerMark(mark);
    loggerFlushIndex = marks.length;
  }
  if (jsonlPath) {
    writeJsonlMark(mark);
    jsonlFlushIndex = marks.length;
  }
}

function writeLoggerMark(mark: StartupPerfMark): void {
  if (loggerSink) {
    loggerSink.log({
      level: 'INFO',
      category: 'SYS',
      message: 'startup.perf.mark',
      payload: { ...mark },
    });
  }
}

function writeJsonlMark(mark: StartupPerfMark): void {
  if (!jsonlPath) return;
  try {
    mkdirSync(dirname(jsonlPath), { recursive: true });
    appendFileSync(jsonlPath, `${JSON.stringify(mark)}\n`);
  } catch {
    // Diagnostics must never affect startup.
  }
}

markStartup('process.module-loaded');
