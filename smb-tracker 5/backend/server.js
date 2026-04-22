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
  // eBay results come back newest-first, so prices[0] is the most recent sale.
  // Headline = avg of last 10 (most recent) sales — reacts to performance changes
  // without being thrown by a single outlier.
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

async function fetchGradedPrices(playerName) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120`;

  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const buckets = { psa10: [], psa9: [], raw: [] };
  const allSales = { psa10: [], psa9: [], raw: [] };

  $(".s-item").each((i, el) => {
    const title = $(el).find(".s-item__title").text().trim();
    const priceText = $(el).find(".s-item__price").text().trim();
    const date = $(el).find(".s-item__ended-date, .s-item__listingDate").text().trim();

    if (!title || title === "Shop on eBay") return;

    const priceMatch = priceText.match(/\$([0-9,]+\.?\d{0,2})/);
    if (!priceMatch) return;

    const price = parseFloat(priceMatch[1].replace(",", ""));
    if (price < 5 || price > 75000) return;

    const grade = classifySale(title);
    if (!grade) return;

    buckets[grade].push(price);
    allSales[grade].push({ title, price, date });
  });

  const grades = {};
  for (const [key, prices] of Object.entries(buckets)) {
    grades[key] = {
      ...calcStats(prices),
      recentSales: allSales[key].slice(0, 8),
    };
  }

  const totalCount = Object.values(buckets).reduce((a, b) => a + b.length, 0);
  if (totalCount === 0) return null;

  return {
    playerName,
    grades,
    totalSalesFound: totalCount,
    fetchedAt: new Date().toISOString(),
  };
}


// Scrape active eBay listings and compare against last10Avg benchmark
async function fetchActiveListings(playerName, gradePrices) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  // Active listings sorted by lowest price first
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&_sop=15&_ipg=120`;

  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const deals = [];

  $(".s-item").each((i, el) => {
    const title = $(el).find(".s-item__title").text().trim();
    const priceText = $(el).find(".s-item__price").text().trim();
    const itemUrl = $(el).find(".s-item__link").attr("href") || "";
    const condition = $(el).find(".SECONDARY_INFO").text().trim();
    const shipping = $(el).find(".s-item__shipping").text().trim();

    if (!title || title === "Shop on eBay") return;

    const priceMatch = priceText.match(/\$([0-9,]+\.?\d{0,2})/);
    if (!priceMatch) return;

    const price = parseFloat(priceMatch[1].replace(",", ""));
    if (price < 5 || price > 75000) return;

    const grade = classifySale(title);
    if (!grade) return;

    const benchmark = gradePrices?.[grade]?.last10Avg;
    if (!benchmark) return;

    if (price <= benchmark) {
      const savings = Math.round(((benchmark - price) / benchmark) * 100);
      deals.push({
        playerName,
        grade,
        gradeLabel: GRADES[grade].label,
        title,
        price,
        benchmark,
        savings,
        savingsAmt: Math.round((benchmark - price) * 100) / 100,
        condition,
        shipping,
        url: itemUrl.split("?")[0],
      });
    }
  });

  return deals;
}

// POST /api/deals — body: { players: [{ name, grades: { psa10: { last10Avg }, ... } }] }
app.post("/api/deals", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: "Provide players array with grade price data" });
  }

  const allDeals = [];
  for (const { name, grades } of players.slice(0, 20)) {
    try {
      const deals = await fetchActiveListings(name, grades);
      allDeals.push(...deals);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error(`Deals fetch failed for ${name}:`, e.message);
    }
  }

  allDeals.sort((a, b) => b.savings - a.savings);
  res.json({ deals: allDeals, scannedAt: new Date().toISOString(), count: allDeals.length });
});


// Scrape active eBay AUCTIONS for a player — LH_Auction=1
async function fetchAuctions(playerName, gradePrices) {
  const query = encodeURIComponent(`${playerName} Bowman Chrome 1st Auto`);
  // LH_Auction=1 = auctions only, _sop=1 = ending soonest first
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Auction=1&_sop=1&_ipg=120`;

  const { data } = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      "Sec-Fetch-Dest": "document",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Upgrade-Insecure-Requests": "1",
      "sec-ch-ua": '"Google Chrome";v="123", "Not:A-Brand";v="8", "Chromium";v="123"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
    },
    timeout: 15000,
  });

  const $ = cheerio.load(data);
  const auctions = [];

  $(".s-item").each((i, el) => {
    const title = $(el).find(".s-item__title").text().trim();
    const priceText = $(el).find(".s-item__price").text().trim();
    const itemUrl = $(el).find(".s-item__link").attr("href") || "";
    const timeLeft = $(el).find(".s-item__time-left").text().trim();
    const bids = $(el).find(".s-item__bids").text().trim();
    const condition = $(el).find(".SECONDARY_INFO").text().trim();
    const shipping = $(el).find(".s-item__shipping").text().trim();

    if (!title || title === "Shop on eBay") return;

    const priceMatch = priceText.match(/\$([0-9,]+\.?\d{0,2})/);
    if (!priceMatch) return;

    const currentBid = parseFloat(priceMatch[1].replace(",", ""));
    if (currentBid < 1 || currentBid > 75000) return;

    const grade = classifySale(title);
    if (!grade) return;

    const benchmark = gradePrices?.[grade]?.last10Avg ?? null;
    const vsAvg = benchmark
      ? Math.round(((benchmark - currentBid) / benchmark) * 100)
      : null;

    // Parse time left into seconds for sorting
    let endingSecs = Infinity;
    if (timeLeft) {
      const d = timeLeft.match(/(\d+)d/);
      const h = timeLeft.match(/(\d+)h/);
      const m = timeLeft.match(/(\d+)m/);
      endingSecs = ((d ? parseInt(d[1]) : 0) * 86400)
                 + ((h ? parseInt(h[1]) : 0) * 3600)
                 + ((m ? parseInt(m[1]) : 0) * 60);
    }

    auctions.push({
      playerName,
      grade,
      gradeLabel: GRADES[grade].label,
      title,
      currentBid,
      bids: bids || "0 bids",
      timeLeft: timeLeft || "—",
      endingSecs,
      benchmark,
      vsAvg,       // positive = below avg (a good deal), negative = above avg
      condition,
      shipping,
      url: itemUrl.split("?")[0],
    });
  });

  // Sort ending soonest first
  auctions.sort((a, b) => a.endingSecs - b.endingSecs);
  return auctions;
}

// POST /api/auctions — body: { players: [{ name, grades }] }
app.post("/api/auctions", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: "Provide players array" });
  }

  const allAuctions = [];
  for (const { name, grades } of players.slice(0, 20)) {
    try {
      const auctions = await fetchAuctions(name, grades || {});
      allAuctions.push(...auctions);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.error(`Auction fetch failed for ${name}:`, e.message);
    }
  }

  // Re-sort all results ending soonest first
  allAuctions.sort((a, b) => a.endingSecs - b.endingSecs);
  res.json({ auctions: allAuctions, scannedAt: new Date().toISOString(), count: allAuctions.length });
});

// GET /api/prices/:playerName
app.get("/api/prices/:playerName", async (req, res) => {
  const { playerName } = req.params;
  try {
    const result = await fetchGradedPrices(playerName);
    if (!result) {
      return res.status(404).json({ error: "No sold listings found", playerName });
    }
    res.json(result);
  } catch (err) {
    console.error("eBay fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch eBay data", details: err.message });
  }
});

// POST /api/prices/batch  — body: { players: ["Paul Skenes", "Jackson Holliday"] }
app.post("/api/prices/batch", async (req, res) => {
  const { players } = req.body;
  if (!players || !Array.isArray(players)) {
    return res.status(400).json({ error: "Provide a players array in the request body" });
  }

  const results = {};
  for (const name of players.slice(0, 10)) {
    try {
      results[name] = await fetchGradedPrices(name);
      await new Promise((r) => setTimeout(r, 900));
    } catch (e) {
      results[name] = { error: e.message };
    }
  }
  res.json(results);
});

// Health check
app.get("/api/health", (req, res) => res.json({ status: "ok", timestamp: new Date().toISOString() }));
app.get("/api/debug/:playerName", async (req, res) => {
  const query = encodeURIComponent(`${req.params.playerName} Bowman Chrome 1st Auto`);
  const url = `https://www.ebay.com/sch/i.html?_nkw=${query}&LH_Sold=1&LH_Complete=1&_sop=13&_ipg=120`;
  try {
    const { data } = await axios.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: 15000,
    });
    const $ = cheerio.load(data);
    const items = [];
    $(".s-item").each((i, el) => {
      items.push({
        title: $(el).find(".s-item__title").text().trim(),
        price: $(el).find(".s-item__price").text().trim(),
        rawHtml: $(el).html()?.slice(0, 200),
      });
    });
    res.json({
      itemsFound: items.length,
      firstFewTitles: items.slice(0, 5),
      pageSnippet: data.slice(0, 500),
    });
  } catch (e) {
    res.json({ error: e.message });
  }
});
app.listen(PORT, () => console.log(`SMB Tracker backend running on http://localhost:${PORT}`));
