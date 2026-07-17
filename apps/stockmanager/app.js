const API_URL = "/api/stock";
const SAVE_DELAY_MS = 350;
const EXPIRY_CHOICES = ["", "Infini", "6 mois", "1 année", "2 ans", "10 ans"];
const CONTROL_MAX_AGE_MONTHS = 1;

const elements = {
  stockSummary: document.querySelector("#stockSummary"),
  saveStatus: document.querySelector("#saveStatus"),
  searchInput: document.querySelector("#searchInput"),
  categoryFilter: document.querySelector("#categoryFilter"),
  addItemButton: document.querySelector("#addItemButton"),
  addCategoryButton: document.querySelector("#addCategoryButton"),
  itemsBody: document.querySelector("#itemsBody"),
  emptyState: document.querySelector("#emptyState"),
  shoppingList: document.querySelector("#shoppingList"),
  printListButton: document.querySelector("#printListButton"),
  printShoppingList: document.querySelector("#printShoppingList"),
  printStatus: document.querySelector("#printStatus"),
  categoryEditor: document.querySelector("#categoryEditor"),
  itemDialog: document.querySelector("#itemDialog"),
  itemForm: document.querySelector("#itemForm"),
  newItemCategory: document.querySelector("#newItemCategory"),
  newItemName: document.querySelector("#newItemName"),
  newItemExpiry: document.querySelector("#newItemExpiry"),
  newItemTarget: document.querySelector("#newItemTarget"),
  newItemCurrent: document.querySelector("#newItemCurrent"),
  closeItemDialogButton: document.querySelector("#closeItemDialogButton"),
  cancelItemButton: document.querySelector("#cancelItemButton")
};

let stock = {
  version: 1,
  categories: [],
  items: []
};
let saveTimer = null;
let isSaving = false;
let needsSave = false;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function slugify(value) {
  const clean = String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return clean || "element";
}

function uniqueId(base, existingIds) {
  const root = slugify(base);
  let candidate = root;
  let suffix = 2;

  while (existingIds.has(candidate)) {
    candidate = `${root}-${suffix}`;
    suffix += 1;
  }

  return candidate;
}

function toQuantity(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.floor(number));
}

function todayIsoDate() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function parseIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatIsoDate(value) {
  const date = parseIsoDate(value);
  if (!date) {
    return "";
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function isRecentlyControlled(value) {
  const controlDate = parseIsoDate(value);
  if (!controlDate) {
    return false;
  }

  const expiryDate = new Date(controlDate);
  expiryDate.setMonth(expiryDate.getMonth() + CONTROL_MAX_AGE_MONTHS);
  return parseIsoDate(todayIsoDate()) <= expiryDate;
}

function controlHtml(value) {
  const formattedDate = formatIsoDate(value);
  if (!formattedDate) {
    return `<span class="control-needed">À vérifier</span>`;
  }

  if (isRecentlyControlled(value)) {
    return `
      <span class="control-check" title="Contrôlé récemment" aria-label="Contrôlé récemment">✓</span>
      <span class="control-date">${formattedDate}</span>
    `;
  }

  return `<span class="control-date is-stale">${formattedDate}</span>`;
}

function markItemControlled(item) {
  item.lastControl = todayIsoDate();
}

function categoryById(id) {
  return stock.categories.find(category => category.id === id);
}

function itemById(id) {
  return stock.items.find(item => item.id === id);
}

function setStatus(text, state = "") {
  elements.saveStatus.textContent = text;
  elements.saveStatus.dataset.state = state;
}

function sortedItems() {
  const categoryRank = new Map(stock.categories.map((category, index) => [category.id, index]));

  return [...stock.items].sort((left, right) => {
    const leftRank = categoryRank.get(left.category) ?? 9999;
    const rightRank = categoryRank.get(right.category) ?? 9999;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name, "fr");
  });
}

function filteredItems() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const selectedCategory = elements.categoryFilter.value;

  return sortedItems().filter(item => {
    const category = categoryById(item.category);
    const searchable = `${item.name} ${item.expiry} ${category?.name || ""}`.toLowerCase();
    const matchesSearch = !query || searchable.includes(query);
    const matchesCategory = !selectedCategory || item.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });
}

function categoryOptions(selectedId) {
  return stock.categories
    .map(category => {
      const selected = category.id === selectedId ? " selected" : "";
      return `<option value="${escapeHtml(category.id)}"${selected}>${escapeHtml(category.name)}</option>`;
    })
    .join("");
}

function expiryValue(value) {
  if (value === "1 an") {
    return "1 année";
  }

  return EXPIRY_CHOICES.includes(value) ? value : "";
}

function expiryOptions(selectedValue) {
  const normalizedValue = expiryValue(selectedValue);

  return EXPIRY_CHOICES
    .map(value => {
      const selected = value === normalizedValue ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
    })
    .join("");
}

function renderNewItemCategories(selectedId) {
  elements.newItemCategory.innerHTML = categoryOptions(selectedId);
}

function renderFilters() {
  const currentFilter = elements.categoryFilter.value;
  elements.categoryFilter.innerHTML = `<option value="">Toutes</option>${categoryOptions(currentFilter)}`;
  renderNewItemCategories(currentFilter || stock.categories[0]?.id || "");
  if (currentFilter && !categoryById(currentFilter)) {
    elements.categoryFilter.value = "";
  }
}

function renderSummary() {
  const totalMissing = stock.items.reduce((sum, item) => {
    return sum + Math.max(0, toQuantity(item.targetQuantity) - toQuantity(item.currentQuantity));
  }, 0);
  const articleLabel = stock.items.length > 1 ? "objets" : "objet";
  const missingLabel = totalMissing > 1 ? "manquants" : "manquant";

  elements.stockSummary.textContent = `${stock.items.length} ${articleLabel} · ${totalMissing} ${missingLabel}`;
}

function renderTable() {
  const items = filteredItems();

  elements.emptyState.hidden = items.length > 0;
  elements.itemsBody.innerHTML = items
    .map(item => {
      const category = categoryById(item.category) || stock.categories[0] || {
        id: "",
        name: "Sans catégorie",
        color: "#e6e8ec"
      };
      const balance = toQuantity(item.currentQuantity) - toQuantity(item.targetQuantity);
      const balanceText = balance > 0 ? `+${balance}` : String(balance);
      const balanceClass = balance > 0
        ? "balance-count is-surplus"
        : balance < 0
          ? "balance-count is-missing"
          : "balance-count";

      return `
        <tr class="stock-row" data-id="${escapeHtml(item.id)}" style="--category-color: ${escapeHtml(category.color)}">
          <td class="category-cell">
            <select class="item-field category-select" data-field="category" aria-label="Catégorie">
              ${categoryOptions(item.category)}
            </select>
          </td>
          <td>
            <select class="item-field expiry-input" data-field="expiry" aria-label="Date limite">
              ${expiryOptions(item.expiry)}
            </select>
          </td>
          <td>
            <input class="item-field name-input" data-field="name" type="text" value="${escapeHtml(item.name)}" aria-label="Objet">
          </td>
          <td>
            <input class="item-field number-input" data-field="targetQuantity" type="number" min="0" step="1" value="${toQuantity(item.targetQuantity)}" aria-label="Quantité souhaitée">
          </td>
          <td>
            <div class="quantity-controls">
              <button class="icon-button minus-button" data-action="decrease" type="button" title="Moins" aria-label="Diminuer">−</button>
              <input class="item-field number-input current-input" data-field="currentQuantity" type="number" min="0" step="1" value="${toQuantity(item.currentQuantity)}" aria-label="Quantité restante">
              <button class="icon-button plus-button" data-action="increase" type="button" title="Plus" aria-label="Augmenter">+</button>
            </div>
          </td>
          <td><span class="${balanceClass}" data-balance>${balanceText}</span></td>
          <td class="control-cell" data-control-cell>${controlHtml(item.lastControl)}</td>
          <td>
            <button class="icon-button delete-button bare-delete-button" data-action="delete-item" type="button" title="Supprimer" aria-label="Supprimer">×</button>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderCategories() {
  elements.categoryEditor.innerHTML = stock.categories
    .map(category => `
      <div class="category-row" data-id="${escapeHtml(category.id)}">
        <input class="category-field" data-field="color" type="color" value="${escapeHtml(category.color)}" aria-label="Couleur ${escapeHtml(category.name)}">
        <input class="category-field" data-field="name" type="text" value="${escapeHtml(category.name)}" aria-label="Nom catégorie">
        <button class="icon-button delete-button" data-action="delete-category" type="button" title="Supprimer" aria-label="Supprimer">×</button>
      </div>
    `)
    .join("");
}

function shoppingText() {
  const lines = [];

  stock.categories.forEach(category => {
    const missingItems = stock.items
      .filter(item => item.category === category.id)
      .map(item => ({
        name: item.name,
        missing: Math.max(0, toQuantity(item.targetQuantity) - toQuantity(item.currentQuantity))
      }))
      .filter(item => item.missing > 0);

    if (!missingItems.length) {
      return;
    }

    if (lines.length) {
      lines.push("");
    }
    lines.push(category.name);
    missingItems.forEach(item => {
      lines.push(`${item.missing} x ${item.name}`);
    });
  });

  return lines.length ? lines.join("\n") : "Aucune course à prévoir.";
}

function renderShoppingList() {
  const text = shoppingText();
  elements.shoppingList.value = text;
  elements.printShoppingList.textContent = text;
  elements.printListButton.disabled = text === "Aucune course à prévoir.";
}

function renderAll() {
  renderFilters();
  renderSummary();
  renderTable();
  renderCategories();
  renderShoppingList();
}

function updateRow(row, item) {
  const category = categoryById(item.category);
  const balance = toQuantity(item.currentQuantity) - toQuantity(item.targetQuantity);
  const balanceElement = row.querySelector("[data-balance]");
  const controlElement = row.querySelector("[data-control-cell]");

  if (category) {
    row.style.setProperty("--category-color", category.color);
  }

  if (balanceElement) {
    balanceElement.textContent = balance > 0 ? `+${balance}` : String(balance);
    balanceElement.classList.toggle("is-missing", balance < 0);
    balanceElement.classList.toggle("is-surplus", balance > 0);
  }

  if (controlElement) {
    controlElement.innerHTML = controlHtml(item.lastControl);
  }
}

function serializeStock() {
  return {
    version: 1,
    categories: stock.categories,
    items: stock.items
  };
}

function isStockSavable() {
  const categoryIds = new Set(stock.categories.map(category => category.id));
  const hasInvalidCategory = stock.categories.some(category => !category.id || !category.name.trim());
  const hasInvalidItem = stock.items.some(item => {
    return !item.id || !item.name.trim() || !categoryIds.has(item.category);
  });

  return !hasInvalidCategory && !hasInvalidItem;
}

async function saveNow() {
  if (isSaving) {
    needsSave = true;
    return;
  }

  isSaving = true;
  needsSave = false;
  setStatus("Sauvegarde", "saving");

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(serializeStock())
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Erreur inconnue");
    }

    stock.updatedAt = result.updatedAt;
    setStatus("Sauvegardé");
  } catch (error) {
    setStatus("Erreur", "error");
    console.error(error);
  } finally {
    isSaving = false;
    if (needsSave) {
      scheduleSave();
    }
  }
}

function scheduleSave() {
  clearTimeout(saveTimer);

  if (!isStockSavable()) {
    setStatus("Nom requis", "error");
    return;
  }

  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
}

function afterDataChange({ fullRender = false, row = null, item = null } = {}) {
  if (fullRender) {
    renderAll();
  } else {
    if (row && item) {
      updateRow(row, item);
    }
    renderSummary();
    renderShoppingList();
  }

  scheduleSave();
}

function addCategory() {
  const existingIds = new Set(stock.categories.map(category => category.id));
  const categoryNumber = stock.categories.length + 1;
  const id = uniqueId(`categorie-${categoryNumber}`, existingIds);

  stock.categories.push({
    id,
    name: `Catégorie ${categoryNumber}`,
    color: "#e6e8ec"
  });

  afterDataChange({ fullRender: true });
  requestAnimationFrame(() => {
    const input = elements.categoryEditor.querySelector(`[data-id="${CSS.escape(id)}"] input[type="text"]`);
    input?.focus();
    input?.select();
  });
}

function openItemDialog() {
  if (!stock.categories.length) {
    setStatus("Catégorie requise", "error");
    return;
  }

  const preferredCategory = elements.categoryFilter.value || stock.categories[0]?.id || "";
  renderNewItemCategories(preferredCategory);
  elements.itemForm.reset();
  elements.newItemCategory.value = preferredCategory;
  elements.newItemExpiry.value = "";
  elements.newItemTarget.value = "1";
  elements.newItemCurrent.value = "0";

  if (typeof elements.itemDialog.showModal === "function") {
    elements.itemDialog.showModal();
  } else {
    elements.itemDialog.setAttribute("open", "");
  }

  requestAnimationFrame(() => {
    elements.newItemName.focus();
  });
}

function closeItemDialog() {
  if (elements.itemDialog.open && typeof elements.itemDialog.close === "function") {
    elements.itemDialog.close();
    return;
  }

  elements.itemDialog.removeAttribute("open");
}

function createItemFromDialog(event) {
  event.preventDefault();

  const name = elements.newItemName.value.trim();
  const category = elements.newItemCategory.value;

  if (!name || !categoryById(category)) {
    return;
  }

  const existingIds = new Set(stock.items.map(item => item.id));
  const id = uniqueId(name, existingIds);

  stock.items.push({
    id,
    category,
    name,
    expiry: elements.newItemExpiry.value,
    targetQuantity: toQuantity(elements.newItemTarget.value),
    currentQuantity: toQuantity(elements.newItemCurrent.value),
    lastControl: todayIsoDate()
  });

  closeItemDialog();
  afterDataChange({ fullRender: true });
  requestAnimationFrame(() => {
    elements.itemsBody.querySelector(`[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({
      block: "center",
      behavior: "smooth"
    });
  });
}

function deleteItem(id) {
  const item = itemById(id);
  if (!item) {
    return;
  }

  if (!confirm(`Supprimer "${item.name}" ?`)) {
    return;
  }

  stock.items = stock.items.filter(candidate => candidate.id !== id);
  afterDataChange({ fullRender: true });
}

function deleteCategory(id) {
  const category = categoryById(id);
  if (!category) {
    return;
  }

  const linkedItems = stock.items.filter(item => item.category === id).length;
  const warning = linkedItems
    ? `Supprimer "${category.name}" et ${linkedItems} objet(s) ?`
    : `Supprimer "${category.name}" ?`;

  if (!confirm(warning)) {
    return;
  }

  stock.categories = stock.categories.filter(candidate => candidate.id !== id);
  stock.items = stock.items.filter(item => item.category !== id);
  afterDataChange({ fullRender: true });
}

function handleTableInput(event) {
  const field = event.target.closest(".item-field");
  const row = event.target.closest("tr[data-id]");

  if (!field || !row) {
    return;
  }

  const item = itemById(row.dataset.id);
  if (!item) {
    return;
  }

  const fieldName = field.dataset.field;
  const value = field.type === "number" ? toQuantity(field.value) : field.value;

  item[fieldName] = value;
  markItemControlled(item);

  if (field.type === "number" && field.value !== String(value)) {
    field.value = value;
  }

  if (fieldName === "category") {
    afterDataChange({ fullRender: true });
    return;
  }

  afterDataChange({ row, item });
}

function handleTableClick(event) {
  const button = event.target.closest("button[data-action]");
  const row = event.target.closest("tr[data-id]");

  if (!button || !row) {
    return;
  }

  const item = itemById(row.dataset.id);
  if (!item) {
    return;
  }

  if (button.dataset.action === "delete-item") {
    deleteItem(item.id);
    return;
  }

  if (button.dataset.action === "decrease") {
    item.currentQuantity = Math.max(0, toQuantity(item.currentQuantity) - 1);
    markItemControlled(item);
  }

  if (button.dataset.action === "increase") {
    item.currentQuantity = toQuantity(item.currentQuantity) + 1;
    markItemControlled(item);
  }

  const currentInput = row.querySelector('[data-field="currentQuantity"]');
  if (currentInput) {
    currentInput.value = item.currentQuantity;
  }

  afterDataChange({ row, item });
}

function handleCategoryInput(event) {
  const field = event.target.closest(".category-field");
  const row = event.target.closest(".category-row[data-id]");

  if (!field || !row) {
    return;
  }

  const category = categoryById(row.dataset.id);
  if (!category) {
    return;
  }

  category[field.dataset.field] = field.value;
  renderFilters();
  renderTable();
  renderSummary();
  renderShoppingList();
  scheduleSave();
}

function handleCategoryClick(event) {
  const button = event.target.closest("button[data-action='delete-category']");
  const row = event.target.closest(".category-row[data-id]");

  if (!button || !row) {
    return;
  }

  deleteCategory(row.dataset.id);
}

function printShoppingList() {
  const text = elements.shoppingList.value;
  if (!text || text === "Aucune course à prévoir.") {
    return;
  }

  elements.printStatus.textContent = "Impression";
  window.print();

  window.setTimeout(() => {
    elements.printStatus.textContent = "";
  }, 1800);
}

function bindEvents() {
  elements.searchInput.addEventListener("input", renderTable);
  elements.categoryFilter.addEventListener("change", renderTable);
  elements.addCategoryButton.addEventListener("click", addCategory);
  elements.addItemButton.addEventListener("click", openItemDialog);
  elements.itemForm.addEventListener("submit", createItemFromDialog);
  elements.closeItemDialogButton.addEventListener("click", closeItemDialog);
  elements.cancelItemButton.addEventListener("click", closeItemDialog);
  elements.itemDialog.addEventListener("click", event => {
    if (event.target === elements.itemDialog) {
      closeItemDialog();
    }
  });
  elements.itemsBody.addEventListener("input", handleTableInput);
  elements.itemsBody.addEventListener("change", handleTableInput);
  elements.itemsBody.addEventListener("click", handleTableClick);
  elements.categoryEditor.addEventListener("input", handleCategoryInput);
  elements.categoryEditor.addEventListener("change", handleCategoryInput);
  elements.categoryEditor.addEventListener("click", handleCategoryClick);
  elements.printListButton.addEventListener("click", printShoppingList);
}

async function loadStock() {
  setStatus("Chargement", "saving");

  try {
    const response = await fetch(API_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    stock = await response.json();
    renderAll();
    setStatus("Sauvegardé");
  } catch (error) {
    setStatus("Erreur", "error");
    elements.emptyState.hidden = false;
    elements.emptyState.textContent = "Impossible de charger stock.json.";
    console.error(error);
  }
}

bindEvents();
loadStock();
