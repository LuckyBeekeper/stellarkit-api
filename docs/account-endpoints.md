# Account Endpoints Guide

StellarKit API exposes over 25 endpoints under `/account/:id`. This guide groups them by the workflows they support, explains what each one returns, and shows when to combine them rather than calling them individually.

The `:id` path parameter is always a 56-character Stellar public key starting with `G`. Every endpoint returns `400 InvalidAccountId` for a malformed key and `404 AccountNotFound` when the account does not exist on the configured network.

---

## Quick reference: which endpoint to call first

| I want to … | Start here |
|---|---|
| Build a wallet dashboard | `GET /account/:id/summary` |
| Show all balances | `GET /account/:id/balances` |
| Page through payment history | `GET /account/:id/payments` |
| Page through effects / events | `GET /account/:id/effects` |
| Show open DEX offers | `GET /account/:id/offers` |
| Show offer history (created/updated/deleted) | `GET /account/:id/offer-history` |
| Inspect multisig configuration | `GET /account/:id/signers` |
| Run a KYC / compliance check | `GET /account/:id/risk-score` |
| Display recent trades | `GET /account/:id/trades` |
| See when an account is most active | `GET /account/:id/activity-heatmap` |
| Measure portfolio diversification | `GET /account/:id/asset-diversity` |
| Flag concentrated token holdings | `GET /account/:id/token-concentration` |

---

## Use case: Portfolio — account overview and balances

These endpoints give you everything needed to render a complete asset portfolio view.

### `GET /account/:id/summary`

The most commonly used account endpoint. Aggregates four parallel Horizon calls into a single response: balances, recent transactions, open offers, and claimable balances. Use this as the first call on any dashboard load — it avoids four separate round trips.

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountInfo` | object | Account ID, sequence, subentry count, home domain, thresholds, and flags |
| `balances` | object | `xlm` (native) and `assets` (trustlines) |
| `recentTransactions` | array | Up to 10 most recent transactions |
| `openOffers` | array | Up to 20 open DEX offers |
| `claimableBalances` | array | Claimable balances where the account is a claimant |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN/summary"
```

```json
{
  "success": true,
  "data": {
    "accountInfo": {
      "accountId": "GAAZI4TCR3...",
      "sequence": "165420053979136",
      "subentryCount": 3,
      "homeDomain": "example.com",
      "lastModifiedLedger": 52834901,
      "thresholds": { "lowThreshold": 0, "medThreshold": 0, "highThreshold": 0 },
      "flags": { "authRequired": false, "authRevocable": false, "authImmutable": false, "clawbackEnabled": false }
    },
    "balances": {
      "xlm": { "balance": "100.0000000", "buyingLiabilities": "0.0000000", "sellingLiabilities": "0.0000000" },
      "assets": [
        { "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" }, "balance": "250.0000000", "limit": "10000.0000000", "isAuthorized": true }
      ]
    },
    "recentTransactions": [
      { "hash": "abc123...", "ledger": 52834901, "createdAt": "2026-09-20T14:32:11Z", "operationCount": 1, "successful": true }
    ],
    "openOffers": [],
    "claimableBalances": []
  }
}
```

**When to use `/summary` vs individual endpoints:**
- Use `/summary` for initial page loads and dashboard hydration — one call, four data sources.
- Use the individual endpoints when you need deeper pagination (e.g. all 500 payment records) or when refreshing only one section.

---

### `GET /account/:id/balances`

Returns XLM and all non-native asset balances. Supports filtering to specific assets.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `native` | boolean | When `true`, returns only the native XLM balance |
| `assets` | string | Comma-separated `CODE:ISSUER` identifiers to filter by |

```bash
# All balances
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CVWJH59IAJTGKIN2ER7LBNVKOCCWO/balances"

# XLM only
curl "http://localhost:3000/account/GAAZI4TCR3.../balances?native=true"

# Filter to specific assets
curl "http://localhost:3000/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CVWJH59IAJTGKIN2ER7LBNVKOCCWO/balances?assets=USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPPPRE34K4KZVN"
```

---

### `GET /account/:id/native-balance`

Returns only the native XLM balance with buying and selling liabilities. Lighter than `/balances` when you only need XLM.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../native-balance"
```

```json
{
  "success": true,
  "data": {
    "balance": "100.0000000",
    "buyingLiabilities": "0.0000000",
    "sellingLiabilities": "5.0000000"
  }
}
```

---

### `GET /account/:id/trustlines`

Returns all trustlines with optional TOML metadata from each issuer's home domain. Useful for building an asset management screen.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `assetCode` | string | Filter to a single asset code (case-insensitive) |
| `sponsored` | boolean | `true` returns only sponsored trustlines; `false` returns only unsponsored |
| `includeMetadata` | boolean | When `true`, resolves TOML metadata for each issuer |

```bash
# All trustlines
curl "http://localhost:3000/account/GAAZI4TCR3.../trustlines"

# Only USDC trustlines
curl "http://localhost:3000/account/GAAZI4TCR3.../trustlines?assetCode=USDC"
```

---

### `GET /account/:id/historical-balances`

Reconstructs balance snapshots at regular intervals by starting from the current balance and replaying payment and trade history backwards. Useful for portfolio charts and tax tools. Snapshots are approximations: transaction fees and balance changes from other operation types are not replayed.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `asset` | string | `CODE:ISSUER` to track a single asset. Defaults to native XLM. |
| `resolution` | string | Interval between snapshots: `7d` (default) or `30d`. Any other value returns `400`. |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../historical-balances?resolution=30d"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "asset": { "code": "XLM", "issuer": null, "type": "native" },
    "resolution": "30d",
    "snapshots": [
      { "timestamp": "2025-11-22T10:00:00.000Z", "balance": "120.0000000" },
      { "timestamp": "2026-10-18T10:00:00.000Z", "balance": "250.5000000" }
    ]
  }
}
```

---

### `GET /account/:id/liquidity-contribution`

Aggregates the account's liquidity pool positions: per-pool share percentage and equivalent reserves, plus totals per asset across all pools. Cached per account (`CACHE_TTL_LIQUIDITY_CONTRIBUTION_MS`, default 15 s); responses carry `X-Cache: HIT|MISS`. Pass `?fresh=true` to bypass the cache.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../liquidity-contribution"
```

---

### `GET /account/:id/token-concentration`

Measures how concentrated an account's token (non-native) portfolio is. Uses the same HHI (Herfindahl-Hirschman Index) methodology as `/asset-diversity`, but ignores the native XLM balance so that portfolio risk tools can flag accounts holding most of their token value in a single illiquid asset.

Each token balance is treated as an equal-weighted share of total token balance; the HHI is the sum of the squared percentage shares (ranging from 0 to 10000). The concentration risk label is derived from the HHI:

| HHI interval | `concentrationRisk` |
|---|---|
| > 8000 | `critical` |
| 5001 – 8000 | `high` |
| 2501 – 5000 | `moderate` |
| ≤ 2500 | `low` |

**Response fields:**

| Field | Type | Description |
|---|---|---|
| `accountId` | string | The 56-character account public key |
| `concentrationRisk` | string | One of `critical`, `high`, `moderate`, ``low` |
| `topHoldingPercent` | number | Share of total token value held in the largest position (0 – 100) |
| `topHoldingAsset` | object | null | Asset identifier of the largest position, or `null` when the account holds no tokens |
| `tokenCount` | number | Number of non-native token positions with a non-zero balance |
| `hhi` | number | Herfindahl-Hirschman Index over token positions (0 – 10000) |

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../token-concentration"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "concentrationRisk": "critical",
    "topHoldingPercent": 92.5,
    "topHoldingAsset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
    "tokenCount": 2,
    "hhi": 8562.5
  }
}
```

An account with no token positions returns `concentrationRisk`: ``low`, `topHoldingPercent`: 0, `topHoldingAsset`: `null`, `tokenCount`: 0, and `hhi`: 0. Returns `404 AccountNotFound` when the account does not exist.

---

## Use case: Activity — transaction and payment history

These endpoints let you page through an account's historical activity.

### `GET /account/:id/transactions`

Paginated transaction history. Each record includes the fee summary, memo, and operation count.

**Query params:** `limit` (default 20, max 200), `order` (`asc`|`desc`), `cursor`, `type` (filter by operation type).

```bash
# Latest 20 transactions
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions"

# Oldest first, paginate
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions?order=asc&limit=50"

# Only transactions containing a payment operation
curl "http://localhost:3000/account/GAAZI4TCR3.../transactions?type=payment"
```

---

### `GET /account/:id/payments`

Returns payment and create_account operations only — a narrower view than full transactions. Supports filtering by asset code and date range.

**Query params:** `limit`, `order`, `cursor`, `assetCode`, `assetIssuer`, `startDate` (ISO 8601), `endDate` (ISO 8601).

```bash
# Latest payments
curl "http://localhost:3000/account/GAAZI4TCR3.../payments"

# Only USDC payments in the last month
curl "http://localhost:3000/account/GAAZI4TCR3.../payments?assetCode=USDC&startDate=2026-08-01T00:00:00Z"
```

```json
{
  "success": true,
  "data": {
    "payments": [
      {
        "paymentId": "216532748304662529",
        "type": "payment",
        "from": "GBBD47IF6LWK7P7MDEVSWR7DPUWV3NY3DTQEVFL4NAT4AQH3HLFLA5",
        "to": "GAAZI4TCR3...",
        "asset": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "amount": "50.0000000",
        "createdAt": "2026-09-20T14:32:11Z",
        "transactionHash": "abc123..."
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "216532748304662529"
  }
}
```

---

### `GET /account/:id/effects`

Paginated ledger effects for the account. Effects are the low-level side effects of operations — credits, debits, trustline changes, signer updates, and more. Use this when you need a complete audit trail rather than a payment-only view.

**Query params:** `limit`, `order`, `cursor`, `type` (filter to a specific effect type), `fresh`.

```bash
# Latest effects
curl "http://localhost:3000/account/GAAZI4TCR3.../effects"

# Only account_credited effects
curl "http://localhost:3000/account/GAAZI4TCR3.../effects?type=account_credited"
```

---

### `GET /account/:id/pending-effects`

Lists operations the account has submitted that have not yet produced confirmed effects. Each entry has `operationType`, `estimatedLedger` and `submittedAt`; `pendingEffects` is empty when nothing is pending. Returns `404` for unknown accounts. Never cached — the response is sent with `Cache-Control: no-store`.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../pending-effects"
```

```json
{
  "success": true,
  "data": {
    "accountId": "GAAZI4TCR3...",
    "pendingEffects": [
      {
        "operationId": "225180887986176001",
        "operationType": "payment",
        "transactionHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c1234",
        "estimatedLedger": 52430100,
        "submittedAt": "2026-10-18T10:00:05.000Z"
      }
    ],
    "count": 1
  }
}
```

---

### `GET /account/:id/trades`

Returns DEX trades for the account, showing both sides (sold/bought) and the price at execution.

**Query params:** `limit`, `order`, `cursor`, `startDate`, `endDate`, `fresh`.

```bash
curl "http://localhost:3000/account/GAAZI4TCR3.../trades"
```

```json
{
  "success": true,
  "data": {
    "trades": [
      {
        "tradeId": "216532748304662529-0",
        "ledgerCloseTime": "2026-09-20T14:32:11Z",
        "selling": { "code": "XLM", "issuer": null, "type": "native" },
        "buying": { "code": "USDC", "issuer": "GA5Z...", "type": "credit_alphanum4" },
        "soldAmount": "100.0000000",
        "boughtAmount": "8.5000000",
        "price": "0.0850000",
        "offerId": "12345"
      }
    ],
    "total": 1,
    "limit": 20,
    "cursor": "216532748304662529-0"
  }
}
```

---

## Use case: Analytics — activity patterns and portfolio diversification

These endpoints summarise an account's behaviour rather than listing raw records. They are intended for analytics tools, wallet dashboards, and financial 
