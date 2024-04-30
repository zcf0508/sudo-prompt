interface AttemptInstance {
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

interface ExecOptions {
  name: string;
  icns?: string;
  env?: Record<string, string>;
}