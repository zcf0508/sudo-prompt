import { exec } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { promisify } from 'util';
import {
  EscapeDoubleQuotes,
  LinuxBinary,
  MacApplet,
  MacCommand,
  MacIcon,
  MacOpen,
  MacPropertyList,
  MacResult,
  Remove,
  UUID,
  ValidName,
  WindowsElevate,
  WindowsResult,
  WindowsWaitForStatus,
  WindowsWriteCommandScript,
  WindowsWriteExecuteScript,
} from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PERMISSION_DENIED = 'User did not grant permission.';
const NO_POLKIT_AGENT = 'No polkit authentication agent found.';
const MAX_BUFFER = 134217728;

async function Attempt(instance: AttemptInstance, callback: (error: Error | null, stdout: string, stderr: string) => void): Promise<void> {
  const platform = process.platform;
  if (platform === 'darwin') {
    await Mac(instance, callback);
  } else if (platform === 'linux') {
    await Linux(instance);
  } else if (platform === 'win32') {
    await Windows(instance, callback);
  } else {
    throw new Error('Platform not yet supported.');
  }
}

async function Exec(
  command: string,
  options: ExecOptions,
): Promise<[string, string]>;
async function Exec(
  command: string,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
): Promise<void>;
async function Exec(
  command: string,
  options: ExecOptions,
  callback: (error: Error | null, stdout: string, stderr: string) => void,
): Promise<void>;
async function Exec(
  command: string,
  optionsOrCallback: ExecOptions | ((...args: unknown[]) => void),
  callback?: (error: Error | null, stdout: string, stderr: string) => void,
): Promise<void | [string, string]> {
  let options: ExecOptions;

  if (typeof optionsOrCallback === 'function') {
    callback = optionsOrCallback;
    options = { name: process.title };
  } else {
    options = optionsOrCallback
  }

  if (!ValidName(options.name)) {
    throw new Error(
      'options.name must be alphanumeric only (spaces are allowed) and <= 70 characters.',
    );
  }

  if (options.icns && (typeof options.icns !== 'string' || options.icns.trim().length === 0)) {
    throw new Error('options.icns must be a non-empty string if provided.');
  }

  if (
    options.env &&
    (typeof options.env !== 'object' ||
      Object.keys(options.env).length === 0 ||
      Object.entries(options.env).some(
        ([key, value]) => typeof key !== 'string' || typeof value !== 'string',
      ))
  ) {
    throw new Error('options.env must be a non-empty object with string keys and values.');
  }

  const instance: AttemptInstance = {
    command,
    options,
    uuid: undefined,
    path: undefined,
  };

  try {
    // @ts-ignore
    await Attempt(instance, callback);
    const [stdout, stderr] = await Promise.all([
      promisify(fs.readFile)(instance.path + 'stdout', 'utf-8'),
      promisify(fs.readFile)(instance.path + 'stderr', 'utf-8'),
    ]);

    if (callback) {
      callback(null, stdout, stderr);
    } else {
      return [stdout, stderr];
    }
  } catch (error) {
    if (callback) {
      // @ts-ignore
      callback(error, '', '');
    } else {
      throw error;
    }
  }
}

async function Linux(instance: AttemptInstance): Promise<void> {
  const binary = await LinuxBinary();
  const command = [
    `cd "${EscapeDoubleQuotes(process.cwd())}";`,
    ...Object.entries(instance.options.env || {}).map(
      ([key, value]) => `export ${key}="${EscapeDoubleQuotes(value)}";`,
    ),
    `"${EscapeDoubleQuotes(binary)}"`,
  ];

  if (/kdesudo/i.test(binary)) {
    command.push(
      '--comment',
      `"${instance.options.name} wants to make changes. Enter your password to allow this."`,
    );
    command.push('-d');
    command.push('--');
  } else if (/pkexec/i.test(binary)) {
    command.push('--disable-internal-agent');
  }

  const magic = 'SUDOPROMPT\n';
  command.push(
    `/bin/bash -c "echo ${EscapeDoubleQuotes(
      magic.trim(),
    )}; ${EscapeDoubleQuotes(instance.command)}"`,
  );

  const { stdout, stderr } = await promisify(exec)(command.join(' '), {
    encoding: 'utf-8',
    maxBuffer: MAX_BUFFER,
  });

  const elevated = stdout.slice(0, magic.length) === magic;
  if (elevated) {
    // Remove magic string
    (instance.path as string) += 'stdout';
    await promisify(fs.writeFile)(instance.path!, stdout.slice(magic.length), 'utf-8');
  } else {
    throw new Error(
      /No authentication agent found/.test(stderr) ? NO_POLKIT_AGENT : PERMISSION_DENIED,
    );
  }

  // Write stderr
  (instance.path as string) += 'stderr';
  await promisify(fs.writeFile)(instance.path!, stderr, 'utf-8');
}

async function Mac(instance: AttemptInstance, callback: (error: Error | null, stdout: string, stderr: string) => void): Promise<void> {
  const temp = os.tmpdir();
  if (!temp) throw new Error('os.tmpdir() not defined.');
  const user = process.env.USER;
  if (!user) throw new Error('env[\'USER\'] not defined.');

  instance.uuid = await UUID(instance);
  instance.path = path.join(temp, instance.uuid!, `${instance.options.name}.app`);

  try {
    await MacApplet(instance);
    await MacIcon(instance);
    await MacPropertyList(instance);
    await MacCommand(instance);
    await MacOpen(instance);
    // @ts-ignore
    MacResult(instance, callback);
  } catch(e) {
    console.log(e)
  }finally {
    await Remove(path.dirname(instance.path));
  }
}

async function Windows(instance: AttemptInstance, callback: (error: Error | null, stdout: string, stderr: string) => void): Promise<void> {
  const temp = os.tmpdir();
  if (!temp) throw new Error('os.tmpdir() not defined.');

  instance.uuid = await UUID(instance);
  instance.path = path.join(temp, instance.uuid!);

  if (/"/.test(instance.path)) {
    throw new Error('instance.path cannot contain double-quotes.');
  }

  instance.pathElevate = path.join(instance.path, 'elevate.vbs');
  instance.pathExecute = path.join(instance.path, 'execute.bat');
  instance.pathCommand = path.join(instance.path, 'command.bat');
  instance.pathStdout = path.join(instance.path, 'stdout');
  instance.pathStderr = path.join(instance.path, 'stderr');
  instance.pathStatus = path.join(instance.path, 'status');

  try {
    await promisify(fs.mkdir)(instance.path);
    await WindowsWriteExecuteScript(instance);
    await WindowsWriteCommandScript(instance);
    await WindowsElevate(instance);
    await WindowsWaitForStatus(instance);
    // @ts-ignore
    WindowsResult(instance, callback);
  } catch(e) {
    console.log(e)
  }finally {
    await Remove(instance.path);
  }
}

export { Exec };

export default Exec('echo hello', {name: 'test'})