#!/usr/bin/env bash
BASE=http://localhost:4000/api/v1
PW='Str0ng!Pass1'
J='Content-Type: application/json'

case "$1" in
  register)
    EMAIL="user$(date +%s)@mekoya.test"
    echo "Registering $EMAIL"
    curl -s -X POST "$BASE/auth/register" -H "$J" \
      -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"fullName\":\"Email Tester\"}"; echo
    echo "$EMAIL" > .last-email
    echo "Now open the previewUrl printed in the server terminal and copy the token."
    ;;
  verify)
    curl -s -X POST "$BASE/auth/verify-email" -H "$J" -d "{\"token\":\"$2\"}"; echo
    ;;
  forgot)
    EMAIL=$(cat .last-email)
    curl -s -X POST "$BASE/auth/forgot-password" -H "$J" -d "{\"email\":\"$EMAIL\"}"; echo
    curl -s -X POST "$BASE/auth/forgot-password" -H "$J" -d '{"email":"nobody@mekoya.test"}'; echo
    ;;
  reset)
    curl -s -X POST "$BASE/auth/reset-password" -H "$J" \
      -d "{\"token\":\"$2\",\"newPassword\":\"NewPassw0rd!2\"}"; echo
    ;;
  login)
    EMAIL=$(cat .last-email)
    curl -s -X POST "$BASE/auth/login" -H "$J" -d "{\"email\":\"$EMAIL\",\"password\":\"$2\"}"; echo
    ;;
  *) echo "usage: smoke-email.sh register | verify TOKEN | forgot | reset TOKEN | login PASSWORD" ;;
esac