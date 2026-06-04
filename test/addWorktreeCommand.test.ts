import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  QuickInputButtonLocation: {
    Inline: 2,
  },
  ThemeIcon: vi.fn(function ThemeIcon(this: { id: string }, id: string) {
    this.id = id;
  }),
  Uri: {
    file: vi.fn((fsPath: string) => ({ fsPath })),
  },
  window: {
    createInputBox: vi.fn(),
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showOpenDialog: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  addWorktree: vi.fn(async () => undefined),
  getCommonDir: vi.fn(async () => '/git/myrepo'),
  listBranches: vi.fn(async () => ['main', 'feature/foo']),
}));

import * as vscode from 'vscode';
import { addWorktree, getCommonDir, listBranches } from '../src/git/worktrees';
import { AddWorktreeCommand } from '../src/worktree/addWorktreeCommand';

interface InputBoxMock {
  value: string;
  prompt?: string;
  buttons: readonly vscode.QuickInputButton[];
  onDidAccept(listener: () => void): { dispose(): void };
  onDidHide(listener: () => void): { dispose(): void };
  onDidTriggerButton(listener: (button: vscode.QuickInputButton) => void): { dispose(): void };
  show(): void;
  hide(): void;
  dispose(): void;
  triggerButton(button: vscode.QuickInputButton): Promise<void>;
}

function createAcceptingInputBox(onShow?: (box: InputBoxMock) => Promise<void> | void): InputBoxMock {
  let accept: (() => void) | undefined;
  let hide: (() => void) | undefined;
  let triggerButton: ((button: vscode.QuickInputButton) => Promise<void> | void) | undefined;
  const box: InputBoxMock = {
    value: '',
    buttons: [],
    onDidAccept: vi.fn((listener: () => void) => {
      accept = listener;
      return { dispose: vi.fn() };
    }),
    onDidHide: vi.fn((listener: () => void) => {
      hide = listener;
      return { dispose: vi.fn() };
    }),
    onDidTriggerButton: vi.fn((listener: (button: vscode.QuickInputButton) => void) => {
      triggerButton = listener;
      return { dispose: vi.fn() };
    }),
    show: vi.fn(() => {
      queueMicrotask(async () => {
        await onShow?.(box);
        accept?.();
      });
    }),
    hide: vi.fn(() => hide?.()),
    dispose: vi.fn(),
    triggerButton: vi.fn(async (button: vscode.QuickInputButton) => {
      await triggerButton?.(button);
    }),
  };
  return box;
}

describe('AddWorktreeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(addWorktree).mockReset();
    vi.mocked(getCommonDir).mockReset();
    vi.mocked(listBranches).mockReset();
    vi.mocked(addWorktree).mockResolvedValue(undefined);
    vi.mocked(getCommonDir).mockResolvedValue('/git/myrepo');
    vi.mocked(listBranches).mockResolvedValue(['main', 'feature/foo']);
    vi.mocked(vscode.window.createInputBox).mockReset();
    vi.mocked(vscode.window.showErrorMessage).mockReset();
    vi.mocked(vscode.window.showInputBox).mockReset();
    vi.mocked(vscode.window.showOpenDialog).mockReset();
    vi.mocked(vscode.window.showQuickPick).mockReset();
  });

  it('creates an existing-branch worktree from the remembered root and learns the chosen root', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const worktreeRoots = {
      get: vi.fn(() => '/custom/worktrees'),
      set: vi.fn(async () => undefined),
    };
    const command = new AddWorktreeCommand(switcher, worktreeRoots);
    const input = createAcceptingInputBox();

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ projectPath: '/work/myrepo' });

    expect(listBranches).toHaveBeenCalledWith('/work/myrepo');
    expect(input.prompt).toBe('Worktree path');
    expect(input.value).toBe('/custom/worktrees/feature-foo');
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/custom/worktrees/feature-foo',
      branch: 'feature/foo',
    });
    expect(worktreeRoots.set).toHaveBeenCalledWith('/git/myrepo', '/custom/worktrees');
    expect(switcher.switchTo).toHaveBeenCalledWith('/custom/worktrees/feature-foo');
  });

  it('lets the inline folder picker replace the parent while preserving the branch slug', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const worktreeRoots = {
      get: vi.fn(() => '/remembered/root'),
      set: vi.fn(async () => undefined),
    };
    const command = new AddWorktreeCommand(switcher, worktreeRoots);
    const input = createAcceptingInputBox(async (box) => {
      await box.triggerButton(box.buttons[0]);
    });

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue([
      { fsPath: '/picked/root' } as vscode.Uri,
    ]);

    await command.run({ projectPath: '/work/myrepo' });

    expect(input.buttons).toEqual([
      expect.objectContaining({
        iconPath: expect.objectContaining({ id: 'folder' }),
        location: vscode.QuickInputButtonLocation.Inline,
      }),
    ]);
    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        canSelectFolders: true,
        canSelectFiles: false,
        defaultUri: { fsPath: '/remembered/root' },
      }),
    );
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/picked/root/feature-foo',
      branch: 'feature/foo',
    });
    expect(worktreeRoots.set).toHaveBeenCalledWith('/git/myrepo', '/picked/root');
  });

  it('keeps the input value when the inline folder picker is cancelled', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);
    const input = createAcceptingInputBox(async (box) => {
      await box.triggerButton(box.buttons[0]);
    });

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(vscode.window.showOpenDialog).mockResolvedValue(undefined);

    await command.run({ projectPath: '/work/myrepo' });

    expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        defaultUri: { fsPath: '/work' },
      }),
    );
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo.worktrees/feature-foo',
      branch: 'feature/foo',
    });
  });

  it('does nothing when the path input is cleared', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const worktreeRoots = {
      get: vi.fn(() => '/custom/worktrees'),
      set: vi.fn(async () => undefined),
    };
    const command = new AddWorktreeCommand(switcher, worktreeRoots);
    const input = createAcceptingInputBox((box) => {
      box.value = '';
    });

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ projectPath: '/work/myrepo' });

    expect(addWorktree).not.toHaveBeenCalled();
    expect(worktreeRoots.set).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('creates a new-branch worktree from the chosen base ref', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);
    const input = createAcceptingInputBox();

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ action?: string }>;
      return picks.find((item) => item.action === 'create');
    });
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('feature/bar')
      .mockResolvedValueOnce('main');
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);

    await command.run({ projectPath: '/work/myrepo' });

    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo.worktrees/feature-bar',
      newBranch: 'feature/bar',
      baseRef: 'main',
    });
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/myrepo.worktrees/feature-bar');
  });

  it('does nothing when branch picking is cancelled', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);

    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await command.run({ projectPath: '/work/myrepo' });

    expect(addWorktree).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('surfaces git failures and does not switch', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);
    const input = createAcceptingInputBox();

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.createInputBox).mockReturnValue(input as vscode.InputBox);
    vi.mocked(addWorktree).mockRejectedValueOnce({ stderr: 'path already exists' });

    await command.run({ projectPath: '/work/myrepo' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot create worktree: path already exists',
    );
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });
});
