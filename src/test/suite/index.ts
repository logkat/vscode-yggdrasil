import * as fs from 'fs';
import * as path from 'path';
import Mocha from 'mocha';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 10000 });
  const testsRoot = __dirname;

  fs.readdirSync(testsRoot)
    .filter((f) => f.endsWith('.test.js'))
    .forEach((f) => mocha.addFile(path.join(testsRoot, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) { reject(new Error(`${failures} test(s) failed`)); }
      else { resolve(); }
    });
  });
}
