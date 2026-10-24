/**
 * tests/routes/account.counterpartySummary.test.js
 *
 * Test suite for GET /account/:id/counterparty-summary
 *
 * Acceptance Criteria:
 *   1. A counterparty with 100 sent and 60 received returns netPosition: "-40.0000000" (net outbound).
 *   2. A counterparty with equal sent and received returns netPosition: "0.0000000".
 *   3. txCount correctly counts total interactions not just payments.
 *   4. ?limit=5 caps results to 5 counterparties.
 *   5. All amounts are seven-decimal strings.
 *   6. Counterparties are sorted by txCount descending.
 *   7. Returns 404 if account does not exist.
 *   8. Returns 400 for invalid account ID format.
 */

"use strict";

const request = require("supertest");
const express = require("express");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../../src/config/stellar", () => ({
  NETWORK: "testnet",
  server: {
    loadAccount: jest.fn(),
    payments: jest.fn(),
  },
}));

const accountCounterpartiesRouter = require("../../src/routes/account.counterparties");
const errorHandler = require("../../src/middleware/errorHandler");
const { server } = require("../../src/config/stellar");

const app = express();
app.use(express.json());
app.use("/account", accountCounterpartiesRouter);
app.use(errorHandler);

const MAIN_ACCOUNT = Keypair.random().publicKey();
const NON_EXISTENT_ACCOUNT = Keypair.random().publicKey();

function makePayment({ from, to, amount, type = "payment", createdAt = new Date().toISOString() }) {
  return {
    id: `op_${Math.random().toString(36).slice(2)}`,
    paging_token: `token_${Math.random().toString(36).slice(2)}`,
    type,
    from,
    to,
    amount,
    asset_type: "native",
    transaction_successful: true,
    created_at: createdAt,
  };
}

function makeInteraction({ from, to, type = "account_merge", createdAt = new Date().toISOString() }) {
  return {
    id: `op_${Math.random().toString(36).slice(2)}`,
    paging_token: `token_${Math.random().toString(36).slice(2)}`,
    type,
    from,
    to,
    transaction_successful: true,
    created_at: createdAt,
  };
}

function mockPayments(records) {
  const forAccount = jest.fn().mockReturnValue({
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records }),
  });
  server.payments.mockReturnValue({ forAccount });
  return forAccount;
}

describe("GET /account/:id/counterparty-summary", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.loadAccount.mockResolvedValue({
      id: MAIN_ACCOUNT,
      balances: [{ asset_type: "native", balance: "1000.0000000" }],
    });
  });

  it("returns netPosition: '-40.0000000' for a counterparty with 100 sent and 60 received (net outbound)", async () => {
    const cp = Keypair.random().publicKey();

    mockPayments([
      makePayment({
        from: MAIN_ACCOUNT,
        to: cp,
        amount: "100.0000000",
        createdAt: "2026-01-01T10:00:00Z",
      }),
      makePayment({
        from: cp,
        to: MAIN_ACCOUNT,
        amount: "60.0000000",
        createdAt: "2026-01-02T10:00:00Z",
      }),
    ]);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/counterparty-summary`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accountId).toBe(MAIN_ACCOUNT);
    expect(res.body.data.counterparties).toHaveLength(1);

    const result = res.body.data.counterparties[0];
    expect(result.address).toBe(cp);
    expect(result.totalSent).toBe("100.0000000");
    expect(result.totalReceived).toBe("60.0000000");
    expect(result.netPosition).toBe("-40.0000000");
    expect(result.txCount).toBe(2);
    expect(result.firstInteractionAt).toBe("2026-01-01T10:00:00Z");
    expect(result.lastInteractionAt).toBe("2026-01-02T10:00:00Z");
  });

  it("returns netPosition: '0.0000000' for a counterparty with equal sent and received", async () => {
    const cp = Keypair.random().publicKey();

    mockPayments([
      makePayment({
        from: MAIN_ACCOUNT,
        to: cp,
        amount: "50.0000000",
        createdAt: "2026-02-01T12:00:00Z",
      }),
      makePayment({
        from: cp,
        to: MAIN_ACCOUNT,
        amount: "50.0000000",
        createdAt: "2026-02-02T12:00:00Z",
      }),
    ]);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/counterparty-summary`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counterparties).toHaveLength(1);

    const result = res.body.data.counterparties[0];
    expect(result.address).toBe(cp);
    expect(result.totalSent).toBe("50.0000000");
    expect(result.totalReceived).toBe("50.0000000");
    expect(result.netPosition).toBe("0.0000000");
    expect(result.txCount).toBe(2);
  });

  it("correctly counts total interactions not just payments in txCount", async () => {
    const cp = Keypair.random().publicKey();

    mockPayments([
      makePayment({
        from: MAIN_ACCOUNT,
        to: cp,
        amount: "25.0000000",
      }),
      makePayment({
        from: cp,
        to: MAIN_ACCOUNT,
        amount: "15.0000000",
      }),
      // Non-payment interaction (e.g. account_merge)
      makeInteraction({
        from: MAIN_ACCOUNT,
        to: cp,
        type: "account_merge",
      }),
    ]);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/counterparty-summary`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counterparties).toHaveLength(1);

    const result = res.body.data.counterparties[0];
    expect(result.address).toBe(cp);
    // txCount is 3 (2 payments + 1 non-payment interaction)
    expect(result.txCount).toBe(3);
    // Financial amounts only reflect value-bearing operations
    expect(result.totalSent).toBe("25.0000000");
    expect(result.totalReceived).toBe("15.0000000");
    expect(result.netPosition).toBe("-10.0000000");
  });

  it("caps results to 5 counterparties when ?limit=5 is provided and sorts by txCount descending", async () => {
    const cps = Array.from({ length: 8 }, () => Keypair.random().publicKey());
    const records = [];

    // Assign different interaction counts to verify sorting by txCount descending
    cps.forEach((cp, idx) => {
      const interactionCount = idx + 1; // 1 to 8 interactions
      for (let i = 0; i < interactionCount; i++) {
        records.push(
          makePayment({
            from: MAIN_ACCOUNT,
            to: cp,
            amount: "10.0000000",
          })
        );
      }
    });

    mockPayments(records);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/counterparty-summary?limit=5`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counterparties).toHaveLength(5);

    // Verify sorted by txCount descending: 8, 7, 6, 5, 4
    const counterparties = res.body.data.counterparties;
    expect(counterparties[0].txCount).toBe(8);
    expect(counterparties[1].txCount).toBe(7);
    expect(counterparties[2].txCount).toBe(6);
    expect(counterparties[3].txCount).toBe(5);
    expect(counterparties[4].txCount).toBe(4);

    for (let i = 0; i < counterparties.length - 1; i++) {
      expect(counterparties[i].txCount).toBeGreaterThanOrEqual(counterparties[i + 1].txCount);
    }
  });

  it("returns 404 when the account does not exist on Horizon", async () => {
    const error404 = new Error("Account not found");
    error404.response = { status: 404 };
    server.loadAccount.mockRejectedValue(error404);

    const res = await request(app).get(`/account/${NON_EXISTENT_ACCOUNT}/counterparty-summary`);

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 for an invalid account ID format", async () => {
    const res = await request(app).get("/account/INVALID_ACCOUNT_ID/counterparty-summary");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("returns empty counterparties array when the account has no interactions", async () => {
    mockPayments([]);

    const res = await request(app).get(`/account/${MAIN_ACCOUNT}/counterparty-summary`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.counterparties).toEqual([]);
  });
});
