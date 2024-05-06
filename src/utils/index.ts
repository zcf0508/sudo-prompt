import { exec } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { normalize } from 'node:path';
import { AttemptInstance } from '../type';

export * from './linux';
export * from './mac';
export * from './windows';


export function EscapeDoubleQuotes(string: string) {
  if (typeof string !== 'string') throw new Error('Expected a string.');
  return string.replace(/"/g, '\\"');
}

export function Remove(path: string) {
  return new Promise<void>((resolve, reject) => {
    if (typeof path !== 'string' || !path.trim()) {
      return reject(new Error('Argument path not defined.'));
    }
    const command = [] as string[];
    if (process.platform === 'win32') {
      if (/"/.test(path)) {
        return reject(new Error('Argument path cannot contain double-quotes.'));
      }
      command.push('rmdir /s /q "' + path + '"');
    } else {
      command.push('/bin/rm');
      command.push('-rf');
      command.push('"' + EscapeDoubleQuotes(normalize(path)) + '"');
    }
    exec(command.join(' '), { encoding: 'utf-8' }, (error) => {
      if (error) {
        return reject(error);
      }
      resolve();
    });
  })
}

export function UUID(instance: AttemptInstance) {
  return new Promise<string>((resolve, reject) => {
    randomBytes(256,
      function(error, random) {
        // @ts-ignore 
        if (error) random = Date.now() + '' + Math.random();
        const hash = createHash('SHA256');
        hash.update('sudo-prompt-3');
        hash.update(instance.options.name);
        hash.update(instance.command);
        hash.update(random);
        const uuid = hash.digest('hex').slice(-32);
        if (!uuid || typeof uuid !== 'string' || uuid.length !== 32) {
          // This is critical to ensure we don't remove the wrong temp directory.
          return reject(new Error('Expected a valid UUID.'));
        }
        resolve(uuid);
      }
    );
  })
 
}

export function ValidName(string: string) {
  // We use 70 characters as a limit to side-step any issues with Unicode
  // normalization form causing a 255 character string to exceed the fs limit.
  if (!/^[a-z0-9 ]+$/i.test(string)) return false;
  if (string.trim().length === 0) return false;
  if (string.length > 70) return false;
  return true;
}