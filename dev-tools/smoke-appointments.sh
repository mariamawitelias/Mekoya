#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
PW='Demo!Pass2026'
J='Content-Type: application/json'

login() {
  curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$1\",\"password\":\"$PW\"}" \
    | sed -E 's/.*"accessToken":"([^"]+)".*/\1/'
}
id_of() { sed -nE 's/.*"data":\{"id":"([^"]+)".*/\1/p'; }
body() { echo "{\"officeId\":\"$1\",\"serviceId\":\"$2\",\"date\":\"$3\",\"time\":\"$4\"}"; }
step() { echo; echo "--- $1"; }

# first Monday-Friday on or after N days from now
weekday_from() {
  local n=$1 d
  while true; do
    d=$(date -d "+$n days" +%F)
    if [ "$(date -d "$d" +%u)" -le 5 ]; then echo "$d"; return; fi
    n=$((n + 1))
  done
}
saturday() {
  local n=3 d
  while true; do
    d=$(date -d "+$n days" +%F)
    if [ "$(date -d "$d" +%u)" = 6 ]; then echo "$d"; return; fi
    n=$((n + 1))
  done
}

C1=$(login citizen1@mekoya.test); C2=$(login citizen2@mekoya.test)
C3=$(login citizen3@mekoya.test); C4=$(login citizen4@mekoya.test)
OB=$(login officer.bole@mekoya.test); OK=$(login officer.kirkos@mekoya.test)
case "$C1$C2$C3$C4$OB$OK" in
  eyJ*eyJ*eyJ*eyJ*eyJ*eyJ*) ;;
  *) echo "A login failed. Did you re-run the seed (citizen3, citizen4)? Is the password right?"; exit 1 ;;
esac

LIC=svc-license-renewal
TRADE=svc-trade-renewal
DATE=$(weekday_from 3)

case "$1" in
  flow)
    step "1. slots for $DATE (public, expect 6 slots, capacity 3)"
    curl -s "$BASE/offices/office-bole/slots?date=$DATE&serviceId=$LIC"; echo

    step "2. weekend (expect OFFICE_CLOSED or open:false)"
    curl -s "$BASE/offices/office-bole/slots?date=$(saturday)&serviceId=$LIC"; echo

    step "3. unverified user cannot book (expect 403 EMAIL_NOT_VERIFIED)"
    UEMAIL="unverified$(date +%s)@mekoya.test"
    curl -s -X POST "$BASE/auth/register" -H "$J" -d "{\"email\":\"$UEMAIL\",\"password\":\"Str0ng!Pass1\",\"fullName\":\"Unverified User\"}" > /dev/null
    UT=$(curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$UEMAIL\",\"password\":\"Str0ng!Pass1\"}" | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $UT" -H "$J" -d "$(body office-bole $LIC $DATE 08:30)"; echo

    step "4. invalid time (expect 400 listing allowedTimes)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-bole $LIC $DATE 08:45)"; echo

    step "5. office that does not offer the service (expect 404)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-arada $LIC $DATE 08:30)"; echo

    step "6. too far ahead (expect SLOT_TOO_FAR)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-bole $LIC "$(weekday_from 90)" 08:30)"; echo

    KEY="key-$(date +%s)-abcd"
    step "7. book with an Idempotency-Key (expect 201)"
    R1=$(curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -H "Idempotency-Key: $KEY" -d "$(body office-bole $LIC $DATE 08:30)")
    echo "$R1"; A1=$(echo "$R1" | id_of)

    step "8. same request with the same key (expect 200 and the SAME id: $A1)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -H "Idempotency-Key: $KEY" -d "$(body office-bole $LIC $DATE 08:30)"; echo

    step "9. different service at the same time (expect 409 TIME_CONFLICT)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-bole $TRADE $DATE 08:30)"; echo

    step "10. second license appointment (expect 201), then a third (expect 409 LIMIT_REACHED)"
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-bole $LIC $DATE 09:30)"; echo
    curl -s -X POST "$BASE/appointments" -H "Authorization: Bearer $C1" -H "$J" -d "$(body office-bole $LIC $DATE 10:30)"; echo

    step "11. IDOR: citizen2 reads and cancels citizen1's appointment (expect 403 and 403)"
    curl -s "$BASE/appointments/$A1" -H "Authorization: Bearer $C2"; echo
    curl -s -X PATCH "$BASE/appointments/$A1/cancel" -H "Authorization: Bearer $C2"; echo

    step "12. citizen1 sees the checklist (expect 4 items, document null)"
    curl -s "$BASE/appointments/$A1" -H "Authorization: Bearer $C1"; echo

    step "13. IDOR: Kirkos officer opens a Bole appointment (expect 403)"
    curl -s "$BASE/officer/appointments/$A1" -H "Authorization: Bearer $OK"; echo

    step "14. Bole officer queue for $DATE (expect the appointment, citizenName, documents counts)"
    curl -s "$BASE/officer/appointments?date=$DATE" -H "Authorization: Bearer $OB"; echo

    step "15. Bole officer completes a BOOKED appointment (expect 409 documents must be approved)"
    curl -s -X PATCH "$BASE/officer/appointments/$A1/complete" -H "Authorization: Bearer $OB" -H "$J" -d '{}'; echo

    step "16. citizen cannot use officer routes (expect 403)"
    curl -s "$BASE/officer/appointments" -H "Authorization: Bearer $C1"; echo

    step "17. reschedule to 10:30 (expect 200 and a new time)"
    curl -s -X PATCH "$BASE/appointments/$A1/reschedule" -H "Authorization: Bearer $C1" -H "$J" -d "{\"date\":\"$DATE\",\"time\":\"10:30\"}"; echo

    step "18. cancel (expect 200 CANCELLED), cancel again (expect 409 INVALID_STATE)"
    curl -s -X PATCH "$BASE/appointments/$A1/cancel" -H "Authorization: Bearer $C1"; echo
    curl -s -X PATCH "$BASE/appointments/$A1/cancel" -H "Authorization: Bearer $C1"; echo
    ;;

  race)
    DATE=$(weekday_from 4)
    echo "Firing 4 simultaneous bookings at one slot with capacity 3 ($DATE 14:00)."
    echo "Expected: exactly three 201 and one 409."
    for T in "$C1" "$C2" "$C3" "$C4"; do
      curl -s -o /dev/null -w "%{http_code}\n" -X POST "$BASE/appointments" \
        -H "Authorization: Bearer $T" -H "$J" -d "$(body office-bole $LIC "$DATE" 14:00)" &
    done
    wait
    ;;

  complete)
    echo "Completing $2 as the Bole officer"
    curl -s -X PATCH "$BASE/officer/appointments/$2/complete" -H "Authorization: Bearer $OB" -H "$J" -d '{"closureNote":"Documents checked at the counter"}'; echo
    ;;

  *) echo "usage: smoke-appointments.sh flow | race | complete APPOINTMENT_ID" ;;
esac