#!/usr/bin/env bash
# Wrapper for ingesting the high-priority PDF without typing the API key or
# long paths inline (avoids the prompt line-wrap that splits the command).
#
# Setup once:  put ONLY your API key in a file named  .anthropic_key  at the
# repo root (it's git-ignored). Easiest: open a new file in your editor, paste
# the key, save. No quotes, no "export", nothing else.
#
# Usage:
#   bash scripts/ingest_hp.sh --dry-run --max-pages 3   # cheap preview
#   bash scripts/ingest_hp.sh                           # full real run
# Any extra args are passed straight through to ingest_pdf.py.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KEY_FILE="$REPO_ROOT/.anthropic_key"

if [[ ! -f "$KEY_FILE" ]]; then
  echo "ERROR: $KEY_FILE not found. Create it with your Anthropic API key (key only)." >&2
  exit 1
fi

# Strip any stray whitespace/newlines a paste may have introduced.
ANTHROPIC_API_KEY="$(tr -d '[:space:]' < "$KEY_FILE")"
export ANTHROPIC_API_KEY

if [[ -z "$ANTHROPIC_API_KEY" || "$ANTHROPIC_API_KEY" == "REPLACE_WITH_YOUR_KEY" ]]; then
  echo "ERROR: $KEY_FILE still has the placeholder. Open it and paste your real key (key only)." >&2
  exit 1
fi
if [[ "$ANTHROPIC_API_KEY" != sk-* ]]; then
  echo "WARNING: key does not start with 'sk-' — check you pasted the full key." >&2
fi

exec python3 "$REPO_ROOT/scripts/ingest_pdf.py" \
  --pdf "$REPO_ROOT/problem_bank/new_6_HP.pdf" \
  --high-priority \
  "$@"
