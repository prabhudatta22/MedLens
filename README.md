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

4. Open **http://localhost:3000** — search a medicine, pick a city, compare listed prices.

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
- `GET /api/medicines/search?q=metformin` — medicine search  
- `GET /api/compare?medicineId=1&city=mumbai` — ranked prices for that city  
- `GET /api/carts/:id` — cart + extracted items  
- `GET/POST/PATCH/DELETE /api/reminders` — purchase reminders (logged-in users)  

## Author

Prabhudatta Choudhury

## Screenshots

<img width="1440" height="1102" alt="image" src="https://github.com/user-attachments/assets/d3117eb5-9096-478f-8534-aece1a28c85f" />

<img width="1440" height="1224" alt="image" src="https://github.com/user-attachments/assets/c900b0bf-0d1a-4f89-8823-6d368d8b7fc5" />

<img width="1440" height="1130" alt="image" src="https://github.com/user-attachments/assets/5547a898-467b-4624-b40b-038cef0e0955" />

