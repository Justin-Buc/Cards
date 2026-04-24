const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

const GRADES = {
  psa10: { label: "PSA 10", keywords: ["psa 10", "psa10"], excludes: ["psa 9", "psa9", "psa 8", "sgc", "bgs"] },
  psa9:  { label: "PSA 9",  keywords: ["psa 9", "psa9"],   excludes: ["psa 10", "psa10", "psa 8", "sgc", "bgs"] },
  raw:   { label: "Raw",    keywords: [],                   excludes: ["psa", "bgs", "sgc", "beckett", "cgc"] },
};

function calcStats(prices) {
  if (!prices.length) return null;
  const recent = prices.slice(0, 10);
  const last10Avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const allAvg = prices.reduce((a, b) => a + b, 0) / prices.length;
  const sorted = [...prices].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return {
    count: prices.length,
    last10Avg: Math.round(last10Avg * 100) / 100,
    last10Count: recent.length,
    lastSale: Math.round(prices[0] * 100) / 100,
    avg: Math.round(allAvg * 100) / 100,
    median: Math.round(median * 100) / 100,
    low: Math.min(...prices),
    high: Math.max(...prices),
  };
}

function classifySale(title) {
  const t = title.toLowerCase();
  if (!t.includes("bowman")) return null;
  if (!t.includes("auto") && !t.includes("autograph")) return null;
  for (const [grade, cfg] of Object.entries(GRADES)) {
    const hasKeyword = cfg.keywords.length === 0 || cfg.keywords.some((k) => t.includes(k));
    const hasExclude = cfg.excludes.some((k) => t.includes(k));
    if (hasKeyword && !hasExclude) return grade;
  }
  return null;
}

function extractPrice(text) {
  const match = text.match(/\$([0-9,]+\.?\d{0,2})/);
  if (!match) return null;
  const price = parseFloat(match[1].replace(",", ""));
  if (price < 5 || price > 75000) return null;
  return price;
}

function timeToSecs(str) {
  if (!str) return Infinity;
  const d = str.match(/(\d+)d/);
  const h = str.match(/(\d+)h/);
  const m = str.match(/(\d+)m/);
  return ((d ? parseInt(d[1]) : 0) * 86400)
       + ((h ? parseInt(h[1]) : 0) * 3600)
       + ((m ? parseInt(m[1]) : 0) * 60);
}

async function fetchRSSData(url) {
  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
      "Accept": "application/rss+xml, text/xml, */*",
    },
    timeout: 15000,
  });
  return data;
}

function parseRSSItems(xml) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const items = [];
  $("item").each((i, el) => {
    const title    = $(el).find("title").first().text().trim();
    const link     = $(el).find("link").first().text().trim() || $(el).find("guid").text().trim();
    const desc     = $(el).find("description").first().text().trim();
    const pubDate  = $(el).find("pubDate").text().trim();
    const price    = extractPrice(title) || extractPrice(desc);
    const timeMatch = desc.match(/time left[:\s]+([^<\n]+)/i);
    const timeLeft  = timeMatch ? timeMatch[1].trim() : null;
    const bidsMatch = desc.match(/(\d+)\s+bid/i);
    const bids      = bidsMatch ? `${bidsMatch[1]} bid${parseInt(bidsMatch[1]) !== 1 ? "s" : ""}` : "0 bids";
    const shipMatch = desc.match(/(free shipping|\+\$[\d.]+\s*shipping)/i);
    const shipping  = shipMatch ? shipMatch[1] : "";
    if (!title || !price) return;
    items.push({ title, link, price, pubDate, timeLeft, bids, shipping });
  });
  return items;
}

// ─── SOLD PRICES ─────────────────────────────────────────────────────────────

async function fetchGradedPrices(playerName) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=100&_rss=1`;
  const xml = await fetchRSSData(url);
  const items = parseRSSItems(xml);
  if (!items.length) return null;

  const buckets  = { psa10: [], psa9: [], raw: [] };
  const allSales = { psa10: [], psa9: [], raw: [] };

  for (const item of items) {
    const grade = classifySale(item.title);
    if (!grade) continue;
    buckets[grade].push(item.price);
    allSales[grade].push({ title: item.title, price: item.price, date: item.pubDate, url: item.link });
  }

  const grades = {};
  for (const [key, prices] of Object.entries(buckets)) {
    grades[key] = prices.length ? { ...calcStats(prices), recentSales: allSales[key].slice(0, 8) } : null;
  }

  const totalCount = Object.values(buckets).reduce((a, b) => a + b.length, 0);
  if (totalCount === 0) return null;

  return { playerName, grades, totalSalesFound: totalCount, fetchedAt: new Date().toISOString() };
}

// ─── ACTIVE DEALS ─────────────────────────────────────────────────────────────

async function fetchActiveListings(playerName, gradePrices) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&_sop=15&_ipg=100&_rss=1`;
  const xml = await fetchRSSData(url);
  const items = parseRSSItems(xml);
  const deals = [];

  for (const item of items) {
    const grade = classifySale(item.title);
    if (!grade) continue;
    const benchmark = gradePrices?.[grade]?.last10Avg;
    if (!benchmark) continue;
    if (item.price <= benchmark) {
      const savings = Math.round(((benchmark - item.price) / benchmark) * 100);
      deals.push({
        playerName, grade, gradeLabel: GRADES[grade].label,
        title: item.title, price: item.price, benchmark, savings,
        savingsAmt: Math.round((benchmark - item.price) * 100) / 100,
        shipping: item.shipping, url: item.link,
      });
    }
  }
  return deals;
}

// ─── AUCTIONS ─────────────────────────────────────────────────────────────────

async function fetchAuctions(playerName, gradePrices) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Auction=1&_sop=1&_ipg=100&_rss=1`;
  const xml = await fetchRSSData(url);
  const items = parseRSSItems(xml);
  const auctions = [];

  for (const item of items) {
    const grade = classifySale(item.title);
    if (!grade) continue;
    const benchmark = gradePrices?.[grade]?.last10Avg ?? null;
    const vsAvg = benchmark ? Math.round(((benchmark - item.price) / benchmark) * 100) : null;
    auctions.push({
      playerName, grade, gradeLabel: GRADES[grade].label,
      title: item.title, currentBid: item.price, bids: item.bids,
      timeLeft: item.timeLeft || "—", endingSecs: timeToSecs(item.timeLeft),
      benchmark, vsAvg, shipping: item.shipping, url: item.link,
    });
  }

  auctions.sort((a, b) => a.endingSecs - b.endingSecs);
  return auctions;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

app.get("/api/prices/:playerName", async (req, res) => {
  try {
    const result = await fetchGradedPrices(req.params.playerName);
    if (!result) return res.status(404).json({ error: "No sold listings found", playerName: req.params.playerName });
    res.json(result);
  } catch (err) {
    console.error("Price fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch prices", details: err.message });
  }
});

app.post("/api/prices/batch", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) return res.status(400).json({ error: "Provide a players array" });
  const results = {};
  for (const name of players.slice(0, 10)) {
    try {
      results[name] = await fetchGradedPrices(name);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) { results[name] = { error: e.message }; }
  }
  res.json(results);
});

app.post("/api/deals", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) return res.status(400).json({ error: "Provide players array" });
  const allDeals = [];
  for (const { name, grades } of players.slice(0, 20)) {
    try {
      allDeals.push(...await fetchActiveListings(name, grades));
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) { console.error(`Deals failed for ${name}:`, e.message); }
  }
  allDeals.sort((a, b) => b.savings - a.savings);
  res.json({ deals: allDeals, scannedAt: new Date().toISOString(), count: allDeals.length });
});

app.post("/api/auctions", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) return res.status(400).json({ error: "Provide players array" });
  const allAuctions = [];
  for (const { name, grades } of players.slice(0, 20)) {
    try {
      allAuctions.push(...await fetchAuctions(name, grades || {}));
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) { console.error(`Auctions failed for ${name}:`, e.message); }
  }
  allAuctions.sort((a, b) => a.endingSecs - b.endingSecs);
  res.json({ auctions: allAuctions, scannedAt: new Date().toISOString(), count: allAuctions.length });
});

// Debug — see raw RSS items for a player
app.get("/api/debug/:playerName", async (req, res) => {
  try {
    const query = encodeURIComponent(`${req.params.playerName} Bowman Chrome 1st Auto`);
    const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=100&_rss=1`;
    const xml = await fetchRSSData(url);
    const items = parseRSSItems(xml);
    res.json({ itemsFound: items.length, firstFive: items.slice(0, 5), rawSnippet: xml.slice(0, 600) });
  } catch (e) { res.json({ error: e.message }); }
});

app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));

app.listen(PORT, () => console.log(`A&J Cards backend running on http://localhost:${PORT}`));
