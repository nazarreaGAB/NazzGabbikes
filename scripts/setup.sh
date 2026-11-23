#!/usr/bin/env bash
# Runs automatically when the Codespace is created: installs GnuCOBOL and compiles the program.
set -e
sudo apt-get update
sudo apt-get install -y gnucobol
cd "$(dirname "$0")/.."
npm run build:cobol
echo "Setup finished. Type: npm start"
