# Dashboard load reduction

Deploy the frontend and collector together: list responses no longer contain
token history/execution details; updated clients fetch `/api/token/:ca` when a
drawer opens. Existing localhost and authenticated same-origin proxy paths stay
the same. No trading parameters or stored observation/audit data are changed.

Changes:
- SQLite projects large fields out before JavaScript parsing. Trade symbols use
  identity-only projections instead of reading all observation histories.
- Dashboard requests no longer perform database cleanup. The existing minute
  cleanup task remains responsible for expiration.
- Concurrent clients share one build and a five-second serialized cache. Heat
  has a fifteen-second cache, invalidated by a changed successful X collection
  timestamp; calculations yield between tokens. This cache is display-only.
- Browser polling waits for completion; failures back off to 10/20/30 seconds.
  Errors and last successful refresh are shown explicitly.

After deployment, hard-refresh browsers and make three sequential, authenticated
dashboard requests. Record status, response bytes and elapsed time without
printing credentials or the full body. Compare with the reported 18.7 MB
baseline. Check token detail charts/EMA and quote tax details still load. Observe
new graduation-to-enrollment latency and live child heartbeat separately: reducing
dashboard load does not guarantee the remaining discovery tasks fit 20 seconds.

Local regression fixture: 100 tokens × 2,880 history samples, raw token JSON
16,722,491 bytes; dashboard fixture 28,223 bytes. This excludes production wallet
and trade history sizes and is not a server performance benchmark.

Compression is optional transport optimization, not a replacement for reducing
collector CPU. Inspect the effective nginx configuration and actual
Content-Encoding before changing it: `gzip_proxied` alone does not establish
whether JSON compression is enabled (`gzip`, MIME types and request conditions
also matter). Keep authentication on both page and API routes.
