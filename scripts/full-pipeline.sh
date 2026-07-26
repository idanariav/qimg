#!/usr/bin/env bash
set -euo pipefail

# Run the full qimg processing pipeline: index, caption, ocr, embed.
#
# Usage: scripts/full-pipeline.sh [-- <qimg args, e.g. --collection <name>>]
# Example: scripts/full-pipeline.sh --collection photos

qimg index "$@" && qimg caption "$@" && qimg ocr "$@" && qimg embed "$@"
