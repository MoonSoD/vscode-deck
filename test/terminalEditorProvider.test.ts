import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
  Uri: {
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
  },
  window: {
    activeColorTheme: { kind: 2 },
  },
  workspace: {
    getConfiguration: () => ({
      get: (key: string) => {
        if (key === 'fontFamily') return 'JetBrains Mono';
        if (key === 'fontSize') return 15;
        return undefined;
      },
    }),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import * as vscode from 'vscode';
import { TerminalEditorProvider } from '../src/terminal/terminalEditorProvider';

function panel() {
  return {
    dispose: vi.fn(),
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

function bridge() {
  return {
    start: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}

function providerDocument(
  terminalBridge = bridge(),
  provider = new TerminalEditorProvider(
    { fsPath: '/extension' } as never,
    '/extension/resources/deck.conf',
    undefined,
    () => terminalBridge,
  ),
) {
  return {
    provider,
    document: provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never),
  };
}

describe('TerminalEditorProvider', () => {
  it('tracks live panels by session and clears them on dispose', () => {
    let disposePanel: (() => void) | undefined;
    const closeSession = vi.fn(async () => undefined);
    const terminalPanel = panel();
    terminalPanel.onDidDispose.mockImplementation((handler: () => void) => {
      disposePanel = handler;
      return { dispose: vi.fn() };
    });
    const terminalBridge = bridge();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => terminalBridge,
      closeSession,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBe(terminalPanel);

    disposePanel?.();

    expect(provider.panelFor('wt-_work_alpha-main__term-1')).toBeUndefined();
    expect(closeSession).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('disposes the panel when the webview acknowledges pty exit', () => {
    let receiveMessage: ((message: { type: string }) => void) | undefined;
    let exitBridge: ((code: number) => void) | undefined;
    const terminalPanel = panel();
    terminalPanel.webview.onDidReceiveMessage.mockImplementation(
      (handler: (message: { type: string }) => void) => {
        receiveMessage = handler;
        return { dispose: vi.fn() };
      },
    );
    const terminalBridge = bridge();
    terminalBridge.onExit.mockImplementation((handler: (code: number) => void) => {
      exitBridge = handler;
      return { dispose: vi.fn() };
    });
    const { provider, document } = providerDocument(terminalBridge);

    provider.resolveCustomEditor(document, terminalPanel as never);
    exitBridge?.(0);
    receiveMessage?.({ type: 'exit' });

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({ type: 'exit', code: 0 });
    expect(terminalPanel.dispose).toHaveBeenCalledOnce();
  });

  it('posts terminal font and theme config when resolving an editor', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: expect.objectContaining({
        fontFamily: 'JetBrains Mono',
        fontSize: 15,
        theme: expect.objectContaining({
          background: expect.any(String),
          foreground: expect.any(String),
        }),
      }),
    });
  });

  it('rebroadcasts config to live panels when terminal-relevant settings change', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    const handler = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0];
    handler?.({
      affectsConfiguration: (section: string) => section === 'editor.fontSize',
    } as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: expect.objectContaining({ fontSize: 15 }),
    });
  });

  it('posts find to the active terminal panel', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    provider.showFind();

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({ type: 'find' });
  });

  it('renders terminal feel hooks in the webview html', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.html).toContain('@xterm/addon-web-links');
    expect(terminalPanel.webview.html).toContain('@xterm/addon-search');
    expect(terminalPanel.webview.html).toContain('document.execCommand');
    expect(terminalPanel.webview.html).toContain('clipboard.readText');
    expect(terminalPanel.webview.html).toContain('context-menu');
    expect(terminalPanel.webview.html).toContain('searchAddon.findNext');
  });
});
