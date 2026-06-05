import { Worktree } from '../git/parsers';

const DEFAULT_BRANCHES = ['main', 'develop', 'master'];

export function sortWorktrees(wts: Worktree[]): Worktree[] {
  return [...wts].sort((a, b) => {
    // 1. Virtual items ALWAYS first
    if (a.isVirtual && !b.isVirtual) { return -1; }
    if (!a.isVirtual && b.isVirtual) { return 1; }

    const aIsDefault = DEFAULT_BRANCHES.includes(a.branch);
    const bIsDefault = DEFAULT_BRANCHES.includes(b.branch);

    if (aIsDefault && !bIsDefault) { return -1; }
    if (!aIsDefault && bIsDefault) { return 1; }

    if (aIsDefault && bIsDefault) {
      const d = DEFAULT_BRANCHES.indexOf(a.branch) - DEFAULT_BRANCHES.indexOf(b.branch);
      if (d !== 0) { return d; }
    }

    // The main worktree should always be first (among non-virtual default branches)
    if (a.isMain && !b.isMain) { return -1; }
    if (!a.isMain && b.isMain) { return 1; }

    // Otherwise alphabetical by branch
    return a.branch.localeCompare(b.branch);
  });
}
