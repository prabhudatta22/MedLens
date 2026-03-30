-- Demo data for India (INR). Replace with real feeds in production.

TRUNCATE
  sale_items,
  sales,
  partner_pharmacies,
  lab_test_prices,
  lab_tests,
  pharmacy_prices,
  medicines,
  pharmacies,
  cities
RESTART IDENTITY CASCADE;

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

-- Diagnostics / labs (demo)
INSERT INTO lab_tests (heading, sub_heading, category, icon_url, slug, report_tat_hours, home_collection) VALUES
  ('CBC (Complete Blood Count)', 'Contains 21 tests', 'PATHOLOGY', 'https://onemg.gumlet.io/assets/6d2f9d7c-694c-11ec-98c6-0219de0cd346.png', '/labs/test/1717', 7, true),
  ('Thyroid Profile Total (T3, T4 & TSH)', 'Contains 3 tests', 'PATHOLOGY', 'https://onemg.gumlet.io/assets/6d2f9d7c-694c-11ec-98c6-0219de0cd346.png', '/labs/test/thyroid-profile', 7, true),
  ('Lipid Profile', 'Contains 8 tests', 'PATHOLOGY', 'https://onemg.gumlet.io/assets/6d2f9d7c-694c-11ec-98c6-0219de0cd346.png', '/labs/test/lipid-profile', 7, true),
  ('Comprehensive Gold Full Body Checkup', 'Contains 86 tests · Smart Report', 'PATHOLOGY', 'https://onemg.gumlet.io/2026-03%2F1774354424_Labs-Strip.webp', '/labs/package/gold-full-body', 18, true),
  ('Senior Citizen Health Checkup', 'Contains 83 tests · Smart Report', 'PATHOLOGY', 'https://onemg.gumlet.io/2026-03%2F1774354424_Labs-Strip.webp', '/labs/package/senior-citizen', 18, true);

-- Prices vary by city (illustrative). City IDs: 1 Mumbai, 2 Bengaluru, 3 New Delhi
INSERT INTO lab_test_prices (city_id, lab_name, test_id, price_inr, mrp_inr) VALUES
  (1, 'Tata 1mg Labs', 1, 299.00, 350.00),
  (1, 'Tata 1mg Labs', 2, 490.00, 550.00),
  (1, 'Tata 1mg Labs', 3, 399.00, 450.00),
  (1, 'Tata 1mg Labs', 4, 2249.00, 4498.00),
  (1, 'Tata 1mg Labs', 5, 1999.00, 3998.00),
  (2, 'Tata 1mg Labs', 1, 319.00, 350.00),
  (2, 'Tata 1mg Labs', 2, 470.00, 550.00),
  (2, 'Tata 1mg Labs', 3, 389.00, 450.00),
  (2, 'Tata 1mg Labs', 4, 2299.00, 4498.00),
  (2, 'Tata 1mg Labs', 5, 2099.00, 3998.00),
  (3, 'Tata 1mg Labs', 1, 289.00, 350.00),
  (3, 'Tata 1mg Labs', 2, 499.00, 550.00),
  (3, 'Tata 1mg Labs', 3, 419.00, 450.00),
  (3, 'Tata 1mg Labs', 4, 2199.00, 4498.00),
  (3, 'Tata 1mg Labs', 5, 1899.00, 3998.00);
