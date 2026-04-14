#!/usr/bin/env bash
# Smoke-test every API route. Requires dev server (default http://localhost:3000).
set -euo pipefail
BASE="${BASE_URL:-http://localhost:3000}"
COOKIEJAR="$(mktemp)"
trap 'rm -f "$COOKIEJAR"' EXIT

hit() {
  local m="$1" url="$2"
  shift 2
  code=$(curl -sS -o /tmp/api_body.txt -w "%{http_code}" -g -X "$m" "$url" "$@")
  printf "%s\t%s\t%s\n" "$code" "$m" "$url"
}

echo "code	method	url"

echo "# --- public / anonymous ---"
hit GET "$BASE/api/health"
hit GET "$BASE/api/payments/razorpay/status"
hit GET "$BASE/api/cities"
hit GET "$BASE/api/normalize?q=paracetamol%20500"
hit GET "$BASE/api/medicines/search?q=para"
hit GET "$BASE/api/medicines/search"
hit POST "$BASE/api/prescription/ocr" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/labs/prescription/ocr?city=mumbai" -H "Content-Type: application/json" -d "{}"
hit GET "$BASE/api/labs/categories"
hit GET "$BASE/api/labs/intent?q=lipid&city=mumbai"
hit GET "$BASE/api/labs/search?q=cbc&city=mumbai"
hit GET "$BASE/api/labs/package/1?city=mumbai"
hit GET "$BASE/api/compare?medicineId=28&city=mumbai"
hit GET "$BASE/api/compare/search?q=para&city=mumbai"
hit GET "$BASE/api/compare/search?q=p&city=mumbai"
hit GET "$BASE/api/compare/by-pincode?q=para&pincode=500001&city=mumbai"
hit GET "$BASE/api/compare/by-pincode?q=para"
hit GET "$BASE/api/carts/999999"
hit GET "$BASE/api/carts/999999/compare?city=mumbai"
hit GET "$BASE/api/catalog/skus"
hit GET "$BASE/api/catalog/skus?q=med"
hit GET "$BASE/api/catalog/skus/not-a-uuid"
hit GET "$BASE/api/catalog/skus/00000000-0000-4000-8000-000000000001"
hit GET "$BASE/api/catalog/users"
hit GET "$BASE/api/geocode/reverse?lat=19.076&lng=72.8777"
hit GET "$BASE/api/online/compare?medicineId=28"
hit GET "$BASE/api/online/compare?q=metformin%20500"
hit GET "$BASE/api/auth/me"
hit POST "$BASE/api/auth/request-otp" -H "Content-Type: application/json" -d "{\"phone\":\"9999999999\"}"
hit POST "$BASE/api/auth/verify-otp" -H "Content-Type: application/json" -d "{\"phone\":\"9999999999\",\"code\":\"123456\"}"
hit GET "$BASE/api/auth/google/start"
hit GET "$BASE/webhook/whatsapp"
hit POST "$BASE/webhook/whatsapp" -H "Content-Type: application/json" -d "{}"
hit GET "$BASE/api/partner/me"
hit GET "$BASE/api/partner/me" -H "x-api-key: invalid-key-for-sweep"
hit GET "$BASE/api/partner/sales/summary" -H "x-api-key: invalid-key-for-sweep"
hit GET "$BASE/api/partner/sales/recent" -H "x-api-key: invalid-key-for-sweep"
hit POST "$BASE/api/import/prices/xlsx" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/import/erp/marg" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/import/erp/retailgraph" -H "Content-Type: application/json" -d "{}"

echo "# --- require consumer login (no cookie) ---"
hit GET "$BASE/api/reminders"
hit GET "$BASE/api/profile"
hit GET "$BASE/api/orders"
hit POST "$BASE/api/orders" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/orders/diagnostics" -H "Content-Type: application/json" -d "{}"

echo "# --- OTP session (dummy user) ---"
curl -sS -c "$COOKIEJAR" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"phone\":\"9100946364\"}" "$BASE/api/auth/request-otp" >/dev/null
curl -sS -c "$COOKIEJAR" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"phone\":\"9100946364\",\"code\":\"12345\"}" "$BASE/api/auth/verify-otp" >/dev/null

hit GET "$BASE/api/auth/me" -b "$COOKIEJAR"
hit GET "$BASE/api/reminders" -b "$COOKIEJAR"
hit GET "$BASE/api/profile" -b "$COOKIEJAR"
hit GET "$BASE/api/orders" -b "$COOKIEJAR"
hit GET "$BASE/api/orders/1" -b "$COOKIEJAR"
hit POST "$BASE/api/orders/999999/cancel" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/orders/999999/events" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"status\":\"confirmed\"}"
hit POST "$BASE/api/orders/1/events" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"status\":\"test\"}"
hit PUT "$BASE/api/profile/basic" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"full_name\":\"QA\"}"
hit POST "$BASE/api/profile/addresses" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/profile/payment-methods" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
hit POST "$BASE/api/profile/addresses/999999/default" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
hit DELETE "$BASE/api/profile/addresses/999999" -b "$COOKIEJAR"
hit POST "$BASE/api/profile/payment-methods/999999/default" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
hit DELETE "$BASE/api/profile/payment-methods/999999" -b "$COOKIEJAR"
REM_JSON="{\"medicine_label\":\"api-sweep\",\"remind_at\":\"2099-01-01T12:00:00.000Z\"}"
hit POST "$BASE/api/reminders" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "$REM_JSON"
RID=$(python3 -c "import json;print(json.load(open('/tmp/api_body.txt')).get('reminder',{}).get('id') or '')" 2>/dev/null || true)
if [[ -n "${RID:-}" ]]; then
  hit PATCH "$BASE/api/reminders/$RID" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{\"notes\":\"patched\"}"
  hit POST "$BASE/api/reminders/$RID/bought" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
  hit DELETE "$BASE/api/reminders/$RID" -b "$COOKIEJAR"
fi

echo "# --- logout ---"
hit POST "$BASE/api/auth/logout" -b "$COOKIEJAR" -H "Content-Type: application/json" -d "{}"
