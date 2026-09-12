# Isolated graduation discovery

Deploy the collector normally; no new port, credentials or systemd unit is
required. With ENABLE_STONK=true it supervises a separate discovery child in
addition to the existing signing child. The main Worker no longer starts a
second Stonk WebSocket, signature drain or candidate verifier. Discovery has
its own PID lock (`pump.db.discovery.live.lock`) and restarts after exit.

The child owns WebSocket receipt, durable signature queue, cached creation
proofs, chain verification, official candidate discovery and live-signal writes.
It never creates a signer or performs wallet research, token-history updates
or dashboard serialization. The parent materializes observations and metadata.
The signer can read durable signals every second even if IPC through the parent
is delayed. Start/pause state is forwarded to both children before the parent
starts heavy observation work.

Signature verification uses three migration slots and one creation slot.
Completed slots no longer wait for the slowest member of a batch. Recent
creation events get preference to warm proofs; every fourth creation turn
services oldest backlog. RPC retries retain the existing backoff. Short database
write failures while receiving WebSocket events retain notifications in memory
for retry; that pre-persistence buffer cannot survive a process crash. Durable
queues and the official candidate fallback still recover independently.

Diagnostics:
- `/api/dashboard.discoveryProcess`: PID, ready, lastStatusAt, running,
  helius/stonk status, bufferedNotifications and lastError.
- `live-signal.discoveryTiming`: receivedAt (null for non-WS discovery),
  verifyStartedAt, attempt, queueMs, creationCacheHit, RPC method/duration list,
  verifiedAt, eventDelayMs, verificationMs and totalMs.
- `stonk-signature.diagnostic`: latest attempt, including failed attempts.

queueMs is elapsed since the initial enqueue and INCLUDES earlier attempts and
backoff on retries. eventDelayMs starts at chain blockTime (second precision),
not transaction broadcast; it includes confirmation and provider delivery.
RPC durations are local elapsed time, not pure network latency. These fields
must not be presented as precise CPU attribution.

Verify after deployment: both child PIDs stay ready, one Stonk subscription
owner, live enablement unchanged, and a naturally arriving graduation yields
timing evidence. Compare new discovery delays with the prior 23.3s example.
No historical buy replay or real-money probe is needed.

Isolation removes shared JavaScript scheduling, not shared host CPU, disk,
SQLite contention or provider latency/limits. The 20-second entry deadline and
C exit policy (no fixed stop, trail40/10, 30min) remain unchanged. Late verified
signals can still be rejected; this release does not guarantee a fill.

Local offline check: `node scripts/check-discovery-process.mjs` starts a child
without credentials/network and blocks the parent for 6.2s, verifying that child
heartbeats continue. Functional tests separately exercise slots, cached proofs,
restart state and signal-before-observation behavior.
