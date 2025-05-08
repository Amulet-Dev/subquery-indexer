set -euo pipefail
IFS=$'\n\t'

# === Configuration ===
LOG_FILE="${LOG_FILE:-$HOME/reclaim_docker_space.log}"
PRUNE_CMDS=(
  "docker system df"
  "docker container prune -f"
  "docker network prune -f"
  "docker image prune -af"
  "docker volume prune -f"
  "docker builder prune -af"
  "docker system df"
)

# Timestamp helper
timestamp() { date '+%Y-%m-%d %H:%M:%S'; }

# Start logging
echo "$(timestamp) [INFO] Starting Docker reclamation" >> "$LOG_FILE"

# Execute each prune command and log output
echo "$(timestamp) [INFO] Disk usage before and after cleanup:" >> "$LOG_FILE"
for cmd in "${PRUNE_CMDS[@]}"; do
  echo "\$ $cmd" >> "$LOG_FILE"
  # shellcheck disable=SC2086
  eval $cmd >> "$LOG_FILE" 2>&1
done

echo "$(timestamp) [INFO] Docker reclamation completed" >> "$LOG_FILE"

