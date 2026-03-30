# MedLens

“Lens” = clarity, transparency — see the real price before you buy.

India-focused prescription medicine **price comparison** demo: Node.js (Express) + **PostgreSQL** (`pg`). Prices are in **INR**; cities and pharmacy names are sample data.

## Database note

There is no widely documented product called **“Radiant DB”** as a standalone SQL database. This app uses **PostgreSQL** with a standard `DATABASE_URL`. If your provider (e.g. Neon, Supabase, AWS RDS, Aiven, or a Postgres-compatible host) gives you a connection string, paste it into `.env` as `DATABASE_URL`.

## Quick start

1. **PostgreSQL** — local option:

   ```bash
   docker compose up -d
   ```

2. **Environment**

   ```bash
   cp .env.example .env
   # default for docker-compose above:
   # DATABASE_URL=postgresql://medlens:medlens@localhost:5432/medlens
   ```

3. **Install and migrate**

   ```bash
   npm install
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Open **http://localhost:3000** — type a medicine name; the app queries each configured online retailer in parallel and shows matching **demo** pharmacy rows for the selected city.

## Flutter mobile app

Flutter UI lives in `apps/flutter/medlens_app`.

Run it:

```bash
cd apps/flutter/medlens_app
flutter create .
flutter pub get
flutter run
```

- **Backend**: keep `npm run dev` running (default `http://localhost:3000`).
- **Android emulator** uses `http://10.0.2.2:3000` for localhost (default in app Settings).
- **iOS simulator** can use `http://localhost:3000`.
- **Physical device** should use your laptop LAN IP (e.g. `http://192.168.1.10:3000`).

## Browser location (Google address)

The home page can use **the browser’s geolocation** (with your permission) and **Google Geocoding** on the server to fill in a full formatted address, locality, state, PIN, and coordinates. The **city dropdown** is then auto-selected when Google’s locality matches a **seeded demo city** (Mumbai, Bengaluru, New Delhi); you can always override manually.

- Set **`GOOGLE_MAPS_API_KEY`** in `.env` and enable the **Geocoding API** for that key in Google Cloud. The key is used **only on the server** (not exposed to the client).
- If permission was already granted, the app may refresh coordinates on load without a second prompt; otherwise use **Use my location**.
- Address text is cached in **`sessionStorage`** for the tab session.

## WhatsApp prescription intake (scan -> cart)

This app supports receiving a prescription image via **WhatsApp Cloud API** webhook, running OCR, and creating a cart.

### Configure (Meta WhatsApp Cloud API)

- **Webhook URL**: `APP_BASE_URL + /webhook/whatsapp`
- **Verify token**: set `WHATSAPP_VERIFY_TOKEN` in `.env` and use the same value in Meta developer console
- **Access token**: set `WHATSAPP_ACCESS_TOKEN`
- **Phone number ID**: set `WHATSAPP_PHONE_NUMBER_ID`

After setup, a user can send a **photo of the prescription** to your WhatsApp number. The bot replies with a **cart link** like `APP_BASE_URL/cart.html?id=123`.

### Notes

- OCR here uses `tesseract.js` and is best for **printed** text. Handwriting may fail; production setups usually use a Vision/LLM OCR provider.

## Import prices from Excel (.xlsx)

Open `APP_BASE_URL/import.html` and upload an `.xlsx` file in **long format** (one row per pharmacy+medicine+city).

### Required headers

- `city`
- `state`
- `pharmacy_name`
- `drug_name`
- `strength`
- `form`
- `pack_size`
- `price_inr`

### Optional headers

- `chain`, `generic_name`, `address_line`, `pincode`, `lat`, `lng`, `mrp_inr`, `price_type`, `in_stock`

### API

- `POST /api/import/prices/xlsx` (multipart form-data, file field name `file`)

## Partner pharmacy dashboard (sales + profit)

Open `APP_BASE_URL/partner.html`.

### Demo login

Seed data creates a demo partner API key:

- API key: `demo-apollo-bandra-key`

### Partner API

All partner endpoints require header `x-api-key: <key>`.

- `GET /api/partner/me`
- `GET /api/partner/sales/summary?from=YYYY-MM-DD&to=YYYY-MM-DD`
- `GET /api/partner/sales/recent`

## User login (mobile OTP)

Open `APP_BASE_URL/login.html`.

### API

- `POST /api/auth/request-otp` `{ phone }`
- `POST /api/auth/verify-otp` `{ phone, code }` (sets `sid` cookie)
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Dev note

If `NODE_ENV` is not `production`, the API returns the OTP as `dev_otp` to make local testing easy. In production, plug in an SMS provider and never return OTPs in responses.

## Online pharmacy comparison (parallel)

The home page calls `GET /api/online/compare`, which requests **MedPlus Mart**, **Apollo Pharmacy**, **Netmeds**, **Tata 1mg**, and **Medkart** **in parallel**.

### Sanctioned partner APIs (real prices)

These brands do **not** publish a single anonymous public JSON API for third-party price aggregation. **MedLens integrates each retailer only through HTTP endpoints you obtain under contract** (base URL, path, auth header, JSON shape).

Implementation:

- `server/integrations/partners/partnerEnv.js` — env → HTTP config per retailer  
- `server/integrations/partners/fetchPartnerSearch.js` — authenticated `GET`/`POST` + JSON parse  
- `server/integrations/partners/parseOfferJson.js` — best-effort extraction of `price` / `mrp`-like fields from partner JSON (extend per contract if needed)

**Environment variables** (see `.env.example`): for each prefix `MEDPLUS`, `APOLLO`, `NETMEDS`, `ONE_MG`, `MEDKART`:

- `{PREFIX}_PARTNER_API_BASE` — required to enable live calls for that retailer  
- `{PREFIX}_PARTNER_BEARER_TOKEN` **or** `{PREFIX}_PARTNER_API_KEY` (+ optional `{PREFIX}_PARTNER_API_KEY_HEADER`)  
- Optional: `{PREFIX}_PARTNER_SEARCH_PATH`, `{PREFIX}_PARTNER_SEARCH_METHOD`, `{PREFIX}_PARTNER_QUERY_PARAM`, `{PREFIX}_PARTNER_POST_BODY_TEMPLATE`, `{PREFIX}_PARTNER_EXTRA_HEADERS_JSON`

**Tata 1mg** publishes merchant integration docs (search, SKU, orders) on **Onedoc** — start here: [TATA 1mg merchant API docs](https://onedoc.1mg.com/public_docs/docs/merchant/1.0.0). You will receive base URLs, auth (e.g. JWT/Bearer), and response schemas from their onboarding team.

**Other retailers**: obtain equivalent **B2B / affiliate / catalog API** documentation from MedPlus, Apollo, Netmeds, and Medkart business teams and map the same env vars to those endpoints.

### MedPlus Mart — optional consumer catalog search

If you do **not** set `MEDPLUS_PARTNER_API_BASE`, you can still enable live MedPlus rows by setting **`MEDPLUS_CATALOG_TOKEN_ID`**. The server calls the same **`getProductSearch`** endpoint the website uses:

- Query param **`searchCriteria`**: JSON whose `searchQuery` is **base64** of **`A::` + plain text** (e.g. `A::dolo` → `QTo6ZG9sbw==`).
- Params **`tokenId`** and **`timeStapm`** (that spelling) are required; copy **`tokenId`** from browser DevTools → Network on [medplusmart.com](https://www.medplusmart.com/) when a search runs. Tokens can **expire**; if you see HTML/403 or parse errors, refresh the token.

Implementation: `server/integrations/medplusCatalog.js`. The UI uses **`packSizeMrp`** from the best title match as the listed **MRP** (and shown price). **`MEDPLUS_PARTNER_*` still wins** if both are set.

### Apollo Pharmacy — optional consumer search

Set **`APOLLO_CATALOG_AUTHORIZATION`** to the `Authorization` header value from DevTools for **`https://search.apollo247.com/v4/search`** (the site often sends a plain token, not `Bearer …`). Optional **`APOLLO_CATALOG_PINCODE`** (default `400001`) is sent as `pincode` so it is never the string `undefined`. Each server request sends a fresh **`x-unique-session-id`** (UUID). Parser: `data.productDetails.products[]` — **`specialPrice`** as selling price, **`price`** as MRP when present. Code: `server/integrations/apolloCatalog.js`. **`APOLLO_PARTNER_*` takes precedence** if set.

### Netmeds — optional consumer search

Set **`NETMEDS_CATALOG_BEARER`** to the bearer token (without the `Bearer ` prefix) or **`NETMEDS_CATALOG_AUTHORIZATION`** to the full value (with `Bearer ` if required). Optional **`NETMEDS_CATALOG_LOCATION_JSON`** is sent as **`x-location-detail`** (defaults to a Delhi pincode if unset). The browser uses **`x-fp-signature`** and cookies in some cases; MedLens only sends Bearer + location + Referer — if Netmeds returns errors, capture newer headers in DevTools or use **`NETMEDS_PARTNER_*`** instead. Parser: first page **`items[]`** — **`price.effective.min`** and **`price.marked.min`**. Code: `server/integrations/netmedsCatalog.js`.

### Dev-only illustrative fallback

If no partner env is set, that row returns `data_mode: "unconfigured"` (no fabricated price). For local UI demos only:

```bash
ONLINE_USE_ILLUSTRATIVE_FALLBACK=true
```

### Checkout

Pick a retailer, then **Continue on selected site** — opens the retailer’s **consumer search** URL (deeplink) so the user completes purchase on their site.

Retailer sites: [MedPlus Mart](https://www.medplusmart.com/), [Apollo Pharmacy](https://www.apollopharmacy.in/), [Netmeds](https://www.netmeds.com/), [1mg](https://www.1mg.com/), [Medkart](https://www.medkart.in/).

### API

- `GET /api/online/compare?medicineId=1` or `GET /api/online/compare?q=metformin`

## Multi-pharmacy checkout

Open **`/checkout.html`** (header **Cart** or footer **Multi checkout** on the home page). Use **Add** on local pharmacy rows or online retailer rows to build one cart across multiple destinations. The cart lives in the browser (**`localStorage`** only); MedLens does **not** take payment—you complete each purchase on the pharmacy or retailer site. **Open all checkouts** opens tabs in a short stagger; some browsers block many pop-ups at once, so use per-row **Open** links if needed.

## Home search (live)

The home page does **not** require picking a medicine from a database list first. After you type at least two characters (debounced), the UI calls **`GET /api/online/compare?q=...`** so each integrated retailer is queried in parallel with your search text, and **`GET /api/compare/search?q=...&city=...`** for matching rows in the PostgreSQL demo inventory. Configure partner env vars (or `ONLINE_USE_ILLUSTRATIVE_FALLBACK=true` for demo prices). Physical pharmacies only appear when they exist in your seeded data for that city.

## Purchase reminders (refill / buy again)

Open `APP_BASE_URL/reminders.html` while logged in. You can set a **next reminder date**, optional **repeat interval** (e.g. every 30 days), and notes. **Bought** moves the next reminder forward by the repeat interval (or 30 days if unset).

### API (requires `sid` session cookie)

- `GET /api/reminders`
- `POST /api/reminders` `{ medicine_label, remind_at, medicine_id?, repeat_interval_days?, notes? }`
- `PATCH /api/reminders/:id`
- `DELETE /api/reminders/:id`
- `POST /api/reminders/:id/bought` — schedule next reminder after a purchase/refill

## API

- `GET /api/health` — app + DB check  
- `GET /api/cities` — cities (India demo)  
- `GET /api/geocode/reverse?lat=&lng=` — Google reverse geocode + best match to a demo city (requires `GOOGLE_MAPS_API_KEY`)  
- `GET /api/medicines/search?q=metformin` — medicine search  
- `GET /api/compare?medicineId=1&city=mumbai` — ranked prices for one medicine in that city  
- `GET /api/compare/search?q=metformin&city=mumbai` — realtime local match (name/generic contains `q`, demo DB)  
- `GET /api/carts/:id` — cart + extracted items  
- `GET/POST/PATCH/DELETE /api/reminders` — purchase reminders (logged-in users)  

## Author

Prabhudatta Choudhury

## Screenshots

<img width="1440" height="1102" alt="image" src="https://github.com/user-attachments/assets/d3117eb5-9096-478f-8534-aece1a28c85f" />

<img width="1440" height="1224" alt="image" src="https://github.com/user-attachments/assets/c900b0bf-0d1a-4f89-8823-6d368d8b7fc5" />

<img width="1440" height="1130" alt="image" src="https://github.com/user-attachments/assets/5547a898-467b-4624-b40b-038cef0e0955" />

