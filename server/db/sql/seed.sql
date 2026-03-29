-- Demo data for India (INR). Replace with real feeds in production.

TRUNCATE sale_items, sales, partner_pharmacies, pharmacy_prices, medicines, pharmacies, cities RESTART IDENTITY CASCADE;

INSERT INTO cities (name, state, slug) VALUES
  ('Mumbai', 'Maharashtra', 'mumbai'),
  ('Bengaluru', 'Karnataka', 'bengaluru'),
  ('New Delhi', 'Delhi', 'new-delhi');

INSERT INTO pharmacies (name, chain, city_id, address_line, pincode, lat, lng) VALUES
  ('Apollo Pharmacy — Bandra', 'Apollo', 1, 'Linking Rd, Bandra West', '400050', 19.0596, 72.8295),
  ('MedPlus — Bandra', 'MedPlus', 1, 'Hill Rd, Bandra West', '400050', 19.0544, 72.8326),
  ('Wellness Forever — Khar', 'Wellness Forever', 1, 'SV Rd, Khar West', '400052', 19.0712, 72.8361),
  ('Apollo Pharmacy — Koramangala', 'Apollo', 2, '80 Feet Rd, Koramangala 4th Block', '560034', 12.9352, 77.6245),
  ('MedPlus — Indiranagar', 'MedPlus', 2, '100 Feet Rd, Indiranagar', '560038', 12.9719, 77.6412),
  ('Netmeds Store — Whitefield', 'Netmeds', 2, 'Whitefield Main Rd', '560066', 12.9698, 77.7499),
  ('Apollo Pharmacy — Connaught Place', 'Apollo', 3, 'Block A, CP', '110001', 28.6315, 77.2167),
  ('MedPlus — Karol Bagh', 'MedPlus', 3, 'Ajmal Khan Rd', '110005', 28.6517, 77.1909);

INSERT INTO medicines (display_name, generic_name, strength, form, pack_size, schedule) VALUES
  ('Metformin 500 mg', 'Metformin hydrochloride', '500 mg', 'tablet', 10, 'H'),
  ('Atorvastatin 20 mg', 'Atorvastatin calcium', '20 mg', 'tablet', 10, 'H'),
  ('Telma 40 (Telmisartan)', 'Telmisartan', '40 mg', 'tablet', 10, 'H'),
  ('Pantoprazole 40 mg', 'Pantoprazole', '40 mg', 'tablet', 10, 'H'),
  ('Amoxicillin 500 mg', 'Amoxicillin', '500 mg', 'capsule', 10, 'H1');

-- Mumbai Metformin: show 30–50% style spread (illustrative)
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (1, 1, 45.00, 120.00, 'retail'),
  (2, 1, 38.50, 120.00, 'retail'),
  (3, 1, 62.00, 120.00, 'retail');

-- Bengaluru Metformin
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (4, 1, 42.00, 120.00, 'retail'),
  (5, 1, 36.75, 120.00, 'retail'),
  (6, 1, 55.00, 120.00, 'retail');

-- Delhi Metformin
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (7, 1, 48.00, 120.00, 'retail'),
  (8, 1, 40.25, 120.00, 'retail');

-- Atorvastatin 20 mg across a few outlets
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (1, 2, 95.00, 350.00, 'retail'),
  (2, 2, 78.00, 350.00, 'retail'),
  (4, 2, 88.00, 350.00, 'retail'),
  (5, 2, 72.50, 350.00, 'retail'),
  (7, 2, 90.00, 350.00, 'retail');

-- Telma 40
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (1, 3, 185.00, 280.00, 'retail'),
  (2, 3, 152.00, 280.00, 'retail'),
  (4, 3, 178.00, 280.00, 'retail');

-- Pantoprazole
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (2, 4, 55.00, 165.00, 'retail'),
  (3, 4, 79.00, 165.00, 'retail'),
  (5, 4, 51.00, 165.00, 'retail');

-- Amoxicillin
INSERT INTO pharmacy_prices (pharmacy_id, medicine_id, price_inr, mrp_inr, price_type) VALUES
  (1, 5, 125.00, 240.00, 'retail'),
  (6, 5, 98.00, 240.00, 'retail'),
  (8, 5, 110.00, 240.00, 'retail');

-- Partner demo: Apollo Bandra (pharmacy_id=1)
INSERT INTO partner_pharmacies (pharmacy_id, display_name, api_key) VALUES
  (1, 'Apollo Bandra (Demo Partner)', 'demo-apollo-bandra-key');

-- Sales demo (last 14 days) with sell + cost for profit calculation
INSERT INTO sales (pharmacy_id, sold_at, channel, customer_ref) VALUES
  (1, now() - interval '1 day', 'walkin', 'INV-1001'),
  (1, now() - interval '2 days', 'walkin', 'INV-1002'),
  (1, now() - interval '5 days', 'phone', 'INV-1003'),
  (1, now() - interval '9 days', 'online', 'INV-1004'),
  (1, now() - interval '13 days', 'walkin', 'INV-1005');

-- Items per sale (unit_sell_inr approximates shelf price; unit_cost_inr is pharmacy purchase cost)
INSERT INTO sale_items (sale_id, medicine_id, quantity, unit_sell_inr, unit_cost_inr) VALUES
  (1, 1, 2, 45.00, 28.00),
  (1, 4, 1, 60.00, 35.00),
  (2, 2, 1, 95.00, 62.00),
  (2, 3, 1, 185.00, 130.00),
  (3, 1, 1, 45.00, 28.00),
  (3, 5, 1, 125.00, 80.00),
  (4, 4, 2, 60.00, 35.00),
  (5, 3, 1, 185.00, 130.00);
