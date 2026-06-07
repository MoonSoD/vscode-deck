import * as vscode from 'vscode';

export const terminalUriScheme = 'deck-terminal';

export interface TerminalSessionUriParts {
  sessionName: string;
  cwd: string;
}

export class SessionUriCodec {
  encode(parts: TerminalSessionUriParts): vscode.Uri {
    return vscode.Uri.from({
      scheme: terminalUriScheme,
      authority: 'session',
      path: `/${encodeURIComponent(parts.sessionName)}`,
      query: new URLSearchParams({ cwd: parts.cwd }).toString(),
    });
  }

  decode(uri: vscode.Uri): TerminalSessionUriParts {
    if (uri.scheme !== terminalUriScheme) throw new Error(`Unexpected terminal URI scheme: ${uri.scheme}`);

    const sessionName = decodeURIComponent(uri.path.replace(/^\//, ''));
    const cwd = new URLSearchParams(uri.query).get('cwd');
    if (!sessionName || !cwd) throw new Error('Malformed terminal URI');

    return { sessionName, cwd };
  }
}
