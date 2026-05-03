import assert from "node:assert/strict";
import test from "node:test";

import { applyGeoToPharmacyOffers, haversineKm, parseUserLatLngFromQuery } from "../server/geo/pharmacyOffersGeo.js";

test("haversineKm is ~0 for identical points", () => {
  assert.ok(haversineKm(19.076, 72.8777, 19.076, 72.8777) < 0.002);
});

test("haversineKm matches known Delhi–Mumbai great-circle (~1150km ±20)", () => {
  const km = haversineKm(28.6139, 77.209, 19.076, 72.8777);
  assert.ok(km > 1130 && km < 1170);
});

test("parseUserLatLngFromQuery accepts lat/lng aliases", () => {
  assert.deepEqual(parseUserLatLngFromQuery({ lat: "12.97", lng: "77.59" }), { lat: 12.97, lng: 77.59 });
  assert.deepEqual(parseUserLatLngFromQuery({ latitude: "1", longitude: "2" }), { lat: 1, lng: 2 });
});

test("applyGeoToPharmacyOffers sorts by distance then price", () => {
  const rows = [
    { pharmacy_id: 1, price_inr: "100", lat: "12.9716", lng: "77.5946", display_name: "A" },
    { pharmacy_id: 2, price_inr: "90", lat: "12.9750", lng: "77.6000", display_name: "B" },
    { pharmacy_id: 3, price_inr: "50", lat: null, lng: null, display_name: "FarCheap" },
  ];
  const { rows: out, geo } = applyGeoToPharmacyOffers(rows, { lat: 12.97, lng: 77.59 }, {});
  assert.equal(geo?.sort, "distance_then_price");
  assert.ok(out[0].pharmacy_id === 1);
  assert.ok(out[1].pharmacy_id === 2);
  assert.ok(out[0].distance_km <= out[1].distance_km);
  assert.equal(out[out.length - 1].distance_km, null);
});
