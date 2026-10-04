import test from "node:test";
import assert from "node:assert/strict";
import {
  averageCompletedTotalCents,
  completionSummary,
  parseMoneyToCents,
  productSubtotalCents,
  purchaseCalculatedTotalCents
} from "./core.js";

test("accepts common Argentine money input without formatted strings", () => {
  assert.equal(parseMoneyToCents("5500"), 550000);
  assert.equal(parseMoneyToCents("5.500"), 550000);
  assert.equal(parseMoneyToCents("$5.500,50"), 550050);
  assert.equal(parseMoneyToCents("12,75"), 1275);
  assert.equal(parseMoneyToCents(""), null);
});

test("subtotal and accumulated total are calculated only from purchased products", () => {
  const purchase = {
    products: [
      { quantity: 3, unitPriceCents: 550000, bought: true },
      { quantity: 2, unitPriceCents: 400000, bought: true },
      { quantity: 1, unitPriceCents: null, bought: false }
    ]
  };
  assert.equal(productSubtotalCents(purchase.products[0]), 1650000);
  assert.equal(purchaseCalculatedTotalCents(purchase), 2450000);
});

test("completion handles differences, discounts and average without NaN", () => {
  const completed = {
    status: "completed",
    products: [{ quantity: 2, unitPriceCents: 100000, bought: true }],
    completion: { totalPaidCents: 180000, beforeDiscountCents: 225000 }
  };
  const summary = completionSummary(completed);
  assert.equal(summary.differenceCents, -20000);
  assert.equal(summary.discountCents, 45000);
  assert.equal(Math.round(summary.savingsPercent), 20);
  assert.equal(averageCompletedTotalCents([completed]), 180000);
});

test("supports zero prices, cleared prices and decimal quantities without visible drift", () => {
  assert.equal(productSubtotalCents({ quantity: 3, unitPriceCents: 0 }), 0);
  assert.equal(productSubtotalCents({ quantity: 3, unitPriceCents: null }), 0);
  assert.equal(productSubtotalCents({ quantity: 2.5, unitPriceCents: 19999 }), 49998);
});
