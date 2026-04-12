# MedLens

https://medlens-h4ym.onrender.com/

“Lens” = clarity, transparency — see the real price before you buy.

India-focused prescription medicine **price comparison** demo: Node.js (Express) + **PostgreSQL** (`pg`). Prices are in **INR**; cities and pharmacy names are sample data.

## Database note

There is no widely documented product called **“Radiant DB”** as a standalone SQL database. This app uses **PostgreSQL** with a standard `DATABASE_URL`. If your provider (e.g. Neon, Supabase, AWS RDS, Aiven, or a Postgres-compatible host) gives you a connection string, paste it into `.env` as `DATABASE_URL`.

## Quick start

1. **PostgreSQL (Docker)**

Install Docker Desktop, then start Postgres via Compose:

   ```bash
   npm run db:up
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

   **Schema** is defined in `server/db/sql/schema.sql` (applied by `db:migrate`). **Seed demo rows** are in `server/db/sql/seed.sql` (`db:seed`).

   **Full bundled data** (everything in the repo snapshot, including the large Excel import) is in `server/db/sql/postgres_data.sql`. Load it on a **fresh** database after migrate—**do not** run `db:seed` first, or primary keys will collide:

   ```bash
   npm run db:migrate
   npm run db:load-full-data
   ```

   To reproduce the spreadsheet import from your own file instead: `npm run db:import-dataset` (see `server/scripts/import-medlens-dataset.js`).

4. Open **http://localhost:3000** — type a medicine name; the app queries each configured online retailer in parallel and shows matching **demo** pharmacy rows for the selected city.

## Importing ERP exports (Marg / RetailGraph)

MedLens supports ingesting common **ERP export files** (CSV/XLSX) from retail pharmacy systems like **Marg** and **RetailGraph**.

- **Endpoints**:
  - `POST /api/import/erp/marg`
  - `POST /api/import/erp/retailgraph`
- **Form fields (required)**: `city`, `state`, `pharmacy_name`
- **Optional**: `pincode`, `chain`, `address_line`, `lat`, `lng`
- **File field**: `file` (CSV or XLSX)

Example (Marg):

```bash
curl -X POST "http://localhost:3000/api/import/erp/marg" \
  -F "city=Hyderabad" \
  -F "state=Telangana" \
  -F "pharmacy_name=My Pharmacy (Ameerpet)" \
  -F "pincode=500016" \
  -F "file=@/path/to/marg-export.xlsx"
```

Header mapping is **auto-detected**. Typical columns that work well include: `Item Name`, `MRP`, `Sale Rate` (or `Rate`), and optionally `Qty/Stock` or `Availability`.

### DB troubleshooting

- **Reset local DB** (drops Docker volume data):

```bash
npm run db:reset
npm run db:migrate
npm run db:seed
```

- **Connection is “refused”**: wait ~3–10 seconds after `db:up`, or check `docker ps` to confirm Postgres is running on `localhost:5432`.
- **Wrong credentials**: ensure `.env` has `DATABASE_URL=postgresql://medlens:medlens@localhost:5432/medlens`.

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

## AI enhancements (search, OCR, suggestions)

MedLens includes a few **AI-assisted** features designed to improve search quality and reduce manual typing. All of them are implemented with **safe fallbacks** (so the app still works without any AI API key).

### 1) Query normalization (optional OpenAI)

The home page can “clean up” queries before searching (spacing, units, common abbreviations).

- **Endpoint**: `GET /api/normalize?q=<query>`
- **Behavior**:
  - Always applies **rules** normalization
  - If `OPENAI_API_KEY` is set, it will also attempt an **OpenAI** normalization step

Environment variables:

- `OPENAI_API_KEY` (optional)
- `OPENAI_MODEL` (optional; default: `gpt-4o-mini`)

Implementation: `server/ai/normalize.js` + `public/app.js` integration.

### 2) Prescription / bill upload → OCR → DB matching (printed text)

The app can OCR a **printed** prescription/bill image and suggest likely matches from the database.

- **Medicines OCR endpoint**: `POST /api/prescription/ocr` (multipart form-data, file field name `file`)
  - Returns `{ ok, text, matches }` where `matches[]` are best matches from `medicines`
  - UI: home page upload control (click **Extract medicines**)
  - To **keep the same file** for checkout and orders, use **Saved prescriptions** (`/api/prescriptions` and Profile / Checkout UI) below.

- **Diagnostics OCR endpoint**: `POST /api/labs/prescription/ocr?city=<citySlug>` (multipart form-data, file field name `file`)
  - Returns `{ ok, text, matches }` where `matches[]` are best matches from `lab_tests` (+ prices for that city)
  - UI: diagnostics page upload control (click **Extract tests**)

Notes:

- OCR uses `tesseract.js` and is best for **printed** text. For handwriting, you typically need a Vision model provider.
- Matching uses **Postgres `pg_trgm`** similarity (`search_vector` + `%` operator).

Implementation:

- OCR: `server/ocr/ocr.js`
- Medicine matcher: `server/prescription/parse.js`
- Diagnostics matcher: `server/labs/parse.js`

### 3) Diagnostics “intent hints”

Diagnostics search shows quick intent chips (e.g. Thyroid/CBC/Lipid) for common keywords.

- **Endpoint**: `GET /api/labs/intent?q=<query>&city=<citySlug>`
- **Output**: `{ intents: [...], suggestions: [...] }`

### 3.1) MedLens ↔ Healthians request/response contract map

This section is a compact handoff map for diagnostics partner integration.

| MedLens endpoint | Healthians endpoint(s) | Key request mapping (MedLens -> Healthians) | Key response mapping (Healthians -> MedLens) |
| --- | --- | --- | --- |
| `GET /api/labs/search` | `/<partner>/getPartnerProducts` | `q, city, category, pincode` -> `zipcode, test_type(pathology/radiology), start, limit, client_id` | Normalized `items[]`: `package_id/deal_id, heading, sub_heading, category, price_inr, mrp_inr, report_tat_hours, home_collection, lab_name` |
| `GET /api/labs/package/:packageId` | `/<partner>/getPartnerProducts` (lookup by id) | `packageId, city, pincode` -> fetch partner products and match by `package_id/deal_id/product_type_id` | Single normalized `item` (same shape as diagnostics search row) |
| `POST /api/orders/diagnostics` | `/<partner>/getAccessToken` -> `/<partner>/checkServiceabilityByLocation_v2` -> `/<partner>/getSlotsByLocation` -> `/<partner>/freezeSlot_v1` -> `/<partner>/createBooking_v3` | MedLens body `packages[], scheduled_for, payment_type, patient, address` -> Healthians booking payload `customer[], slot.slot_id, package:[{deal_id:[...]}], payment_option, discounted_price, vendor_booking_id, vendor_billing_user_id, zipcode/lat/long/zone_id`; optional `X-Checksum` header | Partner booking mapped to MedLens order metadata: `booking_ref, slot, freeze_ref, zone_id, provider_response`; stored as `provider_order_ref/provider_payload` |
| `GET /api/orders/:id` (diagnostics orders) | `/<partner>/getBookingStatus` | `provider_order_ref` -> `{ booking_id }` | `partner_status`: `booking_id, booking_status, customer[], raw` |

Shared auth/config notes:

- Auth call uses Basic Auth with `DIAG_B2B_API_KEY` + `DIAG_B2B_API_SECRET`.
- Subsequent partner calls use `Authorization: Bearer <token>`.
- Endpoint paths are env-configurable via `DIAG_B2B_*_PATH` and prefixed by `DIAG_B2B_PARTNER_NAME`.
- Integration is toggled by `DIAG_B2B_ENABLED=true`.

### 4) Import anomaly warnings (data quality)

Price uploads now include **warnings** for suspicious rows (e.g. price > MRP, huge discount, unusually high price).

- Affects:
  - `POST /api/import/prices/xlsx`
  - `POST /api/import/erp/marg`
  - `POST /api/import/erp/retailgraph`
- Response includes `summary.warnings[]` (non-fatal)

### 5) Lightweight personalization (no medical claims)

The UI stores **recent searches** locally (in the browser) and surfaces them as quick chips.

- Medicines: `localStorage` key `medlens_recent_searches_v1`
- Diagnostics: `localStorage` key `medlens_recent_lab_searches_v1`

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
- If the sender’s WhatsApp number matches a logged-in user’s **India mobile** (last 10 digits vs `users.phone_e164`), the image is also **saved** to that account as a stored prescription and linked on the created cart (`carts.prescription_id`). The reply mentions this when applicable.

## Saved prescriptions (account, checkout, orders)

MedLens keeps **uploaded prescription files** on the user’s account for **checkout**, **order fulfilment** (pharmacy verification), and **future reference**. This complements the **OCR-only** flows above (`POST /api/prescription/ocr` does not persist the file by itself).

### Behaviour

- **Profile** (`/profile.html` → *Saved prescriptions*): upload a **photo or PDF** (camera-friendly on mobile). List, **View**, or **Delete** (delete is blocked if a row is still linked to an order).
- **Checkout** (`/checkout.html`): when logged in, a **Prescription** panel lists saved files, supports a **new upload**, shows a **preview** (or PDF link), and attaches the selected file to **home delivery** (`POST /api/orders`) and **diagnostics** (`POST /api/orders/diagnostics`, including prepaid payloads). The last choice is remembered in the browser as `localStorage` key `medlens_checkout_prescription_id`.
- **Order detail** (`/order.html?id=…`): if the order has a linked prescription, a **View** link appears (same authenticated file endpoint).
- **Storage**: files live under **`uploads/prescriptions/<userId>/`** on the server; the directory is **gitignored** (`uploads/` in `.gitignore`). Run **`npm run db:migrate`** so `user_prescriptions` and `orders.prescription_id` / `carts.prescription_id` exist.

### API (requires consumer `sid` session cookie)

- `GET /api/prescriptions` — list metadata for the current user  
- `POST /api/prescriptions` — multipart **form-data**, field name **`file`** (JPEG, PNG, WebP, or PDF; max 10 MB). Optional form field **`ocr_preview`** (short text). Returns `{ prescription: { id, … } }`.  
- `GET /api/prescriptions/:id/file` — download / inline view (owner only)  
- `DELETE /api/prescriptions/:id` — remove file and row if **no order** references it (`409` otherwise)  

**Orders**

- `POST /api/orders` — optional JSON **`prescription_id`** (must belong to the user); stored on the order.  
- `POST /api/orders/diagnostics` — optional **`prescription_id`** (same rule).  
- `GET /api/orders/:id` — includes joined fields when present: `prescription_file_id`, `prescription_filename`, `prescription_mime`, `prescription_uploaded_at`.

Schema: `user_prescriptions` plus FKs from `orders` and `carts` — see `server/db/sql/schema.sql` and `server/routes/orders.js` (`ensureOrdersSchema`). Implementation: `server/routes/prescriptions.js`, `server/prescriptions/store.js`, `server/prescriptions/schema.js`.

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

When you are logged in, the **Prescription** section on checkout lets you attach a **saved or newly uploaded** prescription to **MedLens home delivery** and **diagnostics** orders (see **Saved prescriptions** above).

## Home search (live)

The home page does **not** require picking a medicine from a database list first. After you type at least two characters (debounced), the UI calls **`GET /api/online/compare?q=...`** so each integrated retailer is queried in parallel with your search text, and **`GET /api/compare/search?q=...&city=...`** for matching rows in the PostgreSQL demo inventory. Configure partner env vars (or `ONLINE_USE_ILLUSTRATIVE_FALLBACK=true` for demo prices). Physical pharmacies only appear when they exist in your seeded data for that city.

### Pilot DB compare flow (home page)

The home page also loads **pilot database** rows in parallel: **`GET /api/compare/by-pincode`** (optional 6-digit PIN + city → “Online retailers” table) and **`GET /api/compare/search`** (city → “Nearby pharmacies” table). The client may optionally call **`GET /api/normalize`** first to tidy the query string.

```mermaid
sequenceDiagram
  participant U as User
  participant UI as public/app.js
  participant N as GET /api/normalize
  participant P as GET /api/compare/by-pincode
  participant L as GET /api/compare/search
  participant DB as PostgreSQL

  U->>UI: type medicine + city (+ PIN)
  UI->>N: optional normalize
  N-->>UI: normalized query (maybe)
  par Pilot DB online panel
    UI->>P: q, city, pincode?
    P->>DB: pharmacy_prices + pharmacies + cities + medicines
    DB-->>P: offers
    P-->>UI: JSON source=db
  and Local pharmacies panel
    UI->>L: q, city
    L->>DB: same joins, city slug only
    DB-->>L: offers
    L-->>UI: JSON
  end
  UI->>U: render online + local tables
```

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
- `GET/POST/DELETE /api/prescriptions` and `GET /api/prescriptions/:id/file` — saved prescription files for checkout and orders (logged-in **consumer** users; see **Saved prescriptions**)  

## Author

Prabhudatta Choudhury

## Screenshots

<img width="1440" height="1102" alt="image" src="https://github.com/user-attachments/assets/d3117eb5-9096-478f-8534-aece1a28c85f" />

<img width="1440" height="1224" alt="image" src="https://github.com/user-attachments/assets/c900b0bf-0d1a-4f89-8823-6d368d8b7fc5" />

<img width="1440" height="1130" alt="image" src="https://github.com/user-attachments/assets/5547a898-467b-4624-b40b-038cef0e0955" />

