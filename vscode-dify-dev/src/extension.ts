import * as vscode from 'vscode';
import { validateCurrentFile } from './validator';
import { deployCurrentFile } from './deployer';

export function activate(context: vscode.ExtensionContext) {
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(circuit-board) Dify DevKit';
  statusBar.tooltip = 'Click to deploy current component';
  statusBar.command = 'difyDev.deploy';
  context.subscriptions.push(statusBar);

  // Auto-validate on save
  const config = vscode.workspace.getConfiguration('difyDev');
  if (config.get('autoValidate')) {
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (doc) => {
        if (isDSLFile(doc.uri)) {
          await validateCurrentFile(doc.uri, statusBar);
        }
      })
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('difyDev.deploy', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !isDSLFile(uri)) {
        vscode.window.showWarningMessage('Open a component YAML file to deploy.');
        return;
      }
      await deployCurrentFile(uri, statusBar);
    }),

    vscode.commands.registerCommand('difyDev.validate', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) return;
      await validateCurrentFile(uri, statusBar);
    }),

    vscode.commands.registerCommand('difyDev.watch', () => {
      const terminal = vscode.window.createTerminal('Dify Watch');
      terminal.sendText('npx dify-dev watch --verbose');
      terminal.show();
    })
  );

  // Show status bar when a DSL file is active
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && isDSLFile(editor.document.uri)) {
        statusBar.show();
      } else {
        statusBar.hide();
      }
    })
  );
}

function isDSLFile(uri: vscode.Uri): boolean {
  return uri.fsPath.includes('enterprise/components') && uri.fsPath.endsWith('.yml');
}

export function deactivate() {}
