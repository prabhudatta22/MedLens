import assert from "node:assert/strict";
import test from "node:test";
import { extractReportUrlsFromCustomerReportData } from "../server/integrations/diagnosticsPartner.js";

test("extractReportUrls collects https URLs from nested and flat shapes", () => {
  const u = "https://cdn.example.com/r1.pdf";
  assert.deepEqual(
    extractReportUrlsFromCustomerReportData({
      report_url: u,
    }),
    [u],
  );
  assert.deepEqual(
    extractReportUrlsFromCustomerReportData({
      data: { report_url: u, cgm_report_url: "https://cdn.example.com/cgm.pdf" },
    }),
    [u, "https://cdn.example.com/cgm.pdf"],
  );
});

test("extractReportUrls ignores non-https and empty strings", () => {
  assert.deepEqual(
    extractReportUrlsFromCustomerReportData({
      report_url: "http://insecure.example.com/x.pdf",
    }),
    [],
  );
  assert.deepEqual(extractReportUrlsFromCustomerReportData({ report_url: "" }), []);
});
