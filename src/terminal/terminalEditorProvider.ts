import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { TerminalPtyBridge } from './terminalPtyBridge';

export const terminalEditorViewType = 'deck.terminal';

interface TerminalDocument extends vscode.CustomDocument {
  readonly sessionName: string;
  readonly cwd: string;
}

interface ReadyMessage {
  type: 'ready';
  cols?: number;
  rows?: number;
}

interface InputMessage {
  type: 'input';
  payload: string;
}

interface ExitMessage {
  type: 'exit';
}

type TerminalWebviewMessage = ReadyMessage | InputMessage | ExitMessage;

export interface TerminalPtyBridgeLike {
  start(sessionName: string, cwd: string, cols: number, rows: number): void;
  write(data: string): void;
  onData(handler: (data: string) => void): { dispose(): void };
  onExit(handler: (code: number) => void): { dispose(): void };
  dispose(): void;
}

export type TerminalPtyBridgeFactory = () => TerminalPtyBridgeLike;
export type TerminalEditorDisposeHandler = (sessionName: string) => Promise<void> | void;

export class TerminalEditorProvider implements vscode.CustomReadonlyEditorProvider<TerminalDocument> {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configPath: string,
    private readonly codec: SessionUriCodec = new SessionUriCodec(),
    private readonly bridgeFactory: TerminalPtyBridgeFactory = () =>
      new TerminalPtyBridge(this.configPath),
    private readonly onPanelDispose: TerminalEditorDisposeHandler = () => undefined,
  ) {}

  openCustomDocument(uri: vscode.Uri): TerminalDocument {
    const parts = this.codec.decode(uri);
    return {
      uri,
      sessionName: parts.sessionName,
      cwd: parts.cwd,
      dispose: () => undefined,
    };
  }

  panelFor(sessionName: string): vscode.WebviewPanel | undefined {
    return this.panels.get(sessionName);
  }

  resolveCustomEditor(document: TerminalDocument, panel: vscode.WebviewPanel): void {
    this.panels.set(document.sessionName, panel);
    const bridge = this.bridgeFactory();
    const bridgeDisposables: vscode.Disposable[] = [];

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'node_modules')],
    };
    panel.webview.html = this.html(panel.webview);

    bridgeDisposables.push(
      bridge.onData((data) => {
        void panel.webview.postMessage({ type: 'data', payload: data });
      }),
      bridge.onExit((code) => {
        void panel.webview.postMessage({ type: 'exit', code });
      }),
      panel.webview.onDidReceiveMessage((message: TerminalWebviewMessage) => {
        if (message.type === 'ready') {
          bridge.start(document.sessionName, document.cwd, message.cols ?? 80, message.rows ?? 24);
          return;
        }

        if (message.type === 'input') bridge.write(message.payload);
        if (message.type === 'exit') panel.dispose();
      }),
    );

    panel.onDidDispose(() => {
      if (this.panels.get(document.sessionName) === panel) {
        this.panels.delete(document.sessionName);
      }
      void this.onPanelDispose(document.sessionName);
      bridge.dispose();
      for (const disposable of bridgeDisposables.splice(0)) disposable.dispose();
    });
  }

  private html(webview: vscode.Webview): string {
    const xtermJs = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@xterm', 'xterm', 'lib', 'xterm.js'),
    );
    const xtermCss = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'node_modules', '@xterm', 'xterm', 'css', 'xterm.css'),
    );
    const fitJs = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@xterm',
        'addon-fit',
        'lib',
        'addon-fit.js',
      ),
    );
    const nonce = String(Date.now());

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${xtermCss}">
  <style>
    html, body, #terminal {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: var(--vscode-editor-background);
    }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script nonce="${nonce}" src="${xtermJs}"></script>
  <script nonce="${nonce}" src="${fitJs}"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const terminal = new Terminal({ cursorBlink: true, convertEol: true });
    const fitAddon = new FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(document.getElementById('terminal'));
    fitAddon.fit();
    terminal.focus();
    terminal.onData((payload) => vscode.postMessage({ type: 'input', payload }));
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'data') terminal.write(message.payload);
      if (message.type === 'exit') {
        terminal.writeln('\\r\\n[process exited ' + message.code + ']');
        vscode.postMessage({ type: 'exit' });
      }
    });
    vscode.postMessage({ type: 'ready', cols: terminal.cols, rows: terminal.rows });
  </script>
</body>
</html>`;
  }
}
