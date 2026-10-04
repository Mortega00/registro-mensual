import {
  CATEGORIES,
  averageCompletedTotalCents,
  completionSummary,
  dateLabel,
  formatMoney,
  formatQuantity,
  groupedProducts,
  makeId,
  monthLabel,
  normalizeQuantity,
  parseMoneyToCents,
  productSubtotalCents,
  purchaseCalculatedTotalCents,
  purchasedProducts
} from "./core.js";

const STORAGE_KEY = "mes-a-mes:data:v1";
const PURCHASE_TYPE_SUGGESTIONS = ["Supermercado", "Carnicería", "Casa", "Ropa", "Farmacia"];
const MONEY_INPUT_NAMES = new Set(["budget", "unitPrice", "totalPaid", "beforeDiscount"]);
const MONEY_TEXT_PATTERN = /^(?:\d+(?:[.,]\d{0,2})?|\d{1,3}(?:\.\d{3})+(?:,\d{0,2})?|\d{1,3}(?:,\d{3})+(?:\.\d{0,2})?)$/;
const QUANTITY_TEXT_PATTERN = /^\d+(?:[.,]\d{0,3})?$/;
const app = document.querySelector("#app");
const importInput = document.querySelector("#import-input");
const toast = document.querySelector("#toast");

let state = loadData();
state.view = "home";
let sheet = null;
let toastTimer;

const iconPaths = {
  home: '<path d="m3 10 9-7 9 7v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 21v-7h6v7"/>',
  list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="m9 18 6-6-6-6"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  pencil: '<path d="m4 20 4.2-1 10.4-10.4a2.1 2.1 0 0 0-3-3L5.2 16 4 20Z"/><path d="m13.8 7.3 3 3"/>',
  bag: '<path d="M6 8h12l1 12H5L6 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/>',
  cart: '<path d="M3 4h2l2.2 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.5L20 8H7"/><circle cx="10" cy="20" r="1"/><circle cx="17" cy="20" r="1"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
  trash: '<path d="M4 7h16M10 11v5M14 11v5M6 7l1 14h10l1-14M9 7V4h6v3"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14"/>',
  upload: '<path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 21h14"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  leaf: '<path d="M20 4C12 4 5 7 5 14c0 3.3 2.6 6 6 6 6 0 9-7 9-16Z"/><path d="M4 20c3-4 6-6 10-8"/>'
};

function icon(name, className = "") {
  return `<svg class="icon ${className}" aria-hidden="true" viewBox="0 0 24 24">${iconPaths[name] || ""}</svg>`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function initialData() {
  return { version: 1, activePurchaseId: null, purchases: [] };
}

function normalizePurchaseType(value) {
  if (typeof value !== "string") return "Supermercado";
  const type = value.trim().slice(0, 60);
  return type || "Supermercado";
}

function suggestedListName(type) {
  const month = new Intl.DateTimeFormat("es-AR", { month: "long" }).format(new Date());
  return `${normalizePurchaseType(type)} ${month}`;
}

function resolveSheetPurchaseType(selectedType, customType) {
  return selectedType === "Otro" ? (String(customType || "").trim() || "Compra") : selectedType;
}

function normalizeProduct(product = {}) {
  return {
    id: typeof product.id === "string" ? product.id : makeId("product"),
    name: typeof product.name === "string" ? product.name : "Producto",
    category: CATEGORIES.includes(product.category) ? product.category : "Otros",
    quantity: normalizeQuantity(product.quantity, 1),
    unitPriceCents: Number.isFinite(product.unitPriceCents) && product.unitPriceCents >= 0
      ? Math.round(product.unitPriceCents)
      : null,
    bought: Boolean(product.bought),
    note: typeof product.note === "string" ? product.note : ""
  };
}

function normalizePurchase(purchase = {}) {
  const status = ["active", "draft", "completed"].includes(purchase.status) ? purchase.status : "draft";
  return {
    id: typeof purchase.id === "string" ? purchase.id : makeId("purchase"),
    name: typeof purchase.name === "string" && purchase.name.trim() ? purchase.name.trim() : "Compra sin nombre",
    // Types used to be a fixed list. Keep legacy values and accept any new human label.
    type: normalizePurchaseType(purchase.type),
    status,
    budgetCents: Number.isFinite(purchase.budgetCents) && purchase.budgetCents >= 0 ? Math.round(purchase.budgetCents) : null,
    products: Array.isArray(purchase.products) ? purchase.products.map(normalizeProduct) : [],
    createdAt: purchase.createdAt || new Date().toISOString(),
    updatedAt: purchase.updatedAt || purchase.createdAt || new Date().toISOString(),
    completedAt: purchase.completedAt || null,
    completion: purchase.completion && typeof purchase.completion === "object" ? {
      totalPaidCents: Number.isFinite(purchase.completion.totalPaidCents) ? Math.round(purchase.completion.totalPaidCents) : null,
      beforeDiscountCents: Number.isFinite(purchase.completion.beforeDiscountCents) ? Math.round(purchase.completion.beforeDiscountCents) : null
    } : null
  };
}

function loadData() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!parsed || !Array.isArray(parsed.purchases)) return initialData();
    const purchases = parsed.purchases.map(normalizePurchase);
    const active = purchases.find((purchase) => purchase.id === parsed.activePurchaseId && purchase.status === "active");
    return { version: 1, activePurchaseId: active?.id || null, purchases };
  } catch {
    return initialData();
  }
}

function persist() {
  try {
    const { view, ...data } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    showToast("No se pudo guardar en este dispositivo.");
  }
}

function activePurchase() {
  return state.purchases.find((purchase) => purchase.id === state.activePurchaseId) || null;
}

function findPurchase(id) {
  return state.purchases.find((purchase) => purchase.id === id) || null;
}

function touch(purchase) {
  purchase.updatedAt = new Date().toISOString();
}

function setView(view) {
  state.view = view;
  sheet = null;
  render();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function formatInputMoney(cents) {
  if (!Number.isFinite(cents)) return "";
  return new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(cents / 100);
}

function sanitizeNumericInput(input) {
  const sanitized = input.value.replace(/[^\d.,]/g, "");
  if (sanitized !== input.value) input.value = sanitized;
}

function readMoneyInput(value, required = false) {
  const text = String(value || "").trim();
  if (!text) return { value: null, empty: true, invalid: required };
  if (!MONEY_TEXT_PATTERN.test(text)) return { value: null, empty: false, invalid: true };
  const cents = parseMoneyToCents(text);
  return { value: cents, empty: false, invalid: !Number.isFinite(cents) || cents < 0 };
}

function readQuantityInput(value) {
  const text = String(value || "").trim();
  if (!QUANTITY_TEXT_PATTERN.test(text)) return null;
  const quantity = Number(text.replace(",", "."));
  if (!Number.isFinite(quantity) || quantity <= 0) return null;
  return normalizeQuantity(quantity, 1);
}

function budgetMarkup(purchase) {
  if (!Number.isFinite(purchase.budgetCents)) {
    return `<div class="mini-stat"><span>${icon("receipt")}</span><strong>Sin presupuesto</strong><span>Podés agregar una referencia</span></div>`;
  }
  return `<div class="mini-stat"><span>${icon("receipt")}</span><strong>${formatMoney(purchase.budgetCents)}</strong><span>Presupuesto orientativo</span></div>`;
}

function activeCard(purchase) {
  const bought = purchasedProducts(purchase.products);
  const progress = purchase.products.length ? Math.round((bought.length / purchase.products.length) * 100) : 0;
  const total = purchaseCalculatedTotalCents(purchase);
  return `
    <article class="active-card">
      <div class="active-card-main">
        <div class="active-meta"><span class="eyebrow">Compra actual</span><span class="tiny">${escapeHtml(monthLabel(purchase.createdAt))}</span></div>
        <p class="purchase-name">${escapeHtml(purchase.name)}</p>
        <p class="total-label">Llevás</p>
        <div class="total-big">${formatMoney(total)}</div>
        <div class="progress-line" aria-label="${bought.length} de ${purchase.products.length} productos comprados"><span style="width:${progress}%"></span></div>
        <p class="subtle">${bought.length} de ${purchase.products.length} productos comprados</p>
      </div>
      <div class="card-footer">
        <button class="secondary-button" type="button" data-action="edit-purchase" aria-label="Editar presupuesto">${icon("pencil")} Ajustar</button>
        <button class="primary-button" type="button" data-view="list">Continuar ${icon("arrow")}</button>
      </div>
    </article>
    <div class="home-meta">
      <div><span>${Number.isFinite(purchase.budgetCents) ? "Presupuesto orientativo" : "Presupuesto"}</span><strong>${Number.isFinite(purchase.budgetCents) ? formatMoney(purchase.budgetCents) : "Sin definir"}</strong></div>
    </div>`;
}

function renderHome() {
  const purchase = activePurchase();
  const completed = completedPurchases();
  const recent = completed.slice(0, 3);
  const average = purchase ? averageCompletedTotalCents(state.purchases, purchase.type) : averageCompletedTotalCents(state.purchases);
  const averageCount = completed.filter((item) => !purchase || item.type === purchase.type).length;
  return `
    <main class="screen">
      <header class="topbar">
        <div><p class="eyebrow">Mes a mes</p><h1>${purchase ? "Hola, ¿seguimos?" : "Tus compras, claras."}</h1></div>
        ${purchase ? `<button class="icon-button" type="button" data-action="new-purchase" aria-label="Nueva compra">${icon("plus")}</button>` : ""}
      </header>
      ${purchase ? activeCard(purchase) : `
        <section class="empty-state">
          <div class="empty-icon">${icon("cart")}</div>
          <h2>Empezá una compra</h2>
          <p>Armá tu lista y anotá precios a medida que recorrés el supermercado.</p>
          <button type="button" class="primary-button" data-action="new-purchase">${icon("plus")} Nueva compra</button>
        </section>`}
      ${average !== null ? `<section class="section"><div class="average-card"><div class="round-icon">${icon("leaf")}</div><div><p>Promedio de ${averageCount} compra${averageCount === 1 ? "" : "s"}${purchase ? " de " + escapeHtml(purchase.type.toLowerCase()) : ""}</p><strong>${formatMoney(average)}</strong></div></div></section>` : ""}
      <section class="section">
        <div class="section-title"><h2>Últimas compras</h2>${completed.length ? `<button class="text-button" type="button" data-view="history">Ver historial</button>` : ""}</div>
        ${recent.length ? `<div class="plain-list">${recent.map(historyRow).join("")}</div>` : `<p class="subtle">Cuando cierres una compra, va a aparecer guardada acá.</p>`}
      </section>
    </main>`;
}

function completedPurchases() {
  return state.purchases
    .filter((purchase) => purchase.status === "completed")
    .sort((a, b) => new Date(b.completedAt || b.updatedAt) - new Date(a.completedAt || a.updatedAt));
}

function historyRow(purchase) {
  const summary = completionSummary(purchase);
  return `<button class="history-row" type="button" data-action="open-details" data-id="${purchase.id}">
    <span><span class="row-title">${escapeHtml(purchase.name)}</span><span class="tiny">${escapeHtml(purchase.type)} · ${dateLabel(purchase.completedAt || purchase.createdAt)}</span></span>
    <span class="row-chevron"><span class="row-value">${formatMoney(summary.totalPaidCents)}</span>${icon("arrow")}</span>
  </button>`;
}

function productRow(product) {
  const priceText = Number.isFinite(product.unitPriceCents)
    ? `x${formatQuantity(product.quantity)} · ${formatMoney(product.unitPriceCents)} c/u`
    : `x${formatQuantity(product.quantity)} · Sin precio`;
  return `<div class="product-row ${product.bought ? "is-bought" : ""}">
    <button type="button" class="check-button" data-action="toggle-product" data-id="${product.id}" aria-label="${product.bought ? "Marcar pendiente" : "Marcar comprado"}">${icon("check")}</button>
    <button type="button" class="product-main" data-action="edit-product" data-id="${product.id}"><span class="product-name">${escapeHtml(product.name)}</span><span class="product-detail">${priceText}</span></button>
    <span class="product-price">${Number.isFinite(product.unitPriceCents) ? formatMoney(productSubtotalCents(product)) : ""}</span>
    <button type="button" class="product-edit" data-action="edit-product" data-id="${product.id}" aria-label="Editar ${escapeHtml(product.name)}">${icon("pencil")}</button>
  </div>`;
}

function renderList() {
  const purchase = activePurchase();
  if (!purchase) {
    return `<main class="screen"><header class="topbar"><div><p class="eyebrow">Lista</p><h1>No hay una compra activa</h1></div></header><section class="list-idle-state"><p>Creá una compra para empezar tu lista.</p><button class="primary-button" type="button" data-action="new-purchase">${icon("plus")} Nueva compra</button></section></main>`;
  }
  const groups = groupedProducts(purchase.products);
  const bought = purchasedProducts(purchase.products);
  const hasNoPrice = bought.filter((product) => !Number.isFinite(product.unitPriceCents)).length;
  return `
    <main class="screen list-screen">
      <header class="topbar"><div><p class="eyebrow">${escapeHtml(purchase.type)}</p><h1>${escapeHtml(purchase.name)}</h1><p class="subtle">${bought.length} de ${purchase.products.length} comprados</p></div>${purchase.products.length ? `<button class="icon-button" type="button" data-action="add-product" aria-label="Agregar producto">${icon("plus")}</button>` : ""}</header>
      ${purchase.products.length ? Object.entries(groups).map(([category, products]) => `<section class="category"><div class="category-heading"><h2>${escapeHtml(category)}</h2><span>${products.length} producto${products.length === 1 ? "" : "s"}</span></div><div class="product-list">${products.map(productRow).join("")}</div></section>`).join("") : `
        <section class="first-product-state"><h2>Tu lista empieza acá</h2><p>Podés cargar los precios cuando los tengas.</p><button class="primary-button" type="button" data-action="add-product">${icon("plus")} Agregar primer producto</button></section>`}
      ${hasNoPrice ? `<div class="helper-note">${icon("info")}<span>Hay ${hasNoPrice} producto${hasNoPrice === 1 ? "" : "s"} comprado${hasNoPrice === 1 ? "" : "s"} sin precio. No suman al total todavía.</span></div>` : ""}
      ${purchase.products.length ? `<div class="list-actions"><button class="secondary-button wide" type="button" data-action="add-product">${icon("plus")} Agregar producto</button></div><div class="list-total"><div><span class="tiny">Total parcial</span><strong>${formatMoney(purchaseCalculatedTotalCents(purchase))}</strong></div><button type="button" class="primary-button" data-action="finish-purchase">Finalizar</button></div>` : ""}
    </main>`;
}

function renderHistory() {
  const completed = completedPurchases();
  const drafts = state.purchases.filter((purchase) => purchase.status === "draft").sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  const average = averageCompletedTotalCents(state.purchases);
  return `
    <main class="screen">
      <header class="topbar"><div><p class="eyebrow">Historial</p><h1>Compras anteriores</h1></div><button class="icon-button" type="button" data-action="new-purchase" aria-label="Nueva compra">${icon("plus")}</button></header>
      ${average !== null ? `<div class="average-card"><div class="round-icon">${icon("receipt")}</div><div><p>Promedio de tus últimas ${completed.length} compras</p><strong>${formatMoney(average)}</strong></div></div>` : ""}
      <section class="section"><div class="section-title"><h2>Compras guardadas</h2><span class="tiny">${completed.length}</span></div>${completed.length ? `<div class="plain-list">${completed.map(historyRow).join("")}</div>` : `<div class="empty-state"><div class="empty-icon">${icon("clock")}</div><h2>Todavía no hay historial</h2><p>Al finalizar una compra, vas a poder verla y reutilizar su lista desde acá.</p></div>`}</section>
      ${drafts.length ? `<section class="section"><div class="section-title"><h2>Listas sin terminar</h2><span class="tiny">${drafts.length}</span></div><div class="plain-list">${drafts.map((purchase) => `<div class="draft-row"><span><span class="row-title">${escapeHtml(purchase.name)}</span><span class="tiny">Actualizada ${dateLabel(purchase.updatedAt)}</span></span><button type="button" class="secondary-button" data-action="resume-draft" data-id="${purchase.id}">Continuar</button></div>`).join("")}</div></section>` : ""}
      <section class="section"><div class="data-card"><h2>Datos y copia de seguridad</h2><p>Tu información se guarda en este dispositivo. Podés descargar una copia o recuperar una anterior cuando quieras.</p><div class="data-actions"><button class="secondary-button" type="button" data-action="export-data">${icon("download")} Exportar copia</button><button class="secondary-button" type="button" data-action="import-data">${icon("upload")} Importar copia</button></div></div></section>
    </main>`;
}

function renderNav() {
  const nav = [["home", "home", "Inicio"], ["list", "list", "Lista"], ["history", "clock", "Historial"]];
  return `<nav class="bottom-nav" aria-label="Navegación principal"><div class="bottom-nav-inner">${nav.map(([view, svg, label]) => `<button type="button" class="nav-item ${state.view === view ? "is-active" : ""}" data-view="${view}">${icon(svg)}<span>${label}</span></button>`).join("")}</div></nav>`;
}

function categoriesOptions(selected) {
  return CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${category === selected ? "selected" : ""}>${escapeHtml(category)}</option>`).join("");
}

function sheetWrapper(title, contents, options = {}) {
  return `<div class="sheet-layer"><button type="button" class="sheet-backdrop" data-action="close-sheet" aria-label="Cerrar"></button><section class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="sheet-grab"></div><header class="sheet-head"><h2 id="sheet-title">${escapeHtml(title)}</h2><button type="button" class="icon-button" data-action="close-sheet" aria-label="Cerrar">${icon("close")}</button></header><div class="sheet-content">${contents}</div></section></div>`;
}

function renderPurchaseSheet() {
  const existing = sheet.purchaseId ? findPurchase(sheet.purchaseId) : null;
  const existingType = normalizePurchaseType(existing?.type);
  const defaultSelection = PURCHASE_TYPE_SUGGESTIONS.includes(existingType) ? existingType : "Otro";
  const selectedType = sheet.selectedType || defaultSelection;
  const customType = sheet.customType ?? (selectedType === "Otro" ? existingType : "");
  const resolvedType = resolveSheetPurchaseType(selectedType, customType);
  const name = sheet.name ?? existing?.name ?? suggestedListName(resolvedType);
  const budget = sheet.budget ?? formatInputMoney(existing?.budgetCents);
  const title = existing ? "Ajustar compra" : "Nueva compra";
  return sheetWrapper(title, `<form id="purchase-form">
    <div class="form-field"><span class="form-label">¿Qué vas a organizar?</span><div class="type-chips" role="group" aria-label="Qué vas a organizar">${PURCHASE_TYPE_SUGGESTIONS.map((type) => `<button type="button" class="type-chip ${selectedType === type ? "is-selected" : ""}" data-action="choose-purchase-type" data-type="${type}" aria-pressed="${selectedType === type}">${type}</button>`).join("")}<button type="button" class="type-chip ${selectedType === "Otro" ? "is-selected" : ""}" data-action="choose-purchase-type" data-type="Otro" aria-pressed="${selectedType === "Otro"}">${icon("plus")} Otro</button></div><input type="hidden" name="type" value="${escapeHtml(selectedType)}" /></div>
    ${selectedType === "Otro" ? `<label class="form-field"><span>¿Cómo querés llamarlo?</span><input name="customType" required maxlength="60" placeholder="Ej. Feria" value="${escapeHtml(customType)}" /></label>` : ""}
    <label class="form-field"><span>Nombre de la lista</span><input name="name" required maxlength="60" placeholder="Ej. Supermercado octubre" value="${escapeHtml(name)}" /></label>
    <label class="form-field"><span>Presupuesto orientativo <span class="muted">(opcional)</span></span><input name="budget" inputmode="decimal" placeholder="Ej. 280.000" value="${escapeHtml(budget)}" /><span class="input-note">Es una referencia, no un límite.</span></label>
    <div class="sheet-actions"><button type="button" class="secondary-button" data-action="close-sheet">Cancelar</button><button type="submit" class="primary-button">${existing ? "Guardar cambios" : "Crear compra"}</button></div>
  </form>`);
}

function renderProductSheet() {
  const purchase = activePurchase();
  const product = sheet.productId ? purchase?.products.find((item) => item.id === sheet.productId) : null;
  const isEditing = Boolean(product);
  const item = product || { name: "", category: "Almacén", quantity: 1, unitPriceCents: null, note: "" };
  const deleteButton = isEditing ? `<button type="button" class="danger-button" data-action="delete-product" data-id="${item.id}">${icon("trash")} Eliminar producto</button>` : "";
  return sheetWrapper(isEditing ? "Editar producto" : "Agregar producto", `<form id="product-form">
    <label class="form-field"><span>Nombre</span><input name="name" required maxlength="80" autofocus placeholder="Ej. Manteca" value="${escapeHtml(item.name)}" /></label>
    <label class="form-field"><span>Categoría</span><select name="category">${categoriesOptions(item.category)}</select></label>
    <div class="form-grid"><div class="form-field"><span class="form-label">Cantidad</span><div class="quantity-control"><button type="button" data-action="change-quantity" data-amount="-1" aria-label="Restar una unidad">−</button><input name="quantity" value="${formatQuantity(item.quantity)}" inputmode="decimal" type="text" /><button type="button" data-action="change-quantity" data-amount="1" aria-label="Sumar una unidad">+</button></div></div><label class="form-field"><span>Precio por unidad</span><input name="unitPrice" inputmode="decimal" placeholder="Ej. 5.500" value="${formatInputMoney(item.unitPriceCents)}" /></label></div>
    <div class="live-subtotal"><span>Subtotal</span><strong id="live-subtotal">${Number.isFinite(item.unitPriceCents) ? formatMoney(productSubtotalCents(item)) : "—"}</strong></div>
    <label class="form-field"><span>Nota <span class="muted">(opcional)</span></span><textarea name="note" maxlength="180" placeholder="Ej. sin sal, marca habitual">${escapeHtml(item.note)}</textarea></label>
    <div class="sheet-actions"><button type="button" class="secondary-button" data-action="close-sheet">Cancelar</button><button type="submit" class="primary-button">Guardar producto</button></div>
    ${isEditing ? `<div style="margin-top:12px">${deleteButton}</div>` : ""}
  </form>`);
}

function signedMoney(cents) {
  return `${cents > 0 ? "+" : cents < 0 ? "−" : ""}${formatMoney(Math.abs(cents))}`;
}

function summaryRows(summary) {
  const discount = summary.beforeDiscountCents !== null ? `<div class="completion-row"><span>${summary.discountCents >= 0 ? "Descuentos" : "Diferencia sobre el precio informado"}</span><strong class="${summary.discountCents >= 0 ? "positive" : "negative"}">${summary.discountCents >= 0 ? "−" : "+"}${formatMoney(Math.abs(summary.discountCents))}</strong></div>` : "";
  return `<div class="completion-row"><span>Diferencia contra lo calculado</span><strong class="${summary.differenceCents > 0 ? "negative" : "positive"}">${signedMoney(summary.differenceCents)}</strong></div>${discount}`;
}

function renderFinishSheet() {
  const purchase = activePurchase();
  const calculated = purchaseCalculatedTotalCents(purchase);
  return sheetWrapper("Finalizar compra", `<form id="finish-form"><div class="completion-number"><p>Total calculado durante la compra</p><strong>${formatMoney(calculated)}</strong></div><label class="form-field"><span>¿Cuánto pagaste finalmente?</span><input name="totalPaid" required inputmode="decimal" placeholder="Ej. 272.810" /><span class="input-note">Este importe será el que aparezca en tu historial.</span></label><label class="form-field"><span>Precio antes de descuentos <span class="muted">(opcional)</span></span><input name="beforeDiscount" inputmode="decimal" placeholder="Ej. 331.400" /><span class="input-note">Si lo ingresás, calculamos cuánto ahorraste.</span></label><div id="finish-preview" class="completion-preview" hidden></div><div class="sheet-actions"><button type="button" class="secondary-button" data-action="close-sheet">Volver</button><button type="submit" class="primary-button">Guardar compra</button></div></form>`);
}

function renderDetailsSheet() {
  const purchase = findPurchase(sheet.purchaseId);
  if (!purchase) return "";
  const summary = completionSummary(purchase);
  const purchased = purchasedProducts(purchase.products);
  return sheetWrapper(purchase.name, `<div class="details-summary"><div class="summary-top"><span>Total pagado</span><strong>${formatMoney(summary.totalPaidCents)}</strong></div><p class="tiny">${escapeHtml(purchase.type)} · ${dateLabel(purchase.completedAt || purchase.createdAt)}</p></div><section class="detail-products"><div class="section-title"><h3>Productos</h3><span class="tiny">${purchased.length} comprados</span></div>${purchase.products.length ? purchase.products.map((product) => `<div class="detail-product"><div><strong>${escapeHtml(product.name)}</strong><span>${escapeHtml(product.category)} · x${formatQuantity(product.quantity)}${Number.isFinite(product.unitPriceCents) ? ` · ${formatMoney(product.unitPriceCents)} c/u` : ""}</span></div><strong>${Number.isFinite(product.unitPriceCents) ? formatMoney(productSubtotalCents(product)) : "—"}</strong></div>`).join("") : `<p class="subtle">No hay productos registrados.</p>`}</section><section class="details-facts"><div class="details-fact"><span>Total calculado</span><strong>${formatMoney(summary.calculatedCents)}</strong></div><div class="details-fact"><span>Diferencia</span><strong class="${summary.differenceCents > 0 ? "negative" : "positive"}">${signedMoney(summary.differenceCents)}</strong></div>${summary.beforeDiscountCents !== null ? `<div class="details-fact"><span>Descuentos</span><strong>${formatMoney(summary.discountCents)}</strong></div><div class="details-fact"><span>Ahorro</span><strong>${summary.savingsPercent.toFixed(1).replace(".", ",")}%</strong></div>` : ""}</section><button type="button" class="primary-button wide" data-action="duplicate-purchase" data-id="${purchase.id}">${icon("list")} Usar esta lista de nuevo</button></div>`);
}

function renderSheet() {
  if (!sheet) return "";
  if (sheet.type === "purchase") return renderPurchaseSheet();
  if (sheet.type === "product") return renderProductSheet();
  if (sheet.type === "finish") return renderFinishSheet();
  if (sheet.type === "details") return renderDetailsSheet();
  return "";
}

function render() {
  const screens = { home: renderHome, list: renderList, history: renderHistory };
  app.innerHTML = `${(screens[state.view] || renderHome)()}${renderNav()}${renderSheet()}`;
}

function openNewPurchase() {
  sheet = { type: "purchase", purchaseId: null, selectedType: "Supermercado", customType: "", name: suggestedListName("Supermercado"), budget: "", nameIsSuggested: true };
  render();
}

function openPurchaseEditor(purchase) {
  const type = normalizePurchaseType(purchase.type);
  const selectedType = PURCHASE_TYPE_SUGGESTIONS.includes(type) ? type : "Otro";
  sheet = {
    type: "purchase",
    purchaseId: purchase.id,
    selectedType,
    customType: selectedType === "Otro" ? type : "",
    name: purchase.name,
    budget: formatInputMoney(purchase.budgetCents),
    nameIsSuggested: purchase.name === suggestedListName(type)
  };
  render();
}

function capturePurchaseDraft() {
  const form = document.querySelector("#purchase-form");
  if (!form) return;
  const selectedType = form.elements.type?.value || sheet.selectedType || "Supermercado";
  const customType = form.elements.customType?.value ?? sheet.customType ?? "";
  const resolvedType = resolveSheetPurchaseType(selectedType, customType);
  sheet.selectedType = selectedType;
  sheet.customType = customType;
  sheet.name = form.elements.name?.value ?? sheet.name ?? "";
  sheet.budget = form.elements.budget?.value ?? sheet.budget ?? "";
  sheet.nameIsSuggested = sheet.name === suggestedListName(resolvedType);
}

function choosePurchaseType(type) {
  capturePurchaseDraft();
  const wasSuggested = Boolean(sheet.nameIsSuggested);
  sheet.selectedType = type;
  const nextType = resolveSheetPurchaseType(type, sheet.customType);
  if (wasSuggested) sheet.name = suggestedListName(nextType);
  sheet.nameIsSuggested = wasSuggested;
  render();
}

function updatePurchaseFormSuggestion(input) {
  if (!input.closest("#purchase-form")) return;
  if (input.name === "name") {
    const currentType = resolveSheetPurchaseType(sheet.selectedType || "Supermercado", sheet.customType);
    sheet.name = input.value;
    sheet.nameIsSuggested = input.value === suggestedListName(currentType);
  }
  if (input.name === "customType") {
    sheet.customType = input.value;
    const nameInput = input.form.elements.name;
    if (sheet.nameIsSuggested && nameInput) {
      nameInput.value = suggestedListName(resolveSheetPurchaseType("Otro", input.value));
      sheet.name = nameInput.value;
    }
  }
}

function submitPurchase(form) {
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const selectedType = String(formData.get("type") || "Supermercado");
  const customType = String(formData.get("customType") || "").trim();
  const type = selectedType === "Otro" ? customType : selectedType;
  const budgetRaw = String(formData.get("budget") || "").trim();
  const budget = readMoneyInput(budgetRaw);
  const budgetCents = budget.value;
  if (!name) return showToast("Escribí un nombre para la compra.");
  if (!type) return showToast("Contanos qué vas a organizar.");
  if (budget.invalid) return showToast("Revisá el presupuesto ingresado.");
  const existing = sheet.purchaseId ? findPurchase(sheet.purchaseId) : null;
  if (existing) {
    existing.name = name;
    existing.type = type;
    existing.budgetCents = budgetCents;
    touch(existing);
    persist();
    sheet = null;
    render();
    showToast("Cambios guardados.");
    return;
  }
  const prior = activePurchase();
  if (prior && prior.products.length && !window.confirm("Tu lista actual quedará guardada como una lista sin terminar. ¿Querés crear otra compra?")) return;
  if (prior) { prior.status = "draft"; touch(prior); }
  const purchase = { id: makeId("purchase"), name, type, status: "active", budgetCents, products: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: null, completion: null };
  state.purchases.push(purchase);
  state.activePurchaseId = purchase.id;
  state.view = "list";
  sheet = null;
  persist();
  render();
  showToast("Compra creada. Agregá el primer producto.");
}

function openProduct(productId = null) {
  if (!activePurchase()) return openNewPurchase();
  sheet = { type: "product", productId };
  render();
}

function submitProduct(form) {
  const purchase = activePurchase();
  if (!purchase) return;
  const formData = new FormData(form);
  const name = String(formData.get("name") || "").trim();
  const quantity = readQuantityInput(formData.get("quantity"));
  const priceRaw = String(formData.get("unitPrice") || "").trim();
  const price = readMoneyInput(priceRaw);
  const unitPriceCents = price.value;
  if (!name) return showToast("Escribí el nombre del producto.");
  if (quantity === null) return showToast("Ingresá una cantidad mayor que cero.");
  if (price.invalid) return showToast("Revisá el precio por unidad.");
  const data = { name, category: String(formData.get("category") || "Otros"), quantity, unitPriceCents, note: String(formData.get("note") || "").trim() };
  const product = sheet.productId ? purchase.products.find((item) => item.id === sheet.productId) : null;
  if (product) Object.assign(product, data);
  else purchase.products.push({ id: makeId("product"), bought: false, ...data });
  touch(purchase);
  persist();
  sheet = null;
  render();
  showToast(product ? "Producto actualizado." : "Producto agregado.");
}

function toggleProduct(productId) {
  const purchase = activePurchase();
  const product = purchase?.products.find((item) => item.id === productId);
  if (!product) return;
  product.bought = !product.bought;
  touch(purchase);
  persist();
  render();
}

function deleteProduct(productId) {
  const purchase = activePurchase();
  const product = purchase?.products.find((item) => item.id === productId);
  if (!purchase || !product) return;
  if (!window.confirm(`¿Eliminar “${product.name}” de la lista?`)) return;
  purchase.products = purchase.products.filter((item) => item.id !== productId);
  touch(purchase);
  persist();
  sheet = null;
  render();
  showToast("Producto eliminado.");
}

function updateProductPreview() {
  const form = document.querySelector("#product-form");
  const target = document.querySelector("#live-subtotal");
  if (!form || !target) return;
  const price = readMoneyInput(form.elements.unitPrice.value);
  const quantity = readQuantityInput(form.elements.quantity.value);
  if (price.value === null || price.invalid || quantity === null) { target.textContent = "—"; return; }
  target.textContent = formatMoney(productSubtotalCents({ quantity, unitPriceCents: price.value }));
}

function changeQuantity(amount) {
  const form = document.querySelector("#product-form");
  if (!form) return;
  const input = form.elements.quantity;
  const current = normalizeQuantity(input.value, 1);
  input.value = String(Math.max(0.001, Math.round((current + amount) * 1000) / 1000)).replace(".", ",");
  updateProductPreview();
}

function updateFinishPreview() {
  const form = document.querySelector("#finish-form");
  const target = document.querySelector("#finish-preview");
  const purchase = activePurchase();
  if (!form || !target || !purchase) return;
  const paid = readMoneyInput(form.elements.totalPaid.value, true);
  const before = readMoneyInput(form.elements.beforeDiscount.value);
  if (paid.invalid || before.invalid || paid.value === null) { target.hidden = true; return; }
  const summary = completionSummary({ ...purchase, completion: { totalPaidCents: paid.value, beforeDiscountCents: before.value } });
  target.innerHTML = summaryRows(summary);
  target.hidden = false;
}

function openFinishPurchase() {
  const purchase = activePurchase();
  if (!purchase?.products.length) return showToast("Agregá al menos un producto antes de finalizar.");
  if (!purchasedProducts(purchase.products).length) return showToast("Marcá al menos un producto como comprado antes de finalizar.");
  sheet = { type: "finish" };
  render();
}

function submitFinish(form) {
  const purchase = activePurchase();
  if (!purchase) return;
  if (!purchase.products.length) return showToast("Agregá al menos un producto antes de finalizar.");
  if (!purchasedProducts(purchase.products).length) return showToast("Marcá al menos un producto como comprado antes de finalizar.");
  const paidRaw = String(new FormData(form).get("totalPaid") || "").trim();
  const beforeRaw = String(new FormData(form).get("beforeDiscount") || "").trim();
  const paid = readMoneyInput(paidRaw, true);
  const before = readMoneyInput(beforeRaw);
  const totalPaidCents = paid.value;
  const beforeDiscountCents = before.value;
  if (paid.empty) return showToast("Ingresá el total que pagaste.");
  if (paid.invalid) return showToast("Revisá el total que pagaste.");
  if (before.invalid) return showToast("Revisá el precio antes de descuentos.");
  if (beforeDiscountCents !== null && beforeDiscountCents < totalPaidCents) return showToast("El precio antes de descuentos no puede ser menor al total pagado.");
  purchase.completion = { totalPaidCents, beforeDiscountCents };
  purchase.status = "completed";
  purchase.completedAt = new Date().toISOString();
  touch(purchase);
  state.activePurchaseId = null;
  state.view = "history";
  sheet = null;
  persist();
  render();
  showToast("Compra guardada en el historial.");
}

function resumeDraft(id) {
  const draft = findPurchase(id);
  if (!draft) return;
  const current = activePurchase();
  if (current && current.id !== draft.id && current.products.length && !window.confirm("La compra actual quedará como lista sin terminar. ¿Querés continuar esta lista?")) return;
  if (current && current.id !== draft.id) { current.status = "draft"; touch(current); }
  draft.status = "active";
  touch(draft);
  state.activePurchaseId = draft.id;
  state.view = "list";
  persist();
  render();
}

function duplicatePurchase(id) {
  const original = findPurchase(id);
  if (!original) return;
  const current = activePurchase();
  if (current && current.products.length && !window.confirm("Tu lista actual quedará guardada sin terminar. ¿Querés usar esta lista de nuevo?")) return;
  if (current) { current.status = "draft"; touch(current); }
  const now = new Date().toISOString();
  const copy = {
    id: makeId("purchase"), name: suggestedListName(original.type), type: original.type, status: "active", budgetCents: original.budgetCents,
    products: original.products.map((product) => ({ ...product, id: makeId("product"), bought: false, unitPriceCents: null })),
    createdAt: now, updatedAt: now, completedAt: null, completion: null
  };
  state.purchases.push(copy);
  state.activePurchaseId = copy.id;
  state.view = "list";
  sheet = null;
  persist();
  render();
  showToast("Lista copiada. Cargá los precios actuales cuando los tengas.");
}

function exportData() {
  const { view, ...data } = state;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `mes-a-mes-copia-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
  showToast("Copia exportada.");
}

async function importData(file) {
  if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    if (!raw || !Array.isArray(raw.purchases)) throw new Error("invalid");
    const next = { version: 1, activePurchaseId: raw.activePurchaseId || null, purchases: raw.purchases };
    state = { ...loadNormalized(next), view: "history" };
    sheet = null;
    persist();
    render();
    showToast("Copia importada correctamente.");
  } catch {
    showToast("No pudimos leer esa copia. Elegí un archivo exportado por Mes a mes.");
  } finally {
    importInput.value = "";
  }
}

function loadNormalized(raw) {
  const purchases = raw.purchases.map(normalizePurchase);
  const active = purchases.find((purchase) => purchase.id === raw.activePurchaseId && purchase.status === "active");
  return { version: 1, activePurchaseId: active?.id || null, purchases };
}

function handleAction(action, button) {
  const id = button.dataset.id;
  if (action === "new-purchase") openNewPurchase();
  if (action === "close-sheet") { sheet = null; render(); }
  if (action === "edit-purchase") { const purchase = activePurchase(); if (purchase) openPurchaseEditor(purchase); }
  if (action === "choose-purchase-type") choosePurchaseType(button.dataset.type);
  if (action === "add-product") openProduct();
  if (action === "edit-product") openProduct(id);
  if (action === "toggle-product") toggleProduct(id);
  if (action === "delete-product") deleteProduct(id);
  if (action === "change-quantity") changeQuantity(Number(button.dataset.amount));
  if (action === "finish-purchase") openFinishPurchase();
  if (action === "open-details") { sheet = { type: "details", purchaseId: id }; render(); }
  if (action === "duplicate-purchase") duplicatePurchase(id);
  if (action === "resume-draft") resumeDraft(id);
  if (action === "export-data") exportData();
  if (action === "import-data") importInput.click();
}

app.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) return setView(viewButton.dataset.view);
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) handleAction(actionButton.dataset.action, actionButton);
});

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "purchase-form") submitPurchase(event.target);
  if (event.target.id === "product-form") submitProduct(event.target);
  if (event.target.id === "finish-form") submitFinish(event.target);
});

app.addEventListener("input", (event) => {
  if (MONEY_INPUT_NAMES.has(event.target.name) || event.target.name === "quantity") sanitizeNumericInput(event.target);
  if (event.target.closest("#purchase-form")) updatePurchaseFormSuggestion(event.target);
  if (event.target.closest("#product-form")) updateProductPreview();
  if (event.target.closest("#finish-form")) updateFinishPreview();
});

importInput.addEventListener("change", (event) => importData(event.target.files?.[0]));

render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
