#!/bin/sh

set -eu

checkout=$(git rev-parse --show-toplevel)
cd "$checkout"

npm ci
mkdir -p .markover

if [ ! -e .markover/development.json ]; then
  cp config/development.defaults.json .markover/development.json
fi
