#!/usr/bin/env bash
#
# Fetch all api_latency telemetry logs from every deployment in the last week.
# Iterates over all deployments, pulls logs for each, and merges them into
# a single chronologically-sorted output file.
#
# Usage:
#   ./scripts/fetch-telemetry.sh              # defaults: last 7 days, output to telemetry-logs/
#   ./scripts/fetch-telemetry.sh --since 2h   # last 2 hours
#   ./scripts/fetch-telemetry.sh --since 1d   # last 1 day
#
# Prerequisites: railway CLI authenticated and linked to the voice-email project.
#   railway link --project voice-email --environment production

set -euo pipefail

SERVICE="voice-email"
SINCE="1w"
OUTPUT_DIR="telemetry-logs"

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --output) OUTPUT_DIR="$2"; shift 2 ;;
    --service) SERVICE="$2"; shift 2 ;;
    -h|--help)
      echo "Usage: $0 [--since <duration>] [--output <dir>] [--service <name>]"
      echo ""
      echo "  --since    Time window (default: 1w). Examples: 30m, 2h, 1d, 1w"
      echo "  --output   Output directory (default: telemetry-logs/)"
      echo "  --service  Railway service name (default: voice-email)"
      exit 0
      ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

TIMESTAMP=$(date -u +"%Y%m%d-%H%M%S")
RAW_FILE="$OUTPUT_DIR/raw-${TIMESTAMP}.log"
REPORT_FILE="$OUTPUT_DIR/telemetry-${TIMESTAMP}.log"

echo "Fetching deployment list for service: $SERVICE ..."
DEPLOY_IDS=$(railway deployment list --service "$SERVICE" --limit 100 --json 2>/dev/null \
  | node -e "
    const data = JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
    data.forEach(d => console.log(d.id));
  ")

DEPLOY_COUNT=$(echo "$DEPLOY_IDS" | wc -l | tr -d ' ')
echo "Found $DEPLOY_COUNT deployments. Fetching logs (--since $SINCE) ..."

# Fetch logs from each deployment, merge into one file.
# Note: --since doesn't work reliably with deployment IDs, so we fetch all
# available logs per deployment (--lines 10000) and filter by time in Node.
> "$RAW_FILE"
CURRENT=0
for DEPLOY_ID in $DEPLOY_IDS; do
  CURRENT=$((CURRENT + 1))
  echo "  [$CURRENT/$DEPLOY_COUNT] $DEPLOY_ID"
  railway logs --service "$SERVICE" "$DEPLOY_ID" --lines 5000 2>/dev/null \
    >> "$RAW_FILE" || true
done

# Filter to telemetry events, apply time window, deduplicate, and sort
node -e "
  const fs = require('fs');
  const raw = fs.readFileSync('$RAW_FILE', 'utf8');
  const lines = raw.split('\n').filter(l => l.includes('event=\"api_latency\"'));

  // Parse --since duration into a cutoff date
  const since = '$SINCE';
  const m = since.match(/^(\d+)(s|m|h|d|w)$/);
  let cutoff = null;
  if (m) {
    const n = parseInt(m[1]);
    const unit = { s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000 }[m[2]];
    cutoff = new Date(Date.now() - n * unit);
  }

  // Deduplicate by the structured content (strip Railway log timestamp prefix)
  const seen = new Set();
  const unique = lines.filter(line => {
    // Apply time filter
    if (cutoff) {
      const ts = line.match(/timestamp=\"([^\"]+)\"/)?.[1];
      if (ts && new Date(ts) < cutoff) return false;
    }
    const key = line.replace(/^\\S+\\s/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by the embedded timestamp field
  unique.sort((a, b) => {
    const ta = a.match(/timestamp=\"([^\"]+)\"/)?.[1] || '';
    const tb = b.match(/timestamp=\"([^\"]+)\"/)?.[1] || '';
    return ta.localeCompare(tb);
  });

  fs.writeFileSync('$REPORT_FILE', unique.join('\n') + '\n');
  console.log();
  console.log('Done!');
  console.log('  Total events: ' + unique.length);
  console.log('  Output: $REPORT_FILE');
  if (cutoff) console.log('  Since: ' + cutoff.toISOString());

  // Quick stats
  const providers = {};
  for (const line of unique) {
    const p = line.match(/provider=\"([^\"]+)\"/)?.[1] || 'unknown';
    providers[p] = (providers[p] || 0) + 1;
  }
  console.log('  Providers: ' + Object.entries(providers).map(([k,v]) => k+'='+v).join(', '));

  if (unique.length > 0) {
    const first = unique[0].match(/timestamp=\"([^\"]+)\"/)?.[1];
    const last = unique[unique.length-1].match(/timestamp=\"([^\"]+)\"/)?.[1];
    console.log('  Time range: ' + first + ' to ' + last);
  }
"

# Clean up raw file
rm -f "$RAW_FILE"

echo ""
echo "Telemetry logs saved to: $REPORT_FILE"
