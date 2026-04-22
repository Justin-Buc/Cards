# SMB Tracker — Bowman 1st Auto Dashboard

Track Bowman Chrome 1st Edition autograph prices for BA Top 100 prospects, pulling live data from eBay sold listings.

---

## Project structure

```
smb-tracker/
├── backend/          # Node.js/Express API — scrapes eBay sold listings
│   ├── server.js
│   └── package.json
└── frontend/         # Static HTML/JS dashboard — no build step needed
    └── index.html
```

---

## Quick start

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/smb-tracker.git
cd smb-tracker
```

### 2. Start the backend

```bash
cd backend
npm install
npm start
```

The backend runs on **http://localhost:3001**

### 3. Open the frontend

Just open `frontend/index.html` in your browser — no server or build step needed.

Or serve it with any static server:

```bash
npx serve frontend
# opens at http://localhost:3000
```

---

## API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Check if backend is running |
| GET | `/api/prices/:playerName` | Fetch eBay sold listings for one player |
| POST | `/api/prices/batch` | Fetch up to 10 players at once |

### Example

```bash
curl "http://localhost:3001/api/prices/Paul%20Skenes"
```

Returns:
```json
{
  "playerName": "Paul Skenes",
  "salesCount": 12,
  "avgPrice": 284.50,
  "medianPrice": 265.00,
  "lowPrice": 145.00,
  "highPrice": 520.00,
  "recentSales": [...]
}
```

---

## Pushing to GitHub (first time)

```bash
# From the smb-tracker root folder:
git init
git add .
git commit -m "Initial commit — SMB Tracker"

# Create a new repo on github.com, then:
git remote add origin https://github.com/YOUR_USERNAME/smb-tracker.git
git branch -M main
git push -u origin main
```

---

## Notes

- eBay scraping is subject to rate limits — the batch endpoint adds a delay between requests
- Prices reflect PSA-ungraded raw sales by default; refine the search query in `server.js` to filter by grade
- The frontend works fully offline in demo mode when the backend is not running
- To run on a different port, set the `PORT` environment variable: `PORT=4000 npm start`
