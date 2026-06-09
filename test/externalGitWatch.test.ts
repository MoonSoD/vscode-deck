import { describe, expect, it, vi } from 'vitest';
import { ExternalGitWatch, type Disposable } from '../src/repository/externalGitWatch';

describe('ExternalGitWatch', () => {
  it('reconciles watched common dirs and disposes removed watches', () => {
    const disposables = new Map<string, Disposable>();
    const watchCommonDir = vi.fn((commonDir: string) => {
      const disposable = { dispose: vi.fn() };
      disposables.set(commonDir, disposable);
      return disposable;
    });
    const externalGitWatch = new ExternalGitWatch(watchCommonDir);

    externalGitWatch.sync(new Set(['/git/alpha', '/git/beta']));
    externalGitWatch.sync(new Set(['/git/beta', '/git/gamma']));

    expect(watchCommonDir).toHaveBeenCalledTimes(3);
    expect(watchCommonDir.mock.calls.map(([commonDir]) => commonDir)).toEqual([
      '/git/alpha',
      '/git/beta',
      '/git/gamma',
    ]);
    expect(disposables.get('/git/alpha')?.dispose).toHaveBeenCalledOnce();
    expect(disposables.get('/git/beta')?.dispose).not.toHaveBeenCalled();
    expect(disposables.get('/git/gamma')?.dispose).not.toHaveBeenCalled();

    externalGitWatch.sync(new Set(['/git/beta', '/git/gamma']));

    expect(watchCommonDir).toHaveBeenCalledTimes(3);
    expect(disposables.get('/git/beta')?.dispose).not.toHaveBeenCalled();
    expect(disposables.get('/git/gamma')?.dispose).not.toHaveBeenCalled();

    externalGitWatch.dispose();

    expect(disposables.get('/git/beta')?.dispose).toHaveBeenCalledOnce();
    expect(disposables.get('/git/gamma')?.dispose).toHaveBeenCalledOnce();
  });
});
