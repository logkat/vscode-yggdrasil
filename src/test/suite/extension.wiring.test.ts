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
});
