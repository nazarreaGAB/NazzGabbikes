#!/usr/bin/env bash
# Compiles backend/shop.cbl into the executable backend/shop
set -e
cd "$(dirname "$0")/.."
if ! command -v cobc >/dev/null 2>&1; then
  echo "ERROR: cobc (GnuCOBOL) is not installed."
  echo "In Codespaces: open the Command Palette and run 'Codespaces: Rebuild Container'."
  exit 1
fi
cobc -x -free -o backend/shop backend/shop.cbl
echo "COBOL build OK -> backend/shop"
