#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
PW='Demo!Pass2026'

login() {
  curl -s -X POST "$BASE/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$PW\"}" \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}

CITIZEN=$(login citizen1@mekoya.test)
ADMIN=$(login content.admin@mekoya.test)

case "$CITIZEN$ADMIN" in
  eyJ*eyJ*) ;;
  *) echo "Login failed. Check the seed and the password in this script."; exit 1 ;;
esac

step() { echo; echo "--- $1"; }

step "1. services list (expect success + meta)"
curl -s "$BASE/services"; echo

step "2. search with limit (expect 1-2 results)"
curl -s "$BASE/services?search=license&limit=2"; echo

step "3. one service, English"
curl -s "$BASE/services/svc-license-renewal"; echo

step "4. same service, Amharic (expect Amharic name)"
curl -s "$BASE/services/svc-license-renewal" -H 'Accept-Language: am'; echo

step "5. offices offering TIN"
curl -s "$BASE/offices?serviceId=svc-tin"; echo

step "6. limit=500 (expect VALIDATION_ERROR)"
curl -s "$BASE/services?limit=500"; echo

step "7. unknown id (expect 404)"
curl -s "$BASE/services/not-found-id"; echo

step "8. admin, no token (expect 401)"
curl -s -X POST "$BASE/admin/services" -H 'Content-Type: application/json' -d '{}'; echo

step "9. admin as citizen (expect 403)"
curl -s -X POST "$BASE/admin/services" -H "Authorization: Bearer $CITIZEN" \
  -H 'Content-Type: application/json' -d '{}'; echo

step "10. admin, bad body (expect 400 listing every field)"
curl -s -X POST "$BASE/admin/services" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d '{"slug":"Bad Slug","category":""}'; echo

SLUG="vehicle-registration-$(date +%s)"
BODY="{\"slug\":\"$SLUG\",\"nameEn\":\"Vehicle Registration\",\"category\":\"Transport\"}"

step "11. admin, valid (expect 201)"
curl -s -X POST "$BASE/admin/services" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d "$BODY"; echo

step "12. same slug again (expect 409 CONFLICT)"
curl -s -X POST "$BASE/admin/services" -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' -d "$BODY"; echo