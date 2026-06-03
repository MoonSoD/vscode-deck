import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';

export function activate(context: vscode.ExtensionContext): void {
  const switcher = new WorktreeSwitcher(context.globalState);
  const tree = new ProjectTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deck.projects', tree),
    vscode.commands.registerCommand('deck.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.switchWorktree', (worktreePath: string) =>
      switcher.switchTo(worktreePath),
    ),
  );
}

export function deactivate(): void {}
