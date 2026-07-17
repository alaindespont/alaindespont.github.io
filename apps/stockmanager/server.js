const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const STOCK_FILE = path.join(DATA_DIR, "stock.json");
const DEFAULT_STOCK_FILE = path.join(ROOT, "stock.json");
const MAX_BODY_SIZE = 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pdf": "application/pdf",
  ".ico": "image/x-icon"
};

async function initializeDataFile() {
  await fs.promises.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.promises.access(STOCK_FILE, fs.constants.F_OK);
  } catch {
    await fs.promises.copyFile(DEFAULT_STOCK_FILE, STOCK_FILE);
    console.log(`Fichier de stock initialisé dans ${STOCK_FILE}`);
  }
}

function send(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function sendJson(response, statusCode, payload) {
  send(response, statusCode, JSON.stringify(payload, null, 2), "application/json; charset=utf-8");
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", chunk => {
      body += chunk;
      if (body.length > MAX_BODY_SIZE) {
        reject(new Error("Le fichier stock est trop volumineux."));
        request.destroy();
      }
    });

    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function toSafeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.floor(number));
}

function toSafeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    return text.slice(0, 10);
  }
  return "";
}

function normalizeStock(payload) {
  if (!payload || !Array.isArray(payload.categories) || !Array.isArray(payload.items)) {
    throw new Error("Format stock invalide.");
  }

  const seenCategories = new Set();
  const categories = payload.categories.map(category => {
    const id = String(category.id || "").trim();
    const name = String(category.name || "").trim();
    const color = String(category.color || "#e6e8ec").trim();

    if (!id || !name) {
      throw new Error("Chaque catégorie doit avoir un id et un nom.");
    }
    if (seenCategories.has(id)) {
      throw new Error(`Catégorie dupliquée: ${id}`);
    }
    seenCategories.add(id);

    return { id, name, color };
  });

  const categoryIds = new Set(categories.map(category => category.id));
  const seenItems = new Set();
  const items = payload.items.map(item => {
    const id = String(item.id || "").trim();
    const category = String(item.category || "").trim();
    const name = String(item.name || "").trim();

    if (!id || !name) {
      throw new Error("Chaque objet doit avoir un id et un nom.");
    }
    if (seenItems.has(id)) {
      throw new Error(`Objet dupliqué: ${id}`);
    }
    if (!categoryIds.has(category)) {
      throw new Error(`Catégorie inconnue pour ${name}.`);
    }
    seenItems.add(id);

    return {
      id,
      category,
      name,
      expiry: String(item.expiry || "").trim(),
      targetQuantity: toSafeInteger(item.targetQuantity),
      currentQuantity: toSafeInteger(item.currentQuantity),
      lastControl: toSafeDate(item.lastControl)
    };
  });

  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    categories,
    items
  };
}

async function handleApi(request, response, pathname) {
  if (pathname !== "/api/stock") {
    sendJson(response, 404, { error: "API inconnue." });
    return;
  }

  if (request.method === "GET") {
    try {
      const stock = await fs.promises.readFile(STOCK_FILE, "utf8");
      send(response, 200, stock, "application/json; charset=utf-8");
    } catch (error) {
      sendJson(response, 500, { error: `Lecture impossible: ${error.message}` });
    }
    return;
  }

  if (request.method === "POST") {
    try {
      const body = await readRequestBody(request);
      const payload = normalizeStock(JSON.parse(body));
      const temporaryFile = `${STOCK_FILE}.tmp`;

      await fs.promises.writeFile(temporaryFile, JSON.stringify(payload, null, 2), "utf8");
      await fs.promises.rename(temporaryFile, STOCK_FILE);
      sendJson(response, 200, { ok: true, updatedAt: payload.updatedAt });
    } catch (error) {
      sendJson(response, 400, { error: `Sauvegarde impossible: ${error.message}` });
    }
    return;
  }

  sendJson(response, 405, { error: "Méthode non autorisée." });
}

async function serveStatic(response, pathname) {
  let requestedPath;

  try {
    requestedPath = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  } catch {
    send(response, 400, "Chemin invalide.");
    return;
  }

  const filePath = path.normalize(path.join(ROOT, requestedPath));
  const relativePath = path.relative(ROOT, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    send(response, 403, "Accès refusé.");
    return;
  }

  try {
    const stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) {
      send(response, 404, "Fichier introuvable.");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[extension] || "application/octet-stream";
    const content = await fs.promises.readFile(filePath);
    send(response, 200, content, contentType);
  } catch {
    send(response, 404, "Fichier introuvable.");
  }
}

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl.pathname);
      return;
    }

    await serveStatic(response, requestUrl.pathname);
  } catch (error) {
    console.error(`Erreur de traitement: ${error.message}`);
    sendJson(response, 500, { error: "Erreur interne." });
  }
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Le port ${PORT} est déjà utilisé.`);
    return;
  }

  console.error(`Erreur serveur: ${error.message}`);
});

initializeDataFile()
  .then(() => {
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Gestionnaire de stock démarré sur le port ${PORT}`);
    });
  })
  .catch(error => {
    console.error(`Initialisation impossible: ${error.message}`);
    process.exit(1);
  });
