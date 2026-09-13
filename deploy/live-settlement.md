# Faster management after a confirmed fill

This release changes receipt lookup from `finalized` to `confirmed`. A full
`getTransaction/jsonParsed` receipt is still required: wallet ownership, received
quantity, actual SOL delta and cashback accounting are checked before opening a
position. Jupiter's execute response alone never establishes a fill. Confirmed
is not finality and carries a small rollback risk; no `processed` receipt is used.

The isolated execution process runs settlement independently every second while
an execute HTTP request is pending. Recent pending receipts are polled at one
second intervals for the first 30 seconds, then every five seconds. Polling is
single-flight. A confirmed buy can immediately start exit quoting even while the
submission response is outstanding. A null receipt or accounting error does not
create a position or cause rebroadcast. Sell reasons are saved before broadcast
so a fast receipt cannot erase them. Failed sell fees are applied only once.

## Deployment and checks

Run the full Node test suite and typecheck, then deploy the collector with its
child process. No frontend build or environment change is required. Preserve the
existing database and enabled/paused state; do not create an extra signer.

For the next natural fill, inspect:

- `receipt.commitment`: `confirmed`.
- `openedAt`: chain transaction time (seconds precision).
- `managementStartedAt`: receipt persisted and position opened locally.
- `firstQuoteRequestedAt`: first exit quote request started.
- `firstValidQuoteAt`: first successful net quote available.
- `broadcastAt`, `executeReturnedAt`, `confirmedAt`: receipt may precede the
  execute response; the late response must not revert a terminal order.

Compare these intervals with the previous approximately 13-second delay. These
changes remove deliberate finality/polling waits but cannot promise a latency
bound for RPC availability, rate limits or network failures. The strategy remains
trail activation +40%, drawdown 10%, maximum hold 30 minutes, no fixed stop loss.

Reference: https://solana.com/developers/cookbook/transactions/confirmation
