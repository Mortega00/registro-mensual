export const CATEGORIES = [
  "Almacén",
  "Bebidas",
  "Carnes",
  "Congelados",
  "Frutas y verduras",
  "Higiene y limpieza",
  "Lácteos y huevos",
  "Otros"
];

const moneyFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat("es-AR", {
  maximumFractionDigits: 3
});

export function makeId(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Converts Argentine-style amounts to integer cents, avoiding float drift. */
export function parseMoneyToCents(value) {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) : null;
  if (typeof value !== "string") return null;

  let text = value.trim().replace(/[$\s]/g, "").replace(/[^\d,.-]/g, "");
  if (!text || text === "-" || text === "." || text === ",") return null;
  const negative = text.startsWith("-");
  text = text.replace(/-/g, "");

  const commas = [...text.matchAll(/,/g)].map((match) => match.index);
  const dots = [...text.matchAll(/\./g)].map((match) => match.index);
  const hasComma = commas.length > 0;
  const hasDot = dots.length > 0;
  let normalized;

  if (hasComma && hasDot) {
    const decimalIndex = Math.max(commas.at(-1), dots.at(-1));
    const fraction = text.slice(decimalIndex + 1).replace(/[^\d]/g, "");
    const integer = text.slice(0, decimalIndex).replace(/[^\d]/g, "");
    normalized = `${integer}.${fraction}`;
  } else if (hasComma || hasDot) {
    const separator = hasComma ? "," : ".";
    const pieces = text.split(separator);
    const last = pieces.at(-1).replace(/[^\d]/g, "");
    const integer = pieces.slice(0, -1).join("").replace(/[^\d]/g, "");
    // 5.500 and 5,500 are thousands; 5,50 is a decimal amount.
    normalized = last.length > 0 && last.length <= 2 ? `${integer}.${last}` : `${integer}${last}`;
  } else {
    normalized = text.replace(/[^\d]/g, "");
  }

  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  return Math.round((negative ? -amount : amount) * 100);
}

export function formatMoney(cents, options = {}) {
  const safeCents = clampNumber(cents, 0);
  if (options.blankForNull && (cents === null || cents === undefined || cents === "")) return "—";
  return moneyFormatter.format(safeCents / 100).replace(/\u00a0/g, " ");
}

export function formatQuantity(quantity) {
  return numberFormatter.format(Math.max(0, clampNumber(quantity, 0)));
}

export function normalizeQuantity(value, fallback = 1) {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.round(parsed * 1000) / 1000;
}

export function productSubtotalCents(product) {
  const price = product?.unitPriceCents;
  if (!Number.isFinite(price) || price < 0) return 0;
  return Math.round(normalizeQuantity(product.quantity, 1) * price);
}

export function purchasedProducts(products = []) {
  return products.filter((product) => product.bought);
}

export function purchaseCalculatedTotalCents(purchase) {
  return purchasedProducts(purchase?.products).reduce((sum, product) => sum + productSubtotalCents(product), 0);
}

export function purchaseAllPricedTotalCents(purchase) {
  return (purchase?.products || []).reduce((sum, product) => sum + productSubtotalCents(product), 0);
}

export function completedPurchaseTotalCents(purchase) {
  if (Number.isFinite(purchase?.completion?.totalPaidCents)) return purchase.completion.totalPaidCents;
  return purchaseCalculatedTotalCents(purchase);
}

export function completionSummary(purchase) {
  const calculatedCents = purchaseCalculatedTotalCents(purchase);
  const totalPaidCents = Number.isFinite(purchase?.completion?.totalPaidCents)
    ? purchase.completion.totalPaidCents
    : calculatedCents;
  const beforeDiscountCents = Number.isFinite(purchase?.completion?.beforeDiscountCents)
    ? purchase.completion.beforeDiscountCents
    : null;
  const discountCents = beforeDiscountCents === null ? 0 : beforeDiscountCents - totalPaidCents;
  return {
    calculatedCents,
    totalPaidCents,
    beforeDiscountCents,
    discountCents,
    differenceCents: totalPaidCents - calculatedCents,
    savingsPercent: beforeDiscountCents && beforeDiscountCents > 0
      ? (discountCents / beforeDiscountCents) * 100
      : 0
  };
}

export function averageCompletedTotalCents(purchases = [], type) {
  const completed = purchases.filter((purchase) => purchase.status === "completed" && (!type || purchase.type === type));
  if (!completed.length) return null;
  return Math.round(completed.reduce((sum, purchase) => sum + completedPurchaseTotalCents(purchase), 0) / completed.length);
}

export function groupedProducts(products = []) {
  return products.reduce((groups, product) => {
    const category = product.category || "Otros";
    (groups[category] ||= []).push(product);
    return groups;
  }, {});
}

export function dateLabel(isoDate) {
  if (!isoDate) return "";
  return new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(isoDate));
}

export function monthLabel(isoDate = new Date().toISOString()) {
  const label = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(new Date(isoDate));
  return label.charAt(0).toUpperCase() + label.slice(1);
}
