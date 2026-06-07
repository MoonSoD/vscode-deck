import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
  },
}));

import { TerminalEditorProvider } from '../src/terminal/terminalEditorProvider';

describe('TerminalEditorProvider', () => {
  it('tracks live panels by session and clears them on dispose', () => {
    let disposePanel: (() => void) | undefined;
    const closeSession = vi.fn(async () => undefined);
    const panel = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: unknown) => uri,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn((handler: () => void) => {
        disposePanel = handler;
        return { dispose: vi.fn() };
      }),
    };
    const bridge = {
      start: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
      dispose: vi.fn(),
    };
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge,
      closeSession,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, panel as never);

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBe(panel);

    disposePanel?.();

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBeUndefined();
    expect(closeSession).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('disposes the panel when the webview acknowledges pty exit', () => {
    let receiveMessage: ((message: { type: string }) => void) | undefined;
    let exitBridge: ((code: number) => void) | undefined;
    const panel = {
      dispose: vi.fn(),
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: unknown) => uri,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: vi.fn((handler: (message: { type: string }) => void) => {
          receiveMessage = handler;
          return { dispose: vi.fn() };
        }),
      },
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const bridge = {
      start: vi.fn(),
      write: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn((handler: (code: number) => void) => {
        exitBridge = handler;
        return { dispose: vi.fn() };
      }),
      dispose: vi.fn(),
    };
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridge,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, panel as never);
    exitBridge?.(0);
    receiveMessage?.({ type: 'exit' });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 0 });
    expect(panel.dispose).toHaveBeenCalledOnce();
  });

  it('rejects a duplicate same-session panel without starting a second bridge', () => {
    const firstPanel = panelStub();
    const duplicatePanel = panelStub();
    const firstBridge = bridgeStub();
    const secondBridge = bridgeStub();
    const bridgeFactory = vi.fn()
      .mockReturnValueOnce(firstBridge)
      .mockReturnValueOnce(secondBridge);
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      bridgeFactory,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, firstPanel as never);
    provider.resolveCustomEditor(document, duplicatePanel as never);

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBe(firstPanel);
    expect(duplicatePanel.dispose).toHaveBeenCalledOnce();
    expect(bridgeFactory).toHaveBeenCalledOnce();
  });

  it('restores cached scrollback before requesting live pty data', () => {
    const panel = panelStub();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => bridgeStub(),
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, panel as never);

    expect(panel.webview.html).toContain('vscode.getState()');
    expect(panel.webview.html).toContain('terminal.write(restoredState.scrollback)');
    expect(panel.webview.html).toContain('vscode.setState({ scrollback })');
    expect(panel.webview.html).toContain('.slice(-65536)');
  });
});

function panelStub() {
  return {
    dispose: vi.fn(),
    reveal: vi.fn(),
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-resource:',
      asWebviewUri: (uri: unknown) => uri,
      postMessage: vi.fn(async () => true),
      onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    },
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

function bridgeStub() {
  return {
    start: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}
