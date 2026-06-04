# TASK

Merge the following branches into the current branch:

{{BRANCHES}}

For each branch:

1. Run `git merge <branch> --no-edit`
2. If there are merge conflicts, resolve them intelligently by reading both sides and choosing the correct resolution
3. After resolving conflicts, install deps then verify:

   ```sh
   npm ci
   npm run typecheck && npm run test
   ```

   Use `npm ci` (not `npm install`) — it won't rewrite `package-lock.json`. If `npm ci` fails because `package.json` and `package-lock.json` are out of sync, that's a real bug in the merge: fix it by running `npm install` once and committing the updated lockfile as part of the merge.

4. If verification fails, fix the issues before proceeding to the next branch

If every merge fast-forwarded cleanly and there were no fixes, do NOT create an empty summary commit. Only commit if the merge produced a real merge commit or you applied fixes.

# CLOSE ISSUES

For each branch that was merged, close its child issue. Do NOT close parent issues (PRDs) — leave them open even if all their child issues are now closed. PRD closure is a human decision, not a merger task.

Here are all the issues:

{{ISSUES}}

Once you've merged everything you can, output <promise>COMPLETE</promise>.
