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

C1=$(login citizen1@mekoya.test); OB=$(login officer.bole@mekoya.test); OK=$(login officer.kirkos@mekoya.test)
case "$C1$OB$OK" in eyJ*eyJ*eyJ*) ;; *) echo "A login failed. Run dev-tools/check-logins.sh"; exit 1 ;; esac

echo 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==' | base64 -d > "$TMP/photo.png"

n=5
while [ "$(date -d "+$n days" +%u)" -gt 5 ]; do n=$((n + 1)); done
DATE=$(date -d "+$n days" +%F)

book() {
  curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" \
    -d "{\"officeId\":\"office-bole\",\"serviceId\":\"svc-license-renewal\",\"date\":\"$DATE\",\"time\":\"$1\"}" \
    | sed -nE 's/.*"data":\{"id":"([^"]+)".*/\1/p'
}
items_of() {
  curl -s "$BASE/appointments/$1" -H "Authorization: Bearer $C1" \
    | grep -oE '"id":"[0-9a-f-]{36}"' | sed -n '2,5p' | sed -E 's/"id":"([^"]+)"/\1/'
}
up() { # appointment item filename
  curl -s -X POST "$BASE/appointments/$1/documents" -H "Authorization: Bearer $C1" \
    -F "serviceRequirementId=$2" -F "file=@$TMP/photo.png;filename=$3;type=image/png"
}
doc_of() { sed -nE 's/.*"document":\{"id":"([^"]+)".*/\1/p'; }
summary() { # what the officer sees: statuses, AI status, reasons
  curl -s "$BASE/officer/appointments/$1" -H "Authorization: Bearer $OB" \
    | grep -oE '"(status|aiStatus|rejectionReason|appealRequested)":("[^"]*"|null|true|false)'
}
review() { # document decision reason token
  curl -s -X PATCH "$BASE/officer/documents/$1/review" -H "Authorization: Bearer $4" -H "$J" -d "$2"; echo
}

step "setup: appointment A at 11:30 and appointment B at 14:00"
A=$(book 11:30); B=$(book 14:00)
[ -z "$A" ] || [ -z "$B" ] && { echo "Booking failed. Run: npx tsx dev-tools/clear-appointments.ts"; exit 1; }
mapfile -t AI < <(items_of "$A"); mapfile -t BI < <(items_of "$B")
echo "A=$A"; echo "B=$B"

step "PART A: four good documents for A (file names with no keywords)"
DA1=$(up "$A" "${AI[0]}" ok1.png | doc_of)
for i in 1 2 3; do up "$A" "${AI[$i]}" "ok$((i + 1)).png" > /dev/null; done
echo "waiting for the background review..."; sleep 4
summary "$A"
echo "EXPECT: appointment status CONFIRMED, four documents AI_APPROVED, aiStatus DONE"

step "PART B1: blurry file (expect AI_REJECTED, reason, and a rejection email in the server log)"
DB1=$(up "$B" "${BI[0]}" blurry.png | doc_of); sleep 3; summary "$B"

step "PART B2: citizen appeals the AI rejection (expect NEEDS_HUMAN, appealRequested true)"
curl -s -X POST "$BASE/documents/$DB1/appeal" -H "Authorization: Bearer $C1"; echo

step "PART B3: appeal on an APPROVED document (expect 409)"
curl -s -X POST "$BASE/documents/$DA1/appeal" -H "Authorization: Bearer $C1"; echo

step "PART B4: low confidence, wrong type, and AI failure (waits about 9s for the retries)"
DB2=$(up "$B" "${BI[1]}" unsure.png | doc_of)
DB3=$(up "$B" "${BI[2]}" fail.png | doc_of)
DB4=$(up "$B" "${BI[3]}" wrong.png | doc_of)
sleep 9; summary "$B"
echo "EXPECT: unsure = NEEDS_HUMAN (DONE), fail = NEEDS_HUMAN with aiStatus FALLBACK, wrong = AI_REJECTED"

step "PART B5: officer queue for documents needing a human (expect b1 appeal, unsure, fail)"
curl -s "$BASE/officer/documents" -H "Authorization: Bearer $OB"; echo

step "PART B6: wrong-office officer reviews it (expect 403)"
review "$DB1" '{"decision":"APPROVE"}' x "$OK"

step "PART B7: reject without a reason (expect 400)"
review "$DB1" '{"decision":"REJECT"}' x "$OB"

step "PART B8: officer approves the appealed document (expect OFFICER_APPROVED)"
review "$DB1" '{"decision":"APPROVE","reason":"Readable at the counter"}' x "$OB"

step "PART C1: officer OVERRIDES an AI approval on appointment A (expect OFFICER_REJECTED, A back to BOOKED)"
review "$DA1" '{"decision":"REJECT","reason":"Photo does not match the applicant"}' x "$OB"
summary "$A"

step "PART C2: citizen uploads a replacement (expect version 2, then AI_APPROVED and A CONFIRMED again)"
up "$A" "${AI[0]}" replacement.png > /dev/null; sleep 4; summary "$A"

step "PART D: officer completes A (expect COMPLETED)"
curl -s -X PATCH "$BASE/officer/appointments/$A/complete" -H "Authorization: Bearer $OB" -H "$J" -d '{"closureNote":"All documents verified"}' | grep -oE '"status":"[A-Z_]+"' | head -1