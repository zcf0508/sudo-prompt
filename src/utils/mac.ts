import { createReadStream, mkdir, readFile, readFileSync, unlink, writeFile } from "node:fs";
import { basename, dirname, join } from "node:path";
import { APPLET, PERMISSION_DENIED } from "../constant";
import { EscapeDoubleQuotes } from ".";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { AttemptInstance, SpawnReturn } from "../type";

export function MacApplet(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    const parent = dirname(instance.path!);
    mkdir(parent,
      function(error) {
        if (error) return reject(error);
        const zip = join(parent, 'sudo-prompt-applet.zip');
        writeFile(zip, APPLET, 'base64',
          function(error) {
            if (error) return reject(error);
            const command = [];
            command.push('/usr/bin/unzip');
            command.push('-o'); // Overwrite any existing applet.
            command.push('"' + EscapeDoubleQuotes(zip) + '"');
            command.push('-d "' + EscapeDoubleQuotes(instance.path!) + '"');
            exec(command.join(' '), { encoding: 'utf-8' }, (err) => {
              if(err) {
                return reject(err);
              }
              resolve();
            });
          }
        );
      }
    );
  })
 
}

export async function MacCommand(instance: AttemptInstance) {
  const path = join(
    instance.path!,
    'Contents',
    'MacOS',
    'sudo-prompt-command'
  );
  const script = [] as string[];
  // Preserve current working directory:
  // We do this for commands that rely on relative paths.
  // This runs in a subshell and will not change the cwd of sudo-prompt-script.
  script.push('cd "' + EscapeDoubleQuotes(process.cwd()) + '"');
  // Export environment variables:
  for (const key in instance.options.env) {
    const value = instance.options.env[key];
    script.push('export ' + key + '="' + EscapeDoubleQuotes(value) + '"');
  }
  script.push(instance.command);
  await promisify(writeFile)(path, script.join('\n'), 'utf-8');
}

export function MacIcon(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    if (!instance.options.icns) return resolve();
    readFile(instance.options.icns,
      function(error, buffer) {
        if (error) return reject(error);
        const icns = join(
          instance.path!,
          'Contents',
          'Resources',
          'applet.icns'
        );
        writeFile(icns, buffer, (error) => {
          if(error){
            return reject(error);
          }
          resolve();
        });
      }
    );
  })
  
}

export function MacOpen(instance: AttemptInstance) {
  return new Promise<SpawnReturn>((resolve, reject) => {
      const cwd = join(instance.path!, 'Contents', 'MacOS');
      // We must run the binary directly so that the cwd will apply.
      const binary = join(instance.path!, 'Contents', 'MacOS', 'applet');
      // We must set the cwd so that the AppleScript can find the shell scripts.
      const options = {
        cwd: dirname(binary),
      };
      // We use the relative path rather than the absolute path. The instance.path
      // may contain spaces which the cwd can handle, but which exec() cannot.
      exec('./' + basename(binary), options, (error) => {
        if(error) {
          return reject(error);
        }
        const stdout = createReadStream(join(cwd, 'stdout'));
        const stderr = createReadStream(join(cwd, 'stderr'));
        resolve({ stdout, stderr });
      })
  })
}

export function MacPropertyList(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    // Value must be in single quotes (not double quotes) according to man entry.
    // e.g. defaults write com.companyname.appname "Default Color" '(255, 0, 0)'
    // The defaults command will be changed in an upcoming major release to only
    // operate on preferences domains. General plist manipulation utilities will
    // be folded into a different command-line program.
    const plist = join(instance.path!, 'Contents', 'Info.plist');
    const path = EscapeDoubleQuotes(plist);
    const key = EscapeDoubleQuotes('CFBundleName');
    const value = instance.options.name + ' Password Prompt';
    if (/'/.test(value)) {
      return reject(new Error('Value should not contain single quotes.'));
    }
    const command = [];
    command.push('/usr/bin/defaults');
    command.push('write');
    command.push('"' + path + '"');
    command.push('"' + key + '"');
    command.push("'" + value + "'"); // We must use single quotes for value.
    exec(command.join(' '), { encoding: 'utf-8' }, (error) => {
      if(error) {
        return reject(error);
      }
      resolve();
    });
  })
  
}