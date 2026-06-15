---
name: project-server-t19
description: T-19 server.ts signals endpoints done — GET /api/signals + GET /api/signals/trend. 37/37 tests green.
metadata:
  type: project
---

T-19 DONE: Added two read-only signal endpoints to server.ts.

- `GET /api/signals` — optional filters: section (validated against VALID_SECTIONS Set), sinceMs, limit, minToneMag. Returns `SignalRow[]` camelCase (L-1).
- `GET /api/signals/trend` — section REQUIRED (400 if absent/invalid), optional since/bucket. Returns `SignalTrendPoint[]`.

Pattern: mirrors T-12 /api/events exactly — VALID_SECTIONS Set defined as constant, routes placed BEFORE 404, only `sendJson` helper used, no middleware touched.

**Why:** ADR-004/D-007/D-107 — SOLO-LECTURA from store; no connector dispatch on-request.
**How to apply:** Any future read-only endpoint in server.ts should follow the same pattern: define a validation constant, parse querystring with URL API, place route before 404, never touch middleware pipeline.
