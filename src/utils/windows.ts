import { exec } from "node:child_process";
import { PERMISSION_DENIED } from "../constant";
import { readFile, stat, writeFile } from "node:fs";

export function WindowsElevate(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
      // We used to use this for executing elevate.vbs:
  // var command = 'cscript.exe //NoLogo "' + instance.pathElevate + '"';
  var command = [];
  command.push('powershell.exe');
  command.push('Start-Process');
  command.push('-FilePath');
  // Escape characters for cmd using double quotes:
  // Escape characters for PowerShell using single quotes:
  // Escape single quotes for PowerShell using backtick:
  // See: https://ss64.com/ps/syntax-esc.html
  command.push('"\'' + instance.pathExecute!.replace(/'/g, "`'") + '\'"');
  command.push('-WindowStyle hidden');
  command.push('-Verb runAs');
  var child = exec(command.join(' '), { encoding: 'utf-8' },
    function(error, stdout, stderr) {
      // We used to return PERMISSION_DENIED only for error messages containing
      // the string 'canceled by the user'. However, Windows internationalizes
      // error messages (issue 96) so now we must assume all errors here are
      // permission errors. This seems reasonable, given that we already run the
      // user's command in a subshell.
      if (error) return reject(new Error(PERMISSION_DENIED));
      resolve();
    }
  );
  child.stdin?.end(); // Otherwise PowerShell waits indefinitely on Windows 7.
  })
  
}

export function WindowsResult(instance: AttemptInstance, end: (error?: Error | null, stdout?: string, stderr?: string) => void) {
  readFile(instance.pathStatus!, 'utf-8',
    function(error, code) {
      if (error) return end(error);
      readFile(instance.pathStdout!, 'utf-8',
        function(error, stdout) {
          if (error) return end(error);
          readFile(instance.pathStderr!, 'utf-8',
            function(error, stderr) {
              if (error) return end(error);
              const _code = parseInt(code.trim(), 10);
              if (_code === 0) {
                end(undefined, stdout, stderr);
              } else {
                error = new Error(
                  'Command failed: ' + instance.command + '\r\n' + stderr
                );
                error.code = code;
                end(error, stdout, stderr);
              }
            }
          );
        }
      );
    }
  );
}

export function WindowsWaitForStatus(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    // VBScript cannot wait for the elevated process to finish so we have to poll.
  // VBScript cannot return error code if user does not grant permission.
  // PowerShell can be used to elevate and wait on Windows 10.
  // PowerShell can be used to elevate on Windows 7 but it cannot wait.
  // powershell.exe Start-Process cmd.exe -Verb runAs -Wait
  stat(instance.pathStatus!,
    function(error, stats) {
      if ((error && error.code === 'ENOENT') || stats.size < 2) {
        // Retry if file does not exist or is not finished writing.
        // We expect a file size of 2. That should cover at least "0\r".
        // We use a 1 second timeout to keep a light footprint for long-lived
        // sudo-prompt processes.
        setTimeout(
          function() {
            // If administrator has no password and user clicks Yes, then
            // PowerShell returns no error and execute (and command) never runs.
            // We check that command output has been redirected to stdout file:
            stat(instance.pathStdout!,
              async function(error) {
                if (error) return reject(new Error(PERMISSION_DENIED));
                await WindowsWaitForStatus(instance);
                resolve()
              }
            );
          },
          1000
        );
      } else if (error) {
        return reject(error);
      } 
      resolve()
    }
  );
  })
}

export function WindowsWriteCommandScript(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    var command = instance.command;
  if (instance.options.env) {
    command = Object.keys(instance.options.env).map(
      function(key) {
        return 'set "' + key + '=' + instance.options.env![key] + '"';
      }
    ).join('\r\n') + '\r\n' + command;
  }
  writeFile(instance.pathCommand!, command, 'utf-8',
    function(error) {
      if (error) return reject(error);
      resolve();
    }
  );
  })
}

export function WindowsWriteExecuteScript(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    const command = [] as string[];
    command.push('@echo off');
    command.push('call "' + instance.pathCommand + '"');
    command.push('echo %errorlevel% > "' + instance.pathStatus + '"');
    var child = exec(command.join('\r\n'), { encoding: 'utf-8' },
      function(error) {
        if (error) return reject(error);
        resolve();
      }
    );
    child.stdin?.end(); // Otherwise cmd.exe waits indefinitely on Windows 7.
  })
}