#!/usr/bin/env bash
cd "$(dirname "$0")/.." || exit 1

run() { 
  echo; echo "=================== $1 uploaded as: $2"
  npx tsx dev-tools/clear-appointments.ts > /dev/null
  bash dev-tools/try-doc.sh "dev-tools/samples/$1" "$2"
}

run fake-id-blurry.png "ID card"
run fake-id-cropped.png "ID card"
run wrong-receipt.png "ID card"
run fake-license-expired.png "license"