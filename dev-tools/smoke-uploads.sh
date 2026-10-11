#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
PW='Demo!Pass2026'
J='Content-Type: application/json'
TMP=dev-tools/.tmp
mkdir -p "$TMP"

login() {
  curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$1\",\"password\":\"$PW\"}" \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}
step() { echo; echo "--- $1"; }

C1=$(login citizen1@mekoya.test); C2=$(login citizen2@mekoya.test)
OB=$(login officer.bole@mekoya.test); OK=$(login officer.kirkos@mekoya.test)
case "$C1$C2$OB$OK" in eyJ*eyJ*eyJ*eyJ*) ;; *) echo "A login failed. Run dev-tools/check-logins.sh"; exit 1 ;; esac

# test files: a tiny real PNG, a text file pretending to be a JPEG, a 6MB file, a plain text file
echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > "$TMP/photo.png"
echo 'this is not an image' > "$TMP/fake.jpg"
echo 'plain text' > "$TMP/note.txt"
head -c 6000000 /dev/zero > "$TMP/big.png"

# a weekday 5+ days ahead, so booking works any day
n=5
while [ "$(date -d "+$n days" +%u)" -gt 5 ]; do n=$((n + 1)); done
DATE=$(date -d "+$n days" +%F)

step "setup: book a license appointment as citizen1 for $DATE 11:30"
BOOK=$(curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" \
  -d "{\"officeId\":\"office-bole\",\"serviceId\":\"svc-license-renewal\",\"date\":\"$DATE\",\"time\":\"11:30\"}")
APPT=$(echo "$BOOK" | sed -nE 's/.*"data":\{"id":"([^"]+)".*/\1/p')
[ -z "$APPT" ] && { echo "Booking failed (limit reached? run: npx tsx dev-tools/clear-appointments.ts):"; echo "$BOOK"; exit 1; }
echo "appointment: $APPT"

DETAIL=$(curl -s "$BASE/appointments/$APPT" -H "Authorization: Bearer $C1")
ITEM=$(echo "$DETAIL" | sed -nE 's/.*"checklist":\[\{"id":"([^"]+)".*/\1/p')
echo "first checklist item: $ITEM"

up() { # token appointment item file type
  curl -s -X POST "$BASE/appointments/$2/documents" -H "Authorization: Bearer $1" \
    -F "serviceRequirementId=$3" -F "file=@$4;type=$5"
}

step "1. valid PNG (expect 201, status PENDING, NO filePath in the response)"
R1=$(up "$C1" "$APPT" "$ITEM" "$TMP/photo.png" image/png); echo "$R1"
DOC=$(echo "$R1" | sed -nE 's/.*"document":\{"id":"([^"]+)".*/\1/p')

step "2. no file at all (expect 400 FILE_REQUIRED)"
curl -s -X POST "$BASE/appointments/$APPT/documents" -H "Authorization: Bearer $C1" -F "serviceRequirementId=$ITEM"; echo

step "3. text file declared as text/plain (expect 415 UNSUPPORTED_FILE_TYPE)"
up "$C1" "$APPT" "$ITEM" "$TMP/note.txt" text/plain; echo

step "4. text content disguised as a JPEG (expect 415, content check catches it)"
up "$C1" "$APPT" "$ITEM" "$TMP/fake.jpg" image/jpeg; echo

step "5. 6MB file (expect 413 FILE_TOO_LARGE; curl may show a connection reset instead, check the server log)"
up "$C1" "$APPT" "$ITEM" "$TMP/big.png" image/png; echo

step "6. checklist item from another appointment/service (expect 404)"
up "$C1" "$APPT" "item-that-does-not-exist" "$TMP/photo.png" image/png; echo

step "7. IDOR: citizen2 uploads to citizen1's appointment (expect 403)"
up "$C2" "$APPT" "$ITEM" "$TMP/photo.png" image/png; echo

step "8. replace the document (expect 201 with version 2)"
up "$C1" "$APPT" "$ITEM" "$TMP/photo.png" image/png; echo

step "9. download as the owner (expect 200 image/png)"
curl -s -o "$TMP/downloaded.png" -w '%{http_code} %{content_type}\n' "$BASE/documents/$DOC/file" -H "Authorization: Bearer $C1"
cmp -s "$TMP/photo.png" "$TMP/downloaded.png" && echo "downloaded file is byte-identical to the upload"

step "10. download as citizen2 (expect 403)"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/documents/$DOC/file" -H "Authorization: Bearer $C2"

step "11. download as the Kirkos officer, wrong office (expect 403)"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/documents/$DOC/file" -H "Authorization: Bearer $OK"

step "12. download as the Bole officer, right office (expect 200)"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/documents/$DOC/file" -H "Authorization: Bearer $OB"

step "13. download with no token (expect 401)"
curl -s -o /dev/null -w '%{http_code}\n' "$BASE/documents/$DOC/file"

step "14. the appointment now shows the current document (expect version-2 data, status PENDING)"
curl -s "$BASE/appointments/$APPT" -H "Authorization: Bearer $C1"; echo