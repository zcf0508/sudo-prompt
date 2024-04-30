import { mkdir, readFile, unlink, writeFile } from "node:fs";
import { basename, dirname, join } from "node:path";
import { APPLET, PERMISSION_DENIED } from "../constant";
import { EscapeDoubleQuotes } from ".";
import { exec } from "node:child_process";
import { promisify } from "node:util";

export function MacApplet(instance: any) {
  return new Promise<void>((resolve, reject) => {
    var parent = dirname(instance.path);
    mkdir(parent,
      function(error) {
        if (error) return reject(error);
        var zip = join(parent, 'sudo-prompt-applet.zip');
        writeFile(zip, APPLET, 'base64',
          function(error) {
            if (error) return reject(error);
            var command = [];
            command.push('/usr/bin/unzip');
            command.push('-o'); // Overwrite any existing applet.
            command.push('"' + EscapeDoubleQuotes(zip) + '"');
            command.push('-d "' + EscapeDoubleQuotes(instance.path) + '"');
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
  for (var key in instance.options.env) {
    var value = instance.options.env[key];
    script.push('export ' + key + '="' + EscapeDoubleQuotes(value) + '"');
  }
  script.push(instance.command);
  await promisify(writeFile)(path, script.join('\n'), 'utf-8');
}

export function MacIcon(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    if (!instance.options.icns) return reject();
    readFile(instance.options.icns,
      function(error, buffer) {
        if (error) return reject(error);
        var icns = join(
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
  return new Promise<void>((resolve, reject) => {
      // We must run the binary directly so that the cwd will apply.
      var binary = join(instance.path!, 'Contents', 'MacOS', 'applet');
      // We must set the cwd so that the AppleScript can find the shell scripts.
      var options = {
        cwd: dirname(binary),
        encoding: 'utf-8'
      };
      // We use the relative path rather than the absolute path. The instance.path
      // may contain spaces which the cwd can handle, but which exec() cannot.
      exec('./' + basename(binary), options, (error) => {
        if (error) {
          return reject(error);
        }
        resolve();
      });
  })
}

export function MacPropertyList(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    // Value must be in single quotes (not double quotes) according to man entry.
    // e.g. defaults write com.companyname.appname "Default Color" '(255, 0, 0)'
    // The defaults command will be changed in an upcoming major release to only
    // operate on preferences domains. General plist manipulation utilities will
    // be folded into a different command-line program.
    var plist = join(instance.path!, 'Contents', 'Info.plist');
    var path = EscapeDoubleQuotes(plist);
    var key = EscapeDoubleQuotes('CFBundleName');
    var value = instance.options.name + ' Password Prompt';
    if (/'/.test(value)) {
      return reject(new Error('Value should not contain single quotes.'));
    }
    var command = [];
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

export function MacResult(instance: AttemptInstance, end: (error: Error | null, stdout?: string, stderr?: string) => void) {
  var cwd = join(instance.path!, 'Contents', 'MacOS');
  readFile(join(cwd, 'code'), 'utf-8',
    function(error, code) {
      if (error) {
        if (error.code === 'ENOENT') return end(new Error(PERMISSION_DENIED));
        end(error);
      } else {
        readFile(join(cwd, 'stdout'), 'utf-8',
          function(error, stdout) {
            if (error) return end(error);
            readFile(join(cwd, 'stderr'), 'utf-8',
              function(error, stderr) {
                if (error) return end(error);
                const _code = parseInt(code.trim(), 10); // Includes trailing newline.
                if (_code === 0) {
                  end(null, stdout, stderr);
                } else {
                  error = new Error(
                    'Command failed: ' + instance.command + '\n' + stderr
                  );
                  error.code = code;
                  end(error, stdout, stderr);
                }
              }
            );
          }
        );
      }
    }
  );
}