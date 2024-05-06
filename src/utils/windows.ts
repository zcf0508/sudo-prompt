import { exec, spawn } from "node:child_process";
import { PERMISSION_DENIED } from "../constant";
import { readFile, stat, writeFile } from "node:fs";
import { AttemptInstance, SpawnReturn } from "../type";

export function WindowsElevate(instance: AttemptInstance) {
  return new Promise<SpawnReturn>((resolve, reject) => {
      // We used to use this for executing elevate.vbs:
    // const command = 'cscript.exe //NoLogo "' + instance.pathElevate + '"';
    const command = [];
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
    const child = spawn(command.join(' '));
    child.stdin?.end(); // Otherwise PowerShell waits indefinitely on Windows 7.
    resolve(child)
  })
  
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
    const cwd = process.cwd();
    if (/"/.test(cwd)) {
      // We expect double quotes to be reserved on Windows.
      // Even so, we test for this and abort if they are present.
      return reject(new Error('process.cwd() cannot contain double-quotes.'));
    }
    const script = [] as string[];
    script.push('@echo off');
    // Set code page to UTF-8:
    script.push('chcp 65001>nul');
    // Preserve current working directory:
    // We pass /d as an option in case the cwd is on another drive (issue 70).
    script.push('cd /d "' + cwd + '"');
    // Export environment variables:
    for (const key in instance.options.env) {
      // "The characters <, >, |, &, ^ are special command shell characters, and
      // they must be preceded by the escape character (^) or enclosed in
      // quotation marks. If you use quotation marks to enclose a string that
      // contains one of the special characters, the quotation marks are set as
      // part of the environment variable value."
      // In other words, Windows assigns everything that follows the equals sign
      // to the value of the variable, whereas Unix systems ignore double quotes.
      const value = instance.options.env[key];
      script.push('set ' + key + '=' + value.replace(/([<>\\|&^])/g, '^$1'));
    }
    script.push(instance.command);
    writeFile(instance.pathCommand!, script.join('\r\n'), 'utf-8', (error) => {
      if(error) {
        return reject()
      }
      resolve()
    });
  })
}

export function WindowsWriteExecuteScript(instance: AttemptInstance) {
  return new Promise<void>((resolve, reject) => {
    const script = [] as string[];
    script.push('@echo off');
    script.push(
      'call "' + instance.pathCommand + '"' +
      ' > "' + instance.pathStdout + '" 2> "' + instance.pathStderr + '"'
    );
    script.push('(echo %ERRORLEVEL%) > "' + instance.pathStatus + '"');
    writeFile(instance.pathExecute!, script.join('\r\n'), 'utf-8', (error) => {
      if(error) {
        return reject()
      }
      resolve()
    });
  })
}