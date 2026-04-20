import * as vscode from 'vscode';
import { execFile } from 'child_process';

const diagnostics = vscode.languages.createDiagnosticCollection('dify-dsl');

export async function validateCurrentFile(
  uri: vscode.Uri,
  statusBar: vscode.StatusBarItem
): Promise<boolean> {
  const config = vscode.workspace.getConfiguration('difyDev');
  const cli = config.get<string>('devkitPath') ?? 'npx dify-dev';
  const [cmd, ...args] = cli.split(' ');

  return new Promise((resolve) => {
    execFile(cmd, [...args, 'validate', uri.fsPath, '--json'], (err, stdout) => {
      diagnostics.clear();

      if (!err) {
        statusBar.text = '$(check) Dify: Valid';
        statusBar.color = undefined;
        resolve(true);
        return;
      }

      try {
        const result = JSON.parse(stdout);
        const fileDiags: vscode.Diagnostic[] = (result.errors ?? []).map(
          (e: { line: number; col: number; message: string }) => {
            const pos = new vscode.Position(Math.max(0, e.line - 1), Math.max(0, e.col - 1));
            return new vscode.Diagnostic(
              new vscode.Range(pos, pos),
              e.message,
              vscode.DiagnosticSeverity.Error
            );
          }
        );
        diagnostics.set(uri, fileDiags);
      } catch {
        // Non-JSON output — show as single error
        const diag = new vscode.Diagnostic(
          new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0)),
          err.message,
          vscode.DiagnosticSeverity.Error
        );
        diagnostics.set(uri, [diag]);
      }

      statusBar.text = '$(error) Dify: Invalid';
      statusBar.color = new vscode.ThemeColor('errorForeground');
      resolve(false);
    });
  });
}
