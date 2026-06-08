import * as vscode from 'vscode';
import { terminalSessionName } from './tmuxSafe';

export const terminalUriScheme = 'deck-terminal';

export interface EncodeTerminalSessionUriParts {
  worktreePath: string;
  term: number;
}

export interface DecodedTerminalSessionUriParts {
  worktreePath: string;
  term: number;
  sessionName: string;
  cwd: string;
}

export class SessionUriCodec {
  encode(parts: EncodeTerminalSessionUriParts): vscode.Uri {
    return vscode.Uri.from({
      scheme: terminalUriScheme,
      path: `${parts.worktreePath.replace(/\/+$/, '')}/term-${parts.term}`,
    });
  }

  decode(uri: vscode.Uri): DecodedTerminalSessionUriParts {
    if (uri.scheme !== terminalUriScheme) throw new Error(`Unexpected terminal URI scheme: ${uri.scheme}`);
    if (uri.authority || uri.query) throw new Error('Malformed terminal URI');

    const separator = uri.path.lastIndexOf('/');
    const basename = separator >= 0 ? uri.path.slice(separator + 1) : uri.path;
    const match = /^term-(\d+)$/.exec(basename);
    if (!match || separator <= 0) throw new Error('Malformed terminal URI');

    const worktreePath = uri.path.slice(0, separator);
    const term = Number(match[1]);
    return {
      worktreePath,
      term,
      sessionName: terminalSessionName(worktreePath, term),
      cwd: worktreePath,
    };
  }
}
