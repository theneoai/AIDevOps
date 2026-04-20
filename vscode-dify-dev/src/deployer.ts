import * as vscode from 'vscode';
import { execFile } from 'child_process';
import { validateCurrentFile } from './validator';

export async function deployCurrentFile(
  uri: vscode.Uri,
  statusBar: vscode.StatusBarItem
): Promise<void> {
  const valid = await validateCurrentFile(uri, statusBar);
  if (!valid) {
    vscode.window.showErrorMessage('Deploy aborted: fix validation errors first.');
    return;
  }

  const config = vscode.workspace.getConfiguration('difyDev');
  const cli = config.get<string>('devkitPath') ?? 'npx dify-dev';
  const [cmd, ...args] = cli.split(' ');

  statusBar.text = '$(sync~spin) Dify: Deploying…';

  execFile(cmd, [...args, 'deploy', uri.fsPath, '--verbose'], (err, stdout, stderr) => {
    if (err) {
      statusBar.text = '$(error) Dify: Deploy failed';
      statusBar.color = new vscode.ThemeColor('errorForeground');
      vscode.window.showErrorMessage(`Deploy failed: ${stderr || err.message}`);
      return;
    }
    statusBar.text = '$(check) Dify: Deployed';
    statusBar.color = undefined;
    vscode.window.showInformationMessage(`Deployed: ${uri.fsPath.split('/').pop()}`);
    if (stdout) {
      vscode.window.showOutputChannel?.('Dify DevKit');
    }
  });
}
