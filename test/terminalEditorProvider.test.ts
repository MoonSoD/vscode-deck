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
  });
});
