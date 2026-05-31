import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext): void {
    vscode.window.showInformationMessage(
        'Yggdrasil has moved! This extension is deprecated. Please install "Yggdrasil Git Worktrees" (LogKat.git-yggdrasil) to continue receiving updates.',
        'Install New Extension',
        'Dismiss'
    ).then(choice => {
        if (choice === 'Install New Extension') {
            vscode.commands.executeCommand('workbench.extensions.installExtension', 'LogKat.git-yggdrasil');
        }
    });
}

export function deactivate(): void {}
