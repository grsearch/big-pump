# Verified graduation signals and C exits

Update collector and frontend together. The collector retains the existing
single signing child, auth configuration and wallet binding. Existing live
enablement is preserved; this release does not turn trading on automatically.

After chain verification of Stonk migration and creation within 20 minutes:
1. Save a compact `live-signal` (CA, verified pool/quote/creation evidence,
   migration signature, graduation time and `verifiedAt`).
2. Notify the signing child immediately. It reads signals independently of
   dashboard tokens; a one-second scan recovers missed IPC after restart.
3. Yield before writing the observation and enriching its metadata. Pending
   observation writes are recovered by the discovery worker after failures.

Signals retain the original graduation time and existing 20-second entry
deadline. No new trading signals are manufactured from pre-upgrade dashboard
records. Existing creation-event decoding already caches the chain creation
proof; when that proof is missing, verification still needs RPC history queries.
This release does not eliminate discovery latency before verification.

Buy orders now record `verifiedAt`, `signalReceivedAt` (buy processing start)
and detection delay relative to graduation. Compare these with the observation's
`enrolledAt`: observation creation is no longer a prerequisite for quoting.
Deterministic order IDs, persistent pre-broadcast intent and confirming-order
reconciliation continue to prevent duplicate sends.

C exits: no fixed stop loss or fixed take profit; +40% net return activates
trailing, 10% drawdown exits, maximum hold remains 30 minutes. Current open C
positions adopt this policy on their next exit check. Old unbroadcast -30% stop
intents are superseded with evidence retained; preparing stop orders are
cancelled. Already confirming sell orders remain under reconciliation, and
closed historical trades are not rewritten.

After deployment verify a NEW graduation signal is recorded before observation
creation, the child remains ready, and policy version is
`c-no-stop-trail40-10-time30-v2` with `stopLossPct: null`. Do not replay historical
signals or broadcast manual test trades. Re-measure discovery delay separately.
