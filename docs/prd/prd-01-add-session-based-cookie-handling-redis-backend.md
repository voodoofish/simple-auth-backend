# Product Requirements Document (PRD): Redis-Backed Session Authentication

**Document Status:** Draft
**Owner:** Platform Engineering
**Last Updated:** November 2026

---

## 1. Overview & Objectives

### 1.1 Problem Statement
The API currently authenticates browser requests with a JWT in a cookie. A stateless JWT cannot be revoked immediately across devices after a password reset or account deletion.

### 1.2 Proposed Solution
Replace JWT-cookie authentication with opaque, random session IDs in HTTP-only cookies and authentication-only session records in a dedicated Redis deployment. Redis is authoritative for session validity; there is no JWT or in-memory fallback. Roles remain authoritative in MariaDB and are cached separately in Redis.

### 1.3 Success Metrics
* **Redis latency:** Session middleware Redis operations add less than 5 ms at p99, measured from the application process and excluding MariaDB role-cache misses and application work.
* **Availability:** Target 99.95% for the session service. The production provider must define the availability measurement and demonstrate that it meets this target before implementation or release.
* **Deployments:** Routine application-server deployments do not delete or otherwise drop Redis sessions.
* **Security:** All deployed session cookies enforce `HttpOnly`, `Secure`, and `SameSite`; the deployed cookie uses the `__Host-` prefix. Local HTTP development is the only cookie-security exception.

---

## 2. Scope and User Stories

* **As an end user**, I want my authenticated session to survive application-server deployments.
* **As an end user**, I want my session to expire after inactivity and after a fixed maximum lifetime.
* **As a security engineer**, I want logout to revoke the current session and password/account security events to revoke all of a user's sessions.
* **As a backend engineer**, I want route authorization to consume a typed principal provided by session middleware rather than parsing credentials in individual middleware.

V1 creates sessions only after successful login. It does not create anonymous sessions or store general application state such as preferences or shopping carts.

---

## 3. Functional Requirements

### 3.1 Session Lifecycle
1. **Session creation and login**
   * After credentials are verified, generate a fresh 32-byte cryptographically random session ID and encode it as base64url (at least 256 bits of entropy).
   * A successful login always creates a new session ID, including account switches. If the request has an existing session cookie, delete that session after successful credential verification.
   * Store the authenticated user ID, per-session CSRF token, the user's authentication generation, and an absolute expiry timestamp in a Redis hash under `session:{session_id}`.
   * If the user's generation key does not yet exist during session creation, initialize it to `0` with the required TTL; do not initialize a missing generation key while authenticating an existing session.
   * Atomically create the session hash and its initial idle TTL. Do not set the cookie unless the Redis write and TTL both succeed.
   * The session ID is an unsigned opaque bearer secret. Do not HMAC-sign it.
   * Registration does not automatically create a session.

2. **Session expiration**
   * Defaults are a 30-minute idle timeout and a 12-hour absolute lifetime. Configure these with `SESSION_IDLE_TTL_SECONDS` (default `1800`) and `SESSION_ABSOLUTE_TTL_SECONDS` (default `43200`).
   * Validate both values at startup: both must be positive, the absolute lifetime must be at least the idle timeout, and the absolute lifetime must not exceed 24 hours.
   * Only successfully authenticated requests extend the idle TTL. Public requests do not count as authenticated activity.
   * Read the session and refresh its idle TTL atomically, and only if the session still exists. Reject a session whose absolute expiry has passed, even if its Redis idle TTL remains.
   * Refresh the browser cookie on authenticated responses. Its `Max-Age` must be no greater than the idle timeout or the remaining absolute lifetime, whichever is shorter.
   * Set the user authentication-generation key TTL to the configured absolute lifetime plus one hour (13 hours by default), refreshing it on session creation and generation changes. If an existing session's generation key is missing, fail closed and reject that session.

3. **Session identity and authorization**
   * Session middleware validates the session and attaches a typed authenticated principal, including the user ID, to the request context.
   * Permission middleware consumes this principal; it must not read or parse the cookie directly.
   * A generation change prevents new authorization checks from accepting sessions with an older generation. A request that already passed its authorization check may finish in flight.

4. **Session revocation**
   * **Logout:** Revoke only the current session. Logout is idempotent: delete a live session if present, always clear the browser cookie, and return success when deletion is confirmed or the session was already absent.
   * If Redis cannot confirm logout deletion, clear the local cookie but return `503 Service Unavailable`; do not report server-side revocation as successful.
   * **All-session revocation:** Increment the per-user authentication-generation counter on password reset, an administrator-set password change, and account deletion. Increment it before the associated database mutation. If Redis cannot confirm the increment, do not apply the database mutation. If the database transaction subsequently fails, sessions may still be revoked; this is an accepted fail-closed outcome.
   * Consume a password-reset token and update the password in one MariaDB transaction after the generation increment.
   * A potentially stale Redis restore must invalidate all session and authentication-generation records; users must authenticate again. Rebuild disposable role-cache entries as needed.
   * Missing, expired, or revoked sessions return `401 Unauthorized` and clear the session cookie. Authenticated requests failing authorization or CSRF validation return `403 Forbidden`. Redis failures return `503 Service Unavailable`.

5. **Role cache**
   * MariaDB remains authoritative for role assignments; users may have multiple roles.
   * Use read-through caching with `user_role:{user_id}` as the key and a JSON array of role names as the value. The key TTL is fixed at 300 seconds; it is not configurable.
   * On cache miss or cache access error, read roles from MariaDB and proceed if that read succeeds. Cache population is best effort. If the database role lookup also fails, fail the request.
   * After a role update commits, delete the user's role-cache key. Also invalidate it after account deletion. A failed invalidation after commit returns an explicit `503` partial-failure response and is logged/alerted; the database change may already have taken effect.
   * Invalidation is best effort. The 300-second TTL bounds each cache entry's lifetime, but a concurrent cache miss can repopulate stale data after a delete; this is not a strict five-minute bound measured from the database commit.
   * Role changes do not increment the authentication generation or rotate session IDs.

### 3.2 CSRF and Origin Protection
* Generate a 32-byte cryptographically random CSRF token per session and encode it as base64url. Store it in the session hash, never in the session cookie.
* Return the token in the successful login response and from an authenticated `GET /auth/csrf` endpoint so the client can recover it after a page reload. Responses containing the token must set `Cache-Control: no-store`.
* Require the token in the `X-CSRF-Token` header on every authenticated state-changing request. Compare tokens in constant time after validating equal lengths. Missing or invalid tokens return `403 Forbidden`.
* Rotate the CSRF token whenever login creates a new session.
* Do not create pre-authentication CSRF sessions. For browser state-changing requests, including unauthenticated routes, require and validate an allowlisted `Origin` when Fetch Metadata identifies a browser request. If both Origin and Fetch Metadata are absent, allow non-browser clients; any supplied Origin must still be allowlisted.
* Do not rely on `SameSite` alone for CSRF protection.

---

## 4. Technical Specifications

### 4.1 Redis Data Model
Use a Redis hash for each authentication session:

* **Session key:** `session:{session_id}`
* **Fields:** `user_id` (string), `csrf_token` (string), `auth_generation` (integer), and `absolute_expires_at` (Unix timestamp in seconds).
* Do not store roles, `created_at`, or `last_accessed_at` in the session hash. Redis TTL tracks inactivity; the absolute-expiry timestamp enforces the hard lifetime.
* **Authentication-generation key:** `user_auth_generation:{user_id}` (integer value); its TTL is the configured absolute session lifetime plus one hour.
* **Role-cache key:** `user_role:{user_id}` (JSON array, 300-second TTL).
* Internal immutable user IDs may appear in the role-cache and generation key names. Do not include names, email addresses, or other direct personal data in Redis key names or cookie values.
* Use `noeviction`. Provision and monitor memory so Redis write failures are surfaced rather than silently evicting active sessions.
* Atomically create a session hash with its TTL, and atomically read a session while refreshing its TTL only if it exists. A Redis transaction/script is acceptable; a non-atomic pipeline is not sufficient for these operations.

### 4.2 Cookie Configuration
For deployed environments:

* **Name:** `__Host-sid`
* **Value:** Unsigned opaque session ID only.
* **HttpOnly:** `true`
* **Secure:** `true`
* **SameSite:** `Lax` for the supported same-site web client.
* **Path:** `/`; do not set a `Domain` attribute.
* **Max-Age:** Sliding idle expiry, capped by the remaining absolute lifetime.

For local HTTP development only, use an unprefixed cookie name (`sid`) and permit `Secure=false`. The browser-extension origin currently in the codebase is not an authenticated V1 client and must not be included in the V1 default origin allowlist. Extension authentication requires a separate future design.

### 4.3 Redis Client and Configuration
* Use the `redis` (node-redis) client.
* Create one shared Redis client per application worker/process; do not open a connection per request or require a traditional pool.
* Use `REDIS_URL` consistently. Host-run local development uses the loopback-published Compose port; an application running inside Compose uses the Redis service hostname and container port. Production uses a TLS URL (`rediss://`) and credentials supplied by the deployment secret manager.
* Validate `REDIS_URL` at startup. Do not fall back to JWT or in-memory authentication.
* Required command families include hash operations and expiry for sessions, GET/SET/INCR/expiry for generation and role-cache data, and DEL for revocation. Restrict Redis ACLs to the required commands and `session:*`, `user_auth_generation:*`, and `user_role:*` key patterns.

### 4.4 Local Compose
* Use a pinned core Redis server image; Redis Stack and Redis Insight are not required.
* Bind the host port to loopback only (`127.0.0.1:6380:6379`) for the documented host-run development workflow. Do not expose Redis on all host interfaces.
* Local Redis may omit authentication only while it remains on the isolated Compose network and its host port is loopback-only. Production and shared Redis require authentication and least-privilege ACLs.

---

## 5. Non-Functional Requirements

### 5.1 Performance and Failure Handling
* Measure the `< 5 ms` p99 target for session middleware Redis operations only, excluding database role-cache misses and application work.
* Bound Redis operations for authenticated requests to a 200 ms total deadline. Do not use an unbounded offline command queue or retries. Return `503 Service Unavailable` when a required session operation exceeds the deadline or Redis is unavailable.
* A role-cache error may fall back to MariaDB after session validation; a session-store error may not fall back to JWT or process memory.

### 5.2 Availability and Recovery
* Target 99.95% session-service availability. The provider/topology and the exact availability measurement must be selected and documented before implementation or release.
* Require provider-supported persistence for ordinary node restarts. A catastrophic Redis data-loss or rollback event may require users to log in again; zero loss across failover is not guaranteed.
* If Redis is unavailable at startup, validate configuration and keep the service unready until Redis connects. At runtime, liveness reports process health separately from Redis-aware readiness.
* The production Redis deployment must be dedicated to authentication session, generation, and role-cache data. Require private-network access, TLS with certificate and hostname verification, Redis authentication/least-privilege ACLs, encryption at rest for data and backups, and secret-manager storage for credentials.
* Select a production provider/topology before implementation or release that meets the persistence, security, availability, and recovery requirements. This PRD does not choose managed Redis, Sentinel, or Cluster.

### 5.3 Security, Privacy, and Observability
* Always issue a fresh session ID on successful login/account switch. Do not create anonymous sessions or reuse a client-provided ID.
* Never log session IDs, cookie values, CSRF tokens, Redis credentials/URLs, or raw session records. Use aggregate metrics for latency, role-cache hits/misses, Redis failures, and revocation outcomes without user or session identifiers.
* Invalidate all sessions after recovery from a Redis restore that may have rolled state backward.

### 5.4 Testing
* Add automated tests using Vitest and Supertest.
* Include Redis/MariaDB integration coverage for login and ID rotation, cookie attributes, idle/absolute expiry, CSRF and Origin checks, logout, generation-based revocation, stale-restore behavior, role-cache TTL/invalidation/fallback, and Redis failure responses.
* A CI workflow is not part of this PRD; tests must be runnable locally with isolated dependencies.

---

## 6. Migration and Out of Scope

### 6.1 JWT Migration
* Existing clients receive a one-time re-authentication when moving from the `auth` JWT cookie to `__Host-sid`.
* Do not accept legacy JWT cookies or run a dual-auth period. Coordinate cutover by draining/stopping old JWT-auth workers before routing normal traffic to the new version.
* Clear the legacy `auth` cookie during cutover using its existing cookie attributes.
* Remove JWT authentication code, `ACCESS_TOKEN`/`EXP_TOKEN` settings, and the `jsonwebtoken` authentication dependency. Retain the separate password-reset token expiry setting.

### 6.2 Out of Scope
* Anonymous/pre-login sessions and general-purpose session state such as preferences or shopping carts.
* Browser-extension authentication; it requires a separate future design. V1 supports same-site web clients only.
* Multi-device session management UI.
* Explicit application-worker graceful-shutdown/drain work and CI workflow setup.
* Selecting a specific production Redis provider/topology in this PRD; that decision is a prerequisite before implementation or release.

---