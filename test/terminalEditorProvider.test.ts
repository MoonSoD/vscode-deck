import { describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({
  editor: { fontFamily: 'JetBrains Mono', fontSize: 15 } as Record<string, unknown>,
  'terminal.integrated': { fontFamily: '', fontSize: 0 } as Record<string, unknown>,
}));

vi.mock('vscode', () => ({
  Uri: {
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
  },
  workspace: {
    getConfiguration: (section: 'editor' | 'terminal.integrated') => ({
      get: (key: string, defaultValue: unknown) => cfg[section]?.[key] ?? defaultValue,
    }),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import * as vscode from 'vscode';
import { TerminalEditorProvider } from '../src/terminal/terminalEditorProvider';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function panel() {
  return {
    dispose: vi.fn(),
    title: '',
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
    clearHistory: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    onRename: vi.fn(() => ({ dispose: vi.fn() })),
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

  it('titles the tab with the tmux window name and updates it on rename', async () => {
    let renameHandler: (() => void) | undefined;
    const terminalBridge = bridge();
    terminalBridge.onRename.mockImplementation((handler: () => void) => {
      renameHandler = handler;
      return { dispose: vi.fn() };
    });
    const windowNames = vi.fn(async () => 'zsh');
    const terminalPanel = panel();
    const provider = new TerminalEditorProvider(
      { fsPath: '/extension' } as never,
      '/extension/resources/deck.conf',
      undefined,
      () => terminalBridge,
      undefined,
      undefined,
      windowNames,
    );
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_alpha-main__term-1',
      query: 'cwd=%2Fwork%2Falpha-main',
    } as never);

    provider.resolveCustomEditor(document, terminalPanel as never);
    await flush();
    expect(windowNames).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    expect(terminalPanel.title).toBe('zsh');
    expect((terminalPanel as { iconPath?: { light: { paths: string[] }; dark: { paths: string[] } } }).iconPath).toEqual({
      light: { base: { fsPath: '/extension' }, paths: ['resources', 'terminal-light.svg'] },
      dark: { base: { fsPath: '/extension' }, paths: ['resources', 'terminal-dark.svg'] },
    });

    windowNames.mockResolvedValueOnce('claude');
    renameHandler?.();
    await flush();
    expect(terminalPanel.title).toBe('claude');
  });

  it('disposes the panel when the webview acknowledges terminal exit', () => {
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

  it('posts terminal font config when resolving an editor (editor font when terminal font unset)', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();

    provider.resolveCustomEditor(document, terminalPanel as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: { fontFamily: 'JetBrains Mono', fontSize: 15 },
    });
  });

  it('prefers terminal.integrated font over editor font', () => {
    cfg['terminal.integrated'] = { fontFamily: 'Fira Code', fontSize: 18 };
    try {
      const terminalPanel = panel();
      const { provider, document } = providerDocument();

      provider.resolveCustomEditor(document, terminalPanel as never);

      expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
        type: 'config',
        payload: { fontFamily: 'Fira Code', fontSize: 18 },
      });
    } finally {
      cfg['terminal.integrated'] = { fontFamily: '', fontSize: 0 };
    }
  });

  it('broadcasts when a terminal.integrated font setting changes', () => {
    const terminalPanel = panel();
    const { provider, document } = providerDocument();
    provider.resolveCustomEditor(document, terminalPanel as never);
    terminalPanel.webview.postMessage.mockClear();

    const handler = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls.at(-1)?.[0];
    handler?.({
      affectsConfiguration: (section: string) => section === 'terminal.integrated.fontFamily',
    } as never);

    expect(terminalPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'config',
      payload: expect.objectContaining({ fontFamily: 'JetBrains Mono' }),
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
    expect(terminalPanel.webview.html).toContain('@xterm/addon-unicode11');
    expect(terminalPanel.webview.html).toContain("terminal.unicode.activeVersion = '11'");
    // tmux answers DA/DSR for the pane; xterm must not also reply (would leak
    // e.g. '1;2c' to the shell after the querying program exits).
    expect(terminalPanel.webview.html).toContain('registerCsiHandler');
    expect(terminalPanel.webview.html).toContain("{ prefix: '?', final: 'n' }");
    expect(terminalPanel.webview.html).toContain('clipboard.writeText');
    expect(terminalPanel.webview.html).toContain('clipboard.readText');
    expect(terminalPanel.webview.html).toContain('context-menu');
    // Context menu clamps into the viewport so a bottom/right click doesn't clip it.
    expect(terminalPanel.webview.html).toContain('window.innerHeight - contextMenu.offsetHeight');
    expect(terminalPanel.webview.html).toContain('searchAddon.findNext');
    expect(terminalPanel.webview.html).toContain("matchBackground: '#5c3300'");
    expect(terminalPanel.webview.html).not.toContain('rgba(');
  });

  it('rejects a duplicate same-session panel without starting a second bridge', () => {
    const firstPanel = panelStub();
    const duplicatePanel = panelStub();
    const firstBridge = bridgeStub();
    const bridgeFactory = vi.fn(() => firstBridge);

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
    expect(firstPanel.reveal).toHaveBeenCalledOnce();
    expect(duplicatePanel.dispose).toHaveBeenCalledOnce();
    expect(bridgeFactory).toHaveBeenCalledOnce();
  });

  it('routes resize messages to the terminal transport', () => {
    let receiveMessage:
      | ((message: { type: string; cols?: number; rows?: number; payload?: string }) => void)
      | undefined;
    const panel = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: unknown) => uri,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: vi.fn(
          (handler: (message: { type: string; cols?: number; rows?: number }) => void) => {
            receiveMessage = handler;
            return { dispose: vi.fn() };
          },
        ),
      },
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const bridge = {
      start: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      clearHistory: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onExit: vi.fn(() => ({ dispose: vi.fn() })),
    onRename: vi.fn(() => ({ dispose: vi.fn() })),
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
    receiveMessage?.({ type: 'resize', cols: 132, rows: 41 });
    receiveMessage?.({ type: 'clearHistory' });

    expect(bridge.resize).toHaveBeenCalledWith(132, 41);
    // Clear must reach tmux (clear-history) so it survives reload, not just
    // clear the local xterm buffer.
    expect(bridge.clearHistory).toHaveBeenCalledOnce();
  });

  it('does not use webview scrollback snapshots and renders a debounced fit resize observer before ready', () => {
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

    expect(panel.webview.html).not.toContain('vscode.getState()');
    expect(panel.webview.html).not.toContain('vscode.setState(');
    expect(panel.webview.html).not.toContain('SerializeAddon');
    expect(panel.webview.html).not.toContain('@xterm/addon-serialize');
    expect(panel.webview.html).toContain('new ResizeObserver');
    expect(panel.webview.html).toContain('setTimeout(postResize, 50)');
    expect(panel.webview.html).toContain("vscode.postMessage({ type: 'resize'");
    expect(panel.webview.html.indexOf("type: 'resize'")).toBeLessThan(
      panel.webview.html.indexOf("type: 'ready'"),
    );
    expect(panel.webview.html).toContain('requestAnimationFrame');
  });
});

function panelStub() {
  return {
    dispose: vi.fn(),
    reveal: vi.fn(),
    title: '',
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
    resize: vi.fn(),
    onData: vi.fn(() => ({ dispose: vi.fn() })),
    onExit: vi.fn(() => ({ dispose: vi.fn() })),
    onRename: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
  };
}
