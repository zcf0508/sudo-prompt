import { Readable } from "node:stream";

export interface AttemptInstance {
  pathStatus?: string;
  pathStderr?: string;
  pathStdout?: string;
  pathCommand?: string;
  pathExecute?: string;
  pathElevate?: string;
  command: string;
  options: ExecOptions;
  uuid: string | undefined;
  path: string | undefined;
}

export interface ExecOptions {
  name: string;
  icns?: string;
  env?: Record<string, string>;
}

export interface SpawnReturn {
  stdout: Readable;
  stderr: Readable;
}