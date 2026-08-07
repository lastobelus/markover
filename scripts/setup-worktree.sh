#!/bin/sh

set -eu

script_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
checkout=$(git -C "$script_directory/.." rev-parse --show-toplevel)
cd "$checkout"

npm ci
mkdir -p .markover

if [ ! -e .markover/development.json ]; then
  cp config/development.defaults.json .markover/development.json
fi
