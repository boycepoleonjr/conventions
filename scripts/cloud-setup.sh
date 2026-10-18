#!/bin/bash
# Claude Code cloud environment setup script: installs global agent rules and shared skills.
# Usage (environment "Setup script" field):
#   curl -fsSL https://raw.githubusercontent.com/boycepoleonjr/conventions/v1/scripts/cloud-setup.sh | CONVENTIONS_REF=v1 bash || true
# Always exits 0 so a network hiccup never blocks a session.
REF="${CONVENTIONS_REF:-v1}"
DIR=/tmp/conventions
LOG="$HOME/.claude/.conventions-setup.log"
mkdir -p "$HOME/.claude/skills"
{
  echo "conventions setup $(date -u +%FT%TZ) ref=$REF"
  rm -rf "$DIR"
  if git clone --depth 1 --branch "$REF" https://github.com/boycepoleonjr/conventions "$DIR"; then
    cp "$DIR/global/CLAUDE.md" "$HOME/.claude/CLAUDE.md" && echo "installed ~/.claude/CLAUDE.md"
    for s in "$DIR"/skills/*/; do
      n=$(basename "$s"); mkdir -p "$HOME/.claude/skills/$n"; cp "$s"SKILL.md "$HOME/.claude/skills/$n/SKILL.md" && echo "installed skill $n"
    done
    echo "version $(cat "$DIR/VERSION") commit $(git -C "$DIR" rev-parse --short HEAD)"
  else
    echo "clone failed"
  fi
} >> "$LOG" 2>&1
exit 0
