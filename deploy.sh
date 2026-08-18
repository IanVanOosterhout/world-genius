#!/bin/sh
# Publish index.html to the gh-pages branch as a single commit with no parent.
#
# index.html is 9.6 MB of already-compressed image data, which git cannot delta against
# a previous version: an ordinary commit of it adds a whole fresh copy to history, and
# history is forever, so twenty updates would mean ~200 MB in every clone. Rewriting the
# branch as one parentless commit each time keeps it at exactly one copy, the current one.
#
#   ./deploy.sh             build the commit and force-push it to origin
#   ./deploy.sh --dry-run   build the commit locally, push nothing
set -eu

cd "$(dirname "$0")"

dry_run=0
[ "${1:-}" = "--dry-run" ] && dry_run=1

[ -f index.html ] || { echo "deploy: no index.html, run the build first" >&2; exit 1; }
git rev-parse --git-dir >/dev/null 2>&1 || { echo "deploy: not a git repository" >&2; exit 1; }
if [ "$dry_run" -eq 0 ] && ! git remote get-url origin >/dev/null 2>&1; then
  echo "deploy: no 'origin' remote yet, add one first" >&2
  exit 1
fi

# Build the tree by hand rather than checking the branch out, so the working tree and the
# current branch are untouched. .nojekyll stops Pages running the file through Jekyll.
nojekyll=$(printf '' | git hash-object -w --stdin)
page=$(git hash-object -w index.html)
tree=$(printf '100644 blob %s\t.nojekyll\n100644 blob %s\tindex.html\n' "$nojekyll" "$page" | git mktree)
commit=$(git commit-tree "$tree" -m "Deploy $(date -u '+%Y-%m-%d %H:%M UTC')")

git update-ref refs/heads/gh-pages "$commit"
# The reflog would otherwise pin the superseded 9.6 MB blob locally for 90 days.
git reflog expire --expire=now refs/heads/gh-pages 2>/dev/null || true

if [ "$dry_run" -eq 1 ]; then
  echo "deploy: built $(git rev-parse --short "$commit") on gh-pages, not pushed (--dry-run)"
  exit 0
fi

git push --force origin gh-pages
echo "deploy: pushed $(git rev-parse --short "$commit"), live in a minute or so"
