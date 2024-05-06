import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import {
  EscapeDoubleQuotes,
  LinuxBinary,
  MacApplet,
  MacCommand,
  MacIcon,
  MacOpen,
  MacPropertyList,
  Remove,
  UUID,
  ValidName,
  WindowsElevate,
  WindowsWriteCommandScript,
  WindowsWriteExecuteScript,
} from './utils';
import { mkdir } from 'node:fs/promises';
import { Stream } from 'stream';
import { AttemptInstance, ExecOptions, SpawnReturn } from './type';

async function _spawn(
  command: string,
  options: ExecOptions
): Promise<SpawnReturn | undefined> {

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
    const platform = process.platform;
    if (platform === 'darwin') {
      return await Mac(instance);
    } else if (platform === 'linux') {
      return await Linux(instance);
    } else if (platform === 'win32') {
      return await Windows(instance);
    } else {
      throw new Error('Platform not yet supported.');
    }

  } catch (error) {
    throw error;
  }
}

async function Linux(instance: AttemptInstance): Promise<SpawnReturn> {
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

  return spawn(command.join(' '));
}

async function Mac(instance: AttemptInstance): Promise<SpawnReturn | undefined> {
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
    return await MacOpen(instance);
  } catch(e) {
    console.log(e)
  }finally {
    await Remove(path.dirname(instance.path));
  }
}

async function Windows(instance: AttemptInstance): Promise<SpawnReturn | undefined> {
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
    await mkdir(instance.path);
    await WindowsWriteExecuteScript(instance);
    await WindowsWriteCommandScript(instance);
    return await WindowsElevate(instance);
  } catch(e) {
    console.log(e)
  }finally {
    await Remove(instance.path);
  }
}

function _exec(
  command: string,
  options: ExecOptions,
  callback?: (error?: Error | null, stdout?: string, stderr?: string) => void,
) {
  _spawn(command, options).then((res) => {
    if(!res) {
      return callback?.(new Error('Command failed'))
    }

    const { stdout, stderr } = res
    let out = ''
    let err = ''
    stdout?.on('data', (data) => {
      out += data.toString()
    })
    stderr?.on('data', (data) => {
      err += data.toString()
    })

    stderr?.on('end', () => {
      callback?.(null, out, err)
    })
  }).catch((error) => {
    callback?.(error as Error)
  })
}

export { 
  _spawn as spawn,
  _exec as exec
};