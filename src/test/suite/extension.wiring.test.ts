import * as assert from 'assert';
import * as vscode from 'vscode';

suite('extension — command registration', () => {
  test('ygg.openDiff is registered after activation', () => {
    // We can't easily test the actual event since it's internal to extension.ts.
    // Instead, verify the extension activated successfully (the treeView exists)
    // and that ygg.openDiff is registered.
    const registered = vscode.commands.getCommands(true);
    return registered.then((cmds) => {
      assert.ok(cmds.includes('ygg.openDiff'), 'ygg.openDiff should be registered');
    });
  });

  test('every command in package.json is actually registered', async () => {
    // A contributed command that nothing registers still shows in the palette
    // and fails with "command not found" when picked.
    const manifest = require('../../../package.json');
    const contributed: string[] = manifest.contributes.commands.map(
      (c: { command: string }) => c.command
    );
    const registered = await vscode.commands.getCommands(true);

    const missing = contributed.filter((c) => !registered.includes(c));
    assert.deepStrictEqual(missing, [], `contributed but never registered: ${missing.join(', ')}`);
  });
});
