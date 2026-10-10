#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
ADMIN_EMAIL='admin@mekoya.test'
ADMIN_PW='admin123'
STAFF_PW='Officer!Pass2026'
J='Content-Type: application/json'

login() {
  curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}

ADMIN=$(login "$ADMIN_EMAIL" "$ADMIN_PW")
case "$ADMIN" in
  eyJ*) ;;
  *) echo "Super Admin login failed. Check ADMIN_EMAIL and ADMIN_PW at the top of this script."; exit 1 ;;
esac
AUTH="Authorization: Bearer $ADMIN"

case "$1" in
  checks)
    CITIZEN=$(login citizen1@mekoya.test 'Demo!Pass2026')
    CONTENT=$(login content.admin@mekoya.test 'Demo!Pass2026')
    NEW='{"email":"x@mekoya.test","fullName":"Test Person","role":"OFFICER","officeId":"office-arada"}'
    echo "--- officer without an office (expect 400)"
    curl -s -X POST "$BASE/admin/users" -H "$AUTH" -H "$J" -d '{"email":"x@mekoya.test","fullName":"Test Person","role":"OFFICER"}'; echo
    echo "--- trying to create a SUPER_ADMIN (expect 400)"
    curl -s -X POST "$BASE/admin/users" -H "$AUTH" -H "$J" -d '{"email":"x@mekoya.test","fullName":"Test Person","role":"SUPER_ADMIN"}'; echo
    echo "--- unknown office (expect 404)"
    curl -s -X POST "$BASE/admin/users" -H "$AUTH" -H "$J" -d '{"email":"x@mekoya.test","fullName":"Test Person","role":"OFFICER","officeId":"office-nowhere"}'; echo
    echo "--- as citizen (expect 403)"
    curl -s -X POST "$BASE/admin/users" -H "Authorization: Bearer $CITIZEN" -H "$J" -d "$NEW"; echo
    echo "--- as content admin (expect 403, no user:manage)"
    curl -s -X GET "$BASE/admin/users" -H "Authorization: Bearer $CONTENT"; echo
    ;;
  create)
    EMAIL="officer$(date +%s)@mekoya.test"
    RESP=$(curl -s -X POST "$BASE/admin/users" -H "$AUTH" -H "$J" \
      -d "{\"email\":\"$EMAIL\",\"fullName\":\"New Officer\",\"role\":\"OFFICER\",\"officeId\":\"office-arada\"}")
    echo "$RESP"
    ID=$(echo "$RESP" | sed -nE 's/.*"id":"([^"]+)".*/\1/p')
    printf '%s\n%s\n' "$EMAIL" "$ID" > .last-staff
    echo "Open the previewUrl in the server terminal and copy the invite token."
    ;;
  officer-login)
    EMAIL=$(sed -n 1p .last-staff)
    curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$STAFF_PW\"}"; echo
    ;;
  accept)
    curl -s -X POST "$BASE/auth/accept-invite" -H "$J" -d "{\"token\":\"$2\",\"password\":\"$STAFF_PW\"}"; echo
    ;;
  me)
    EMAIL=$(sed -n 1p .last-staff)
    TOKEN=$(login "$EMAIL" "$STAFF_PW")
    curl -s "$BASE/auth/me" -H "Authorization: Bearer $TOKEN"; echo
    ;;
  deactivate | reactivate)
    ID=$(sed -n 2p .last-staff)
    VAL=false
    [ "$1" = "reactivate" ] && VAL=true
    curl -s -X PATCH "$BASE/admin/users/$ID/status" -H "$AUTH" -H "$J" -d "{\"isActive\":$VAL}"; echo
    ;;
  users)
    curl -s "$BASE/admin/users?role=OFFICER" -H "$AUTH"; echo
    ;;
  audit)
    curl -s "$BASE/admin/audit-logs?limit=8" -H "$AUTH"; echo
    ;;
  *) echo "usage: smoke-staff.sh checks | create | officer-login | accept TOKEN | me | deactivate | reactivate | users | audit" ;;
esac