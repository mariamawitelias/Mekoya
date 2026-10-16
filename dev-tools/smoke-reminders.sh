#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
PW='Demo!Pass2026'
J='Content-Type: application/json'

C1=$(curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"citizen1@mekoya.test\",\"password\":\"$PW\"}" \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
case "$C1" in eyJ*) ;; *) echo "Login failed. Run dev-tools/check-logins.sh"; exit 1 ;; esac

# the next weekday that is at least 2 days away (inside a 72-hour window)
n=2
while [ "$(date -d "+$n days" +%u)" -gt 5 ]; do n=$((n + 1)); done
DATE=$(date -d "+$n days" +%F)

echo "Booking a license appointment for $DATE 15:00 (no documents uploaded)"
curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" \
  -d "{\"officeId\":\"office-bole\",\"serviceId\":\"svc-license-renewal\",\"date\":\"$DATE\",\"time\":\"15:00\"}" \
  | grep -oE '"status":"[A-Z]+"|"date":"[^"]+"|"time":"[^"]+"'