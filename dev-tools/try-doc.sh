#!/usr/bin/env bash
# usage: bash dev-tools/try-doc.sh path/to/file.jpg "ID card"
# The optional second argument picks the checklist item by name:
# "photo", "ID card", "license" or "Medical"
BASE=http://localhost:4000/api/v1
PW='Demo!Pass2026'
J='Content-Type: application/json'
FILE="$1"; PICK="$2"
[ -f "$FILE" ] || { echo "usage: try-doc.sh path/to/file.jpg|png|pdf [checklist item name]"; exit 1; }

case "$FILE" in
  *.png) MIME=image/png ;;
  *.pdf) MIME=application/pdf ;;
  *) MIME=image/jpeg ;;
esac

TOKEN=$(curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"citizen1@mekoya.test\",\"password\":\"$PW\"}" \
  | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
case "$TOKEN" in eyJ*) ;; *) echo "Login failed. Run dev-tools/check-logins.sh"; exit 1 ;; esac
AUTH="Authorization: Bearer $TOKEN"

APPT=$(curl -s "$BASE/appointments/me?upcoming=true&limit=1" -H "$AUTH" \
  | sed -nE 's/.*"data":\[\{"id":"([^"]+)".*/\1/p')

if [ -z "$APPT" ]; then
  n=6; while [ "$(date -d "+$n days" +%u)" -gt 5 ]; do n=$((n + 1)); done
  APPT=$(curl -s -X POST "$BASE/appointments" -H "$AUTH" -H "$J" \
    -d "{\"officeId\":\"office-bole\",\"serviceId\":\"svc-license-renewal\",\"date\":\"$(date -d "+$n days" +%F)\",\"time\":\"10:30\"}" \
    | sed -nE 's/.*"data":\{"id":"([^"]+)".*/\1/p')
  [ -z "$APPT" ] && { echo "Could not book an appointment. Run: npx tsx dev-tools/clear-appointments.ts"; exit 1; }
  echo "Booked a new appointment: $APPT"
fi

DETAIL=$(curl -s "$BASE/appointments/$APPT" -H "$AUTH")
ENTRIES=$(echo "$DETAIL" | grep -oE '\{"id":"[0-9a-f-]{36}","name":"[^"]*"')
[ -n "$PICK" ] && ENTRIES=$(echo "$ENTRIES" | grep -i "$PICK")
[ -z "$ENTRIES" ] && { echo "No checklist item matches '$PICK'"; exit 1; }

UPLOADED=""
while IFS= read -r ENTRY; do
  ITEM=$(echo "$ENTRY" | sed -E 's/\{"id":"([^"]+)".*/\1/')
  NAME=$(echo "$ENTRY" | sed -E 's/.*"name":"([^"]*)"/\1/')
  CODE=$(curl -s -o dev-tools/.tmp/resp.json -w '%{http_code}' -X POST "$BASE/appointments/$APPT/documents" \
    -H "$AUTH" -F "serviceRequirementId=$ITEM" -F "file=@$FILE;type=$MIME")
  if [ "$CODE" = "201" ]; then UPLOADED="$NAME"; break; fi
  grep -q DOCUMENT_ALREADY_APPROVED dev-tools/.tmp/resp.json && continue
  cat dev-tools/.tmp/resp.json; echo; exit 1
done <<< "$ENTRIES"

[ -z "$UPLOADED" ] && { echo "Every matching item is already approved. Run: npx tsx dev-tools/clear-appointments.ts"; exit 1; }
echo "Uploaded as: $UPLOADED. Waiting for the AI..."
sleep "${WAIT:-8}"
npx tsx dev-tools/show-ai-results.ts