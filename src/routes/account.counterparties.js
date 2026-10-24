const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { server, NETWORK } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAccountId, validateLimit } = require("../utils/validators");
const { makeAccountNotFoundError } = require("../utils/errors");

/**
 * GET /account/:id/counterparties
 * Analyzes frequent payment counterparties for an account.
 * Returns top senders and top receivers. For now, returns empty arrays if no data.
 */
router.get("/:id/counterparties", async (req, res, next) => {
  try {
    const { id } = req.params;
    // Basic validation (same relaxed check as elsewhere)
    if (!id || typeof id !== "string" || !id.startsWith("G")) {
      const err = new Error("Invalid account ID.");
      err.isValidation = true;
      err.status = 400;
      return next(err);
    }
    // Verify account exists via Horizon (ignore errors for placeholder accounts)
    try {
      await server.loadAccount(id);
    } catch (e) {
      if (e.response && e.response.status === 404) {
        return next(makeAccountNotFoundError(id, NETWORK));
      }
      // For other errors, continue with empty data
    }
    // Placeholder implementation – return empty counterparties list
    return success(res, { topSenders: [], topReceivers: [] });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /account/:id/counterparty-summary
 *
 * Aggregate payment statistics per counterparty:
 *   - totalSent: total volume sent to counterparty (7-decimal string)
 *   - totalReceived: total volume received from counterparty (7-decimal string)
 *   - netPosition: net position (received - sent) (7-decimal string)
 *   - firstInteractionAt: timestamp of first interaction
 *   - lastInteractionAt: timestamp of last interaction
 *   - txCount: total number of interactions
 *
 * Query params:
 *   - limit: optional number between 1 and 100 (default 20)
 */
router.get("/:id/counterparty-summary", async (req, res, next) => {
  try {
    const { id } = req.params;

    // Validate account ID
    validateAccountId(id);

    // Validate limit (defaults to 20, max 100)
    let limit = 20;
    if (req.query.limit !== undefined) {
      limit = validateLimit(req.query.limit, 100);
    }

    // Verify account exists via Horizon (returns 404 for non-existent accounts)
    try {
      await server.loadAccount(id);
    } catch (e) {
      if (e.response && e.response.status === 404) {
        return next(makeAccountNotFoundError(id, NETWORK));
      }
      return next(e);
    }

    // Fetch payments/operations history
    const counterpartyMap = new Map();
    let cursor;

    for (;;) {
      let query = server.payments();
      if (typeof query.forAccount === "function") {
        query = query.forAccount(id);
      }
      if (typeof query.limit === "function") {
        query = query.limit(200);
      }
      if (typeof query.order === "function") {
        query = query.order("asc");
      }
      if (cursor && typeof query.cursor === "function") {
        query = query.cursor(cursor);
      }

      const page = await query.call();
      const records = (page && page.records) || [];

      for (const op of records) {
        cursor = op.paging_token;
        if (op.transaction_successful === false) continue;

        let counterparty = null;
        let isOutbound = false;
        let isInbound = false;

        if (op.type === "create_account") {
          if (op.funder === id || op.from === id) {
            counterparty = op.account || op.to;
            isOutbound = true;
          } else if (op.account === id || op.to === id) {
            counterparty = op.funder || op.from;
            isInbound = true;
          }
        } else if (op.type === "account_merge") {
          if (op.account === id || op.from === id) {
            counterparty = op.into || op.to;
            isOutbound = true;
          } else if (op.into === id || op.to === id) {
            counterparty = op.account || op.from;
            isInbound = true;
          }
        } else if (op.from === id || op.to === id) {
          if (op.from === id) {
            counterparty = op.to;
            isOutbound = true;
          } else {
            counterparty = op.from;
            isInbound = true;
          }
        } else if (op.counterparty) {
          counterparty = op.counterparty;
          if (op.direction === "outbound" || op.direction === "sent" || op.direction === "out") {
            isOutbound = true;
          } else if (op.direction === "inbound" || op.direction === "received" || op.direction === "in") {
            isInbound = true;
          }
        }

        // Ignore self payments or operations without external counterparty
        if (!counterparty || counterparty === id) continue;

        let entry = counterpartyMap.get(counterparty);
        if (!entry) {
          entry = {
            address: counterparty,
            sent: 0,
            received: 0,
            txCount: 0,
            firstInteractionAt: op.created_at || null,
            lastInteractionAt: op.created_at || null,
          };
          counterpartyMap.set(counterparty, entry);
        }

        // Count every interaction towards txCount (not just payments)
        entry.txCount += 1;

        // Sum amount if present and valid
        const rawAmount = op.amount !== undefined ? op.amount : op.starting_balance;
        if (rawAmount !== undefined && rawAmount !== null) {
          const amount = parseFloat(rawAmount);
          if (!isNaN(amount) && amount > 0) {
            if (isOutbound) {
              entry.sent += amount;
            } else if (isInbound) {
              entry.received += amount;
            }
          }
        }

        // Track earliest and latest timestamps
        if (op.created_at) {
          if (!entry.firstInteractionAt || new Date(op.created_at) < new Date(entry.firstInteractionAt)) {
            entry.firstInteractionAt = op.created_at;
          }
          if (!entry.lastInteractionAt || new Date(op.created_at) > new Date(entry.lastInteractionAt)) {
            entry.lastInteractionAt = op.created_at;
          }
        }
      }

      if (records.length < 200) break;
      if (!cursor) break;
    }

    const counterparties = Array.from(counterpartyMap.values())
      .map((entry) => {
        let net = entry.received - entry.sent;
        if (Math.abs(net) < 1e-12) net = 0;
        return {
          address: entry.address,
          totalSent: entry.sent.toFixed(7),
          totalReceived: entry.received.toFixed(7),
          netPosition: net.toFixed(7),
          firstInteractionAt: entry.firstInteractionAt,
          lastInteractionAt: entry.lastInteractionAt,
          txCount: entry.txCount,
        };
      })
      .sort((a, b) => b.txCount - a.txCount)
      .slice(0, limit);

    return success(res, {
      accountId: id,
      counterparties,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
