import { stat } from "node:fs";

export function LinuxBinary() {
  return new Promise<string>((resolve, reject) => {
    let index = 0;
    // We used to prefer gksudo over pkexec since it enabled a better prompt.
    // However, gksudo cannot run multiple commands concurrently.
    const paths = ['/usr/bin/kdesudo', '/usr/bin/pkexec'];
    function test() {
      if (index === paths.length) {
        return reject(new Error('Unable to find pkexec or kdesudo.'));
      }
      const path = paths[index++];
      stat(path,
        function(error) {
          if (error) {
            if (error.code === 'ENOTDIR') return test();
            if (error.code === 'ENOENT') return test();
            return reject(error)
          } else {
            return resolve(path)
          }
        }
      );
    }
    test();
  })

}