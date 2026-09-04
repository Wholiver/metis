#!/usr/bin/env bash
# docker_shell.sh
# Bridge shell commands from Metis into the task's Docker sandbox container

if [ -n "$ALE_CONTAINER_ID" ]; then
    target_dir="$PWD"
    # If the working directory exists inside the container, use it; otherwise fall back to /workspace
    if [ -d "$target_dir" ] && docker exec "$ALE_CONTAINER_ID" test -d "$target_dir" 2>/dev/null; then
        exec docker exec -i -w "$target_dir" "$ALE_CONTAINER_ID" /bin/bash "$@"
    else
        exec docker exec -i -w /workspace "$ALE_CONTAINER_ID" /bin/bash "$@"
    fi
else
    exec /bin/bash "$@"
fi
