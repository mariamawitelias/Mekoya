#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
TOKEN=$(curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"citizen1@mekoya.test","password":"Demo!Pass2026"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "request $i: HTTP %{http_code} in %{time_total}s\n" -X POST "$BASE/ai/checklist" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"description":"my baby was born last week and I need the official paperwork"}'
done