import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { TerminalTransport } from './terminalTransport';

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

interface OpenExternalMessage {
  type: 'openExternal';
  payload: string;
}

interface ResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface ExitMessage {
  type: 'exit';
}

interface FocusedMessage {
  type: 'focused';
}

interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
}

type TerminalWebviewMessage =
  | ReadyMessage
  | InputMessage
  | OpenExternalMessage
  | ResizeMessage
  | ExitMessage
  | FocusedMessage;

export interface TerminalTransportLike {
  start(sessionName: string, cwd: string, cols: number, rows: number): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(handler: (data: string) => void): { dispose(): void };
  onExit(handler: (code: number) => void): { dispose(): void };
  dispose(): void;
}

export type TerminalTransportFactory = () => TerminalTransportLike;
export type TerminalEditorDisposeHandler = (sessionName: string) => Promise<void> | void;

export class TerminalEditorProvider implements vscode.CustomReadonlyEditorProvider<TerminalDocument> {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly configChangeSubscription: vscode.Disposable;
  private activePanel: vscode.WebviewPanel | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly configPath: string,
    private readonly codec: SessionUriCodec = new SessionUriCodec(),
    private readonly transportFactory: TerminalTransportFactory = () =>
      new TerminalTransport(this.configPath),
    private readonly onPanelDispose: TerminalEditorDisposeHandler = () => undefined,
  ) {
    this.configChangeSubscription = vscode.workspace.onDidChangeConfiguration((event) => {
      if (
        !event.affectsConfiguration('editor.fontFamily') &&
        !event.affectsConfiguration('editor.fontSize')
      ) {
        return;
      }
      this.broadcastConfig();
    });
  }

  dispose(): void {
    this.configChangeSubscription.dispose();
  }

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

  showFind(): void {
    const panel = this.activePanel ?? this.panels.values().next().value;
    if (panel) void panel.webview.postMessage({ type: 'find' });
  }

  resolveCustomEditor(document: TerminalDocument, panel: vscode.WebviewPanel): void {
    const existing = this.panels.get(document.sessionName);
    if (existing) {
      existing.reveal();
      panel.dispose();
      return;
    }

    this.panels.set(document.sessionName, panel);
    this.activePanel = panel;
    const transport = this.transportFactory();
    const transportDisposables: vscode.Disposable[] = [];

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'node_modules')],
    };
    const initialConfig = this.terminalConfig();
    panel.webview.html = this.html(panel.webview, initialConfig);
    void panel.webview.postMessage({ type: 'config', payload: initialConfig });

    transportDisposables.push(
      transport.onData((data) => {
        void panel.webview.postMessage({ type: 'data', payload: data });
      }),
      transport.onExit((code) => {
        void panel.webview.postMessage({ type: 'exit', code });
      }),
      panel.webview.onDidReceiveMessage((message: TerminalWebviewMessage) => {
        if (message.type === 'ready') {
          transport.start(
            document.sessionName,
            document.cwd,
            message.cols ?? 80,
            message.rows ?? 24,
          );
          return;
        }

        if (message.type === 'input') transport.write(message.payload);
        if (message.type === 'openExternal') {
          void vscode.env.openExternal(vscode.Uri.parse(message.payload));
        }
        if (message.type === 'resize') transport.resize(message.cols, message.rows);
        if (message.type === 'focused') this.activePanel = panel;
        if (message.type === 'exit') panel.dispose();
      }),
    );

    panel.onDidDispose(() => {
      if (this.panels.get(document.sessionName) === panel) {
        this.panels.delete(document.sessionName);
      }
      if (this.activePanel === panel) this.activePanel = undefined;
      void this.onPanelDispose(document.sessionName);
      transport.dispose();
      for (const disposable of transportDisposables.splice(0)) disposable.dispose();
    });
  }

  private broadcastConfig(): void {
    const payload = this.terminalConfig();
    for (const panel of this.panels.values()) {
      void panel.webview.postMessage({ type: 'config', payload });
    }
  }

  private terminalConfig(): TerminalConfig {
    const editor = vscode.workspace.getConfiguration('editor');
    return {
      fontFamily: editor.get('fontFamily', 'monospace'),
      fontSize: editor.get('fontSize', 14),
    };
  }

  private html(webview: vscode.Webview, initialConfig: TerminalConfig): string {
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
    const webLinksJs = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@xterm',
        'addon-web-links',
        'lib',
        'addon-web-links.js',
      ),
    );
    const searchJs = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@xterm',
        'addon-search',
        'lib',
        'addon-search.js',
      ),
    );
    const unicode11Js = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'node_modules',
        '@xterm',
        'addon-unicode11',
        'lib',
        'addon-unicode11.js',
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
    body {
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-font-family);
    }
    #terminal {
      box-sizing: border-box;
    }
    #context-menu {
      position: fixed;
      display: none;
      min-width: 128px;
      padding: 4px 0;
      background: var(--vscode-menu-background);
      color: var(--vscode-menu-foreground);
      border: 1px solid var(--vscode-menu-border);
      z-index: 20;
    }
    #context-menu button {
      display: block;
      width: 100%;
      padding: 5px 12px;
      border: 0;
      background: transparent;
      color: inherit;
      text-align: left;
      font: inherit;
    }
    #context-menu button:hover {
      background: var(--vscode-menu-selectionBackground);
      color: var(--vscode-menu-selectionForeground);
    }
    #find-widget {
      position: fixed;
      top: 8px;
      right: 8px;
      display: none;
      gap: 4px;
      align-items: center;
      padding: 4px;
      background: var(--vscode-editorWidget-background);
      color: var(--vscode-editorWidget-foreground);
      border: 1px solid var(--vscode-editorWidget-border);
      z-index: 10;
    }
    #find-widget input {
      width: 180px;
      min-width: 0;
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 3px 6px;
      font: inherit;
    }
    #find-widget button {
      min-width: 24px;
      height: 24px;
      border: 0;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font: inherit;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <div id="find-widget">
    <input id="find-input" type="text">
    <button id="find-prev" type="button">Prev</button>
    <button id="find-next" type="button">Next</button>
    <button id="find-close" type="button">x</button>
  </div>
  <div id="context-menu">
    <button type="button" data-action="copy">Copy</button>
    <button type="button" data-action="paste">Paste</button>
    <button type="button" data-action="select-all">Select All</button>
    <button type="button" data-action="clear">Clear</button>
  </div>
  <script nonce="${nonce}" src="${xtermJs}"></script>
  <script nonce="${nonce}" src="${fitJs}"></script>
  <!-- @xterm/addon-web-links -->
  <script nonce="${nonce}" src="${webLinksJs}"></script>
  <!-- @xterm/addon-search -->
  <script nonce="${nonce}" src="${searchJs}"></script>
  <!-- @xterm/addon-unicode11 -->
  <script nonce="${nonce}" src="${unicode11Js}"></script>
  <script nonce="${nonce}">
    (async () => {
      const vscode = acquireVsCodeApi();
      const terminalElement = document.getElementById('terminal');
      const initialConfig = ${JSON.stringify(initialConfig).replace(/<\//g, "<\\/")};

      // Theme: borrow editor-namespace CSS vars (terminal.* vars aren't
      // injected into custom-editor webviews). ANSI palette stays at xterm's
      // built-in defaults.
      const themeVarMap = {
        background: '--vscode-editor-background',
        foreground: '--vscode-editor-foreground',
        cursor: '--vscode-editorCursor-foreground',
        cursorAccent: '--vscode-editorCursor-background',
        selectionBackground: '--vscode-editor-selectionBackground',
        selectionForeground: '--vscode-editor-selectionForeground',
      };
      function readVsCodeTheme() {
        const cs = getComputedStyle(document.body);
        const theme = {};
        for (const key in themeVarMap) {
          const raw = cs.getPropertyValue(themeVarMap[key]).trim();
          if (raw) theme[key] = raw;
        }
        return theme;
      }

      // Pre-warm the configured font before xterm's Canvas atlas rasterizes.
      // OS-installed fonts (e.g. ~/Library/Fonts) aren't available to Canvas
      // measurement until something on the page has used them — xterm's atlas
      // caches missing-glyph boxes if we initialize first. See xtermjs/xterm.js
      // #3287 and #3807; CoderPad/xterm-webfont solved this for xterm 4.x;
      // document.fonts.load is the modern dependency-free equivalent.
      async function warmFonts(fontFamily, fontSize) {
        const primary = (fontFamily.split(',')[0] || '').trim();
        if (!primary) return;
        const spec = fontSize + 'px ' + primary;
        try {
          await Promise.all([
            document.fonts.load(spec),
            document.fonts.load('bold ' + spec),
          ]);
        } catch (_) {
          // Fall back to xterm's defaults; not worth blocking init on.
        }
      }
      await warmFonts(initialConfig.fontFamily, initialConfig.fontSize);

      const terminal = new Terminal({
        // Search-addon match decorations use registerDecoration, gated as
        // proposed API in xterm 6.
        allowProposedApi: true,
        cursorBlink: true,
        scrollback: 5000,
        theme: readVsCodeTheme(),
        fontFamily: initialConfig.fontFamily,
        fontSize: initialConfig.fontSize,
      });
      const fitAddon = new FitAddon.FitAddon();
      const searchAddon = new SearchAddon.SearchAddon();
      const unicode11Addon = new Unicode11Addon.Unicode11Addon();
      const webLinksAddon = new WebLinksAddon.WebLinksAddon((event, uri) => {
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          vscode.postMessage({ type: 'openExternal', payload: uri });
        }
      });
      let resizeTimer;
      let lastCols = 0;
      let lastRows = 0;

      function postResize() {
        fitAddon.fit();
        if (terminal.cols === lastCols && terminal.rows === lastRows) return;
        lastCols = terminal.cols;
        lastRows = terminal.rows;
        vscode.postMessage({ type: 'resize', cols: terminal.cols, rows: terminal.rows });
      }

      function debounceResize() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(postResize, 50);
      }

      terminal.loadAddon(fitAddon);
      terminal.loadAddon(searchAddon);
      terminal.loadAddon(webLinksAddon);
      terminal.loadAddon(unicode11Addon);
      // Width tables matching modern terminals: emoji and CJK are 2 cells, so
      // the shell's cursor math (p10k redraws) lines up with what xterm paints.
      terminal.unicode.activeVersion = '11';

      // Every Deck terminal is a tmux control-mode pane, and tmux IS the pane's
      // terminal emulator — it answers device-attribute / device-status queries
      // (DA1/DA2/DA3, DSR/CPR) itself. tmux also relays the raw query bytes to
      // us in %output so xterm's screen stays in sync; if xterm ALSO answers,
      // that second reply is routed back via send-keys and lands at the shell
      // after the querying program exits (the stray '1;2c' after nvim). Suppress
      // xterm's built-in responders so tmux stays the single authority — exactly
      // what iTerm2 does for tmux clients (terminalShouldSendReport:NO). OSC
      // 10/11 colour queries are deliberately NOT suppressed here: tmux cannot
      // know the outer colours, so those still need a client answer.
      const suppress = () => true;
      for (const id of [
        { final: 'c' },               // DA1
        { prefix: '>', final: 'c' },  // DA2
        { prefix: '=', final: 'c' },  // DA3
        { final: 'n' },               // DSR / CPR
        { prefix: '?', final: 'n' },  // DEC DSR
      ]) {
        terminal.parser.registerCsiHandler(id, suppress);
      }

      terminal.open(terminalElement);
      fitAddon.fit();
      terminal.focus();
      new ResizeObserver(debounceResize).observe(terminalElement);
      new MutationObserver(() => { terminal.options.theme = readVsCodeTheme(); }).observe(
        document.documentElement,
        { attributes: true, attributeFilter: ['class', 'data-vscode-theme-kind', 'data-vscode-theme-name'] },
      );
      terminal.onData((payload) => vscode.postMessage({ type: 'input', payload }));
      terminal.element.addEventListener('focusin', () => vscode.postMessage({ type: 'focused' }));

      const contextMenu = document.getElementById('context-menu');
      const findWidget = document.getElementById('find-widget');
      const findInput = document.getElementById('find-input');
      const findOptions = {
        decorations: {
          matchBackground: '#5c3300',
          matchBorder: '#ea5c00',
          activeMatchBackground: '#665500',
          activeMatchBorder: '#ffd60a',
          matchOverviewRuler: '#ea5c00',
          activeMatchColorOverviewRuler: '#ffd60a'
        }
      };

      function hideContextMenu() {
        contextMenu.style.display = 'none';
      }

      function copySelection() {
        const text = terminal.getSelection();
        if (text) void navigator.clipboard.writeText(text);
      }

      async function pasteClipboard() {
        const text = await navigator.clipboard.readText();
        if (text) vscode.postMessage({ type: 'input', payload: text });
      }

      function openFindWidget() {
        findWidget.style.display = 'flex';
        findInput.focus();
        findInput.select();
      }

      function closeFindWidget() {
        findWidget.style.display = 'none';
        searchAddon.clearDecorations();
        terminal.focus();
      }

      function findNext() {
        searchAddon.findNext(findInput.value, findOptions);
      }

      function findPrevious() {
        searchAddon.findPrevious(findInput.value, findOptions);
      }

      terminalElement.addEventListener('contextmenu', (event) => {
        event.preventDefault();
        contextMenu.style.left = event.clientX + 'px';
        contextMenu.style.top = event.clientY + 'px';
        contextMenu.style.display = 'block';
      });
      document.addEventListener('click', hideContextMenu);
      document.addEventListener('keydown', (event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          openFindWidget();
        }
        if (event.key === 'Escape' && findWidget.style.display !== 'none') {
          closeFindWidget();
        }
      });
      contextMenu.addEventListener('click', (event) => {
        const action = event.target.dataset.action;
        if (action === 'copy') copySelection();
        if (action === 'paste') void pasteClipboard();
        if (action === 'select-all') terminal.selectAll();
        if (action === 'clear') terminal.clear();
        hideContextMenu();
      });
      findInput.addEventListener('input', findNext);
      findInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && event.shiftKey) findPrevious();
        if (event.key === 'Enter' && !event.shiftKey) findNext();
      });
      document.getElementById('find-prev').addEventListener('click', findPrevious);
      document.getElementById('find-next').addEventListener('click', findNext);
      document.getElementById('find-close').addEventListener('click', closeFindWidget);

      window.addEventListener('message', async (event) => {
        const message = event.data;
        if (message.type === 'data') {
          terminal.write(message.payload);
        }
        if (message.type === 'config') {
          await warmFonts(message.payload.fontFamily, message.payload.fontSize);
          terminal.options.fontFamily = message.payload.fontFamily;
          terminal.options.fontSize = message.payload.fontSize;
          fitAddon.fit();
        }
        if (message.type === 'find') openFindWidget();
        if (message.type === 'exit') {
          terminal.writeln('\\r\\n[process exited ' + message.code + ']');
          vscode.postMessage({ type: 'exit' });
        }
      });
      requestAnimationFrame(() => {
        postResize();
        terminal.focus();
        vscode.postMessage({ type: 'ready', cols: terminal.cols, rows: terminal.rows });
      });
    })();
  </script>
</body>
</html>`;
  }
}
