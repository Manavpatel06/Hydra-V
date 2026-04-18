#!/usr/bin/env bash
set -euo pipefail

missing=0

check_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    echo "[ok] $name -> $(command -v "$name")"
  else
    echo "[missing] $name"
    missing=1
  fi
}

echo "HYDRA-V local environment doctor"
echo "--------------------------------"
check_cmd git
check_cmd node
check_cmd npm

if [[ "$missing" -eq 1 ]]; then
  echo
  echo "One or more required tools are missing."
  echo "Read README.md section 'Brand-New Mac Setup (from zero)' and install missing tools."
  exit 1
fi

echo
echo "Versions"
echo "--------"
echo "node: $(node -v)"
echo "npm:  $(npm -v)"
echo "git:  $(git --version)"
echo
echo "Environment looks ready."
