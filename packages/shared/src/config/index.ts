/**
 * Typed environment configuration for the Dive Vacation Planner.
 *
 * Design rules:
 * - All env reading is consolidated here; no module should call process.env directly.
 * - Required variables cause an immediate startup failure with a clear message.
 * - Optional variables resolve to typed defaults or undefined.
 * - Secrets (passwords, API keys, OAuth credentials) are never exposed in logs.
 * - loadDotenv() must be called at process startup before loadConfig().
 * - loadConfig() is idempotent and can be called multiple times safely.
 *
 * Per-environment loading:
 * - loadDotenv() loads `.env` by default (repo root).
 * - Pass `envName` (e.g. "development", "test", "production") to also load
 *   `.env.<envName>` from the same directory, which takes precedence over `.env`.
 * - NODE_ENV is used automatically when no explicit `envName` is given.
 * - Load order: base `.env` first (lower precedence), then `.env.<envName>`
 *   (higher precedence) — mirroring the standard dotenv convention.
 */

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Dotenv loader
// ---------------------------------------------------------------------------

/**
 * Parse a .env file and populate process.env with any variables that are not
 * already set.  Variables already present in the environment always take
 * precedence (consistent with the standard dotenv contract).
 *
 * The parser handles:
 *  - `KEY=value` (bare value)
 *  - `KEY="value"` or `KEY='value'` (quoted value, quotes stripped)
 *  - `# comment` lines (ignored)
 *  - blank lines (ignored)
 *  - inline comments after a quoted value are NOT supported intentionally to
 *    keep the parser minimal and avoid misparses.
 *
 * Per-environment loading:
 *   When `envName` is supplied (or NODE_ENV is set), a second file
 *   `.env.<envName>` is loaded from the same directory as the base file.
 *   The env-specific file is loaded after the base file and uses `override:
 *   true` internally so its values take precedence over the base file.
 *   This matches the standard dotenv layering convention:
 *     base `.env` < `.env.<envName>` < actual process environment
 *
 *   Recognised well-known environment names: development, test, production,
 *   staging.  Custom names are also accepted.
 *
 * @param envFilePath Absolute path to the base .env file.  Defaults to the
 *   repo root `.env` located five directory levels above this compiled file
 *   (`<repo-root>/.env`), which matches the project layout:
 *     <repo-root>/packages/shared/{dist|src}/config/index.{js|ts}
 *
 * @param options.override When true, values from the base file overwrite
 *   existing env vars.  The env-specific file always overrides the base file
 *   regardless of this flag.  Default false (existing env vars win).
 *
 * @param options.silent When true, absence of any .env file is silently
 *   ignored.  Default false (a missing file logs a warning but does not
 *   throw).
 *
 * @param options.envName Explicit environment name used to select the
 *   `.env.<envName>` overlay file.  When omitted, NODE_ENV is used.  Pass
 *   an empty string `""` to disable env-specific file loading entirely.
 */
export function loadDotenv(
  envFilePath?: string,
  options: { override?: boolean; silent?: boolean; envName?: string } = {},
): void {
  const { override = false, silent = false } = options;

  // Resolve the default path relative to this source file so it works from
  // any working directory when the process starts.
  //
  // Layout (both compiled and tsx):
  //   <repo-root>/packages/shared/{dist|src}/config/index.{js|ts}
  //
  // From the file path, resolve goes:
  //   index.{js|ts} -> .. -> config/ -> .. -> {dist|src}/ -> .. -> shared/
  //                -> .. -> packages/ -> .. -> <repo-root>/
  //
  // That is 5 ".." segments from the file pathname to reach the repo root.
  const basePath =
    envFilePath ?? resolve(new URL(import.meta.url).pathname, "../../../../../.env");

  // 1. Parse the base .env file into a map (missing file is handled per silent flag).
  const baseVars = parseDotenvFile(basePath, { silent });

  // 2. Determine the environment name for the overlay file.
  //    options.envName="" explicitly disables overlay loading.
  const envName = "envName" in options ? options.envName : process.env["NODE_ENV"];

  // 3. Parse the overlay file if an envName is provided.  The overlay is always
  //    loaded silently because it is expected to be absent in most environments.
  const overlayVars: Map<string, string> =
    envName
      ? parseDotenvFile(resolve(dirname(basePath), `.env.${envName}`), { silent: true })
      : new Map();

  // 4. Merge: overlay values take precedence over base values, but the real
  //    process environment always wins (unless override=true).
  //
  //    Precedence (lowest → highest):
  //      base file < overlay file < actual process environment (override=false)
  //      base file < overlay file → both beat process environment (override=true)
  const merged = new Map([...baseVars, ...overlayVars]);

  for (const [key, value] of merged) {
    if (override || process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/**
 * Internal helper: parses a single .env file into a key→value Map.
 * Does NOT write to process.env — the caller decides precedence and assignment.
 *
 * Returns an empty Map when the file cannot be read.
 */
function parseDotenvFile(
  targetPath: string,
  options: { silent: boolean },
): Map<string, string> {
  const { silent } = options;
  const result = new Map<string, string>();

  let raw: string;
  try {
    raw = readFileSync(targetPath, "utf8");
  } catch (err: unknown) {
    if (silent) return result;
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing .env is acceptable (CI injects vars directly); warn but continue.
      process.stderr.write(
        `[config] .env file not found at ${targetPath} — relying on process environment\n`,
      );
    } else {
      process.stderr.write(
        `[config] Failed to read .env file at ${targetPath}: ${String(err)}\n`,
      );
    }
    return result;
  }

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    // Skip blank lines and comments.
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue; // malformed line — skip

    const key = trimmed.slice(0, eqIdx).trim();
    if (!key) continue;

    let value = trimmed.slice(eqIdx + 1);

    // Strip wrapping quotes (single or double).
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    result.set(key, value);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function requireString(name: string, env: Record<string, string | undefined>): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new ConfigError(`Required environment variable ${name} is not set`);
  }
  return value.trim();
}

function optionalString(
  name: string,
  env: Record<string, string | undefined>,
  fallback?: string,
): string | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return value.trim();
}

function optionalInt(
  name: string,
  env: Record<string, string | undefined>,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ConfigError(
      `Environment variable ${name} must be a positive integer, got: ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function optionalLogLevel(
  name: string,
  env: Record<string, string | undefined>,
  fallback: LogLevel,
): LogLevel {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = raw.trim().toLowerCase();
  if (value !== "error" && value !== "warn" && value !== "info" && value !== "debug") {
    throw new ConfigError(
      `Environment variable ${name} must be one of: error, warn, info, debug — got: ${JSON.stringify(raw)}`,
    );
  }
  return value as LogLevel;
}

/**
 * Validates that a string value is a well-formed URL with an accepted scheme.
 *
 * @param name   Environment variable name (used in error messages).
 * @param value  The raw string to validate.
 * @param acceptedSchemes  Set of URL schemes to allow, e.g. `["postgres:", "postgresql:"]`.
 *               Pass an empty array to accept any scheme.
 *
 * Throws `ConfigError` if the value cannot be parsed as a URL or if its
 * scheme is not in the accepted list.
 */
function validateUrl(name: string, value: string, acceptedSchemes: string[]): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new ConfigError(
      `Environment variable ${name} must be a valid URL, got: ${JSON.stringify(value)}`,
    );
  }
  if (acceptedSchemes.length > 0 && !acceptedSchemes.includes(parsed.protocol)) {
    throw new ConfigError(
      `Environment variable ${name} must use one of these schemes: ${acceptedSchemes.join(", ")} — got: ${JSON.stringify(parsed.protocol)}`,
    );
  }
}

/**
 * Requires a string env var and validates it as a URL with the given accepted
 * schemes.  Returns the raw (trimmed) value on success.  Throws ConfigError
 * on any failure so the caller's error-accumulation pattern works correctly.
 */
function requireUrl(
  name: string,
  env: Record<string, string | undefined>,
  acceptedSchemes: string[],
): string {
  const value = requireString(name, env);
  validateUrl(name, value, acceptedSchemes);
  return value;
}

/**
 * Reads an optional URL env var and validates its format when present.
 * Returns the trimmed string or `undefined` when absent/blank.
 * Throws ConfigError when the value is present but malformed.
 */
function optionalUrl(
  name: string,
  env: Record<string, string | undefined>,
  acceptedSchemes: string[],
): string | undefined {
  const value = optionalString(name, env);
  if (value === undefined) return undefined;
  validateUrl(name, value, acceptedSchemes);
  return value;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface DatabaseConfig {
  /** Full Postgres connection string */
  url: string;
}

export interface RedisConfig {
  /**
   * Full Redis connection string (e.g. `redis://localhost:6379`).
   * Used by BullMQ and ioredis when a DSN is preferred over individual fields.
   * Never logged in full — credentials are stripped before output.
   */
  url: string | undefined;
  host: string;
  port: number;
  /** Redis AUTH password — never logged */
  password: string | undefined;
  username: string | undefined;
  db: number | undefined;
}

export interface ServerConfig {
  port: number;
  logLevel: LogLevel;
}

export interface WorkerConfig {
  concurrency: number;
}

/**
 * External integration configs are all optional.
 * When a required credential is absent the integration is disabled and
 * the dependent capability degrades gracefully rather than crashing.
 */
export interface IntegrationConfig {
  flightProviderApiKey: string | undefined;
  accommodationProviderApiKey: string | undefined;
  redditResearchMcpUrl: string | undefined;
  googleClientId: string | undefined;
  /** Google OAuth client secret — never logged */
  googleClientSecret: string | undefined;
}

export interface AppConfig {
  database: DatabaseConfig;
  redis: RedisConfig;
  server: ServerConfig;
  worker: WorkerConfig;
  integrations: IntegrationConfig;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

/**
 * Names of fields that must never appear in logs as-is.
 * Add any new secret field names here.
 */
const SECRET_FIELD_NAMES = new Set([
  "password",
  "apiKey",
  "clientSecret",
  "googleClientSecret",
  "flightProviderApiKey",
  "accommodationProviderApiKey",
]);

/**
 * Field names whose string values are DSN/connection-string URLs that may
 * embed credentials in the form scheme://user:password@host/db.
 * These are not replaced wholesale — instead credentials are stripped from
 * the URL so the host and database name remain visible for diagnostics.
 */
const DSN_FIELD_NAMES = new Set(["url"]);

/**
 * Names of query-string parameters that are considered sensitive and must be
 * redacted from DSNs.  Add any new secret query-param names here.
 */
const SECRET_QUERY_PARAMS = new Set([
  "password",
  "secret",
  "token",
  "apikey",
  "api_key",
  "access_token",
  "client_secret",
]);

/**
 * Strips credentials from a URL-shaped DSN string so it can be safely logged.
 *
 * Two credential locations are handled:
 *  1. URL userinfo — `user:secret@` in the authority — replaced with `[REDACTED]@`.
 *  2. Query-string parameters whose names match SECRET_QUERY_PARAMS — values
 *     replaced with `[REDACTED]`.
 *
 * If the value cannot be parsed as a URL it is replaced entirely with
 * "[REDACTED]" to prevent any accidental credential exposure.
 *
 * Examples:
 *   postgres://user:secret@host:5432/mydb      ->  postgres://[REDACTED]@host:5432/mydb
 *   postgres://host:5432/mydb                  ->  postgres://host:5432/mydb  (unchanged)
 *   postgres://host/mydb?password=secret       ->  postgres://host/mydb?password=[REDACTED]
 *   redis://host?token=abc&db=0                ->  redis://host?token=[REDACTED]&db=0
 */
export function redactDsn(dsn: string): string {
  try {
    const url = new URL(dsn);
    let changed = false;

    // 1. Strip userinfo from the authority.
    if (url.username || url.password) {
      url.username = "[REDACTED]";
      url.password = "";
      changed = true;
    }

    // 2. Redact sensitive query-string parameters.
    // Build a new query string manually to avoid URLSearchParams percent-encoding
    // the "[REDACTED]" marker (it encodes "[" and "]" by default).
    const params = [...url.searchParams.entries()];
    const sensitiveKeys = params
      .map(([k]) => k)
      .filter((k) => SECRET_QUERY_PARAMS.has(k.toLowerCase()));

    if (sensitiveKeys.length > 0) {
      changed = true;
      const newParams = params
        .map(([k, v]) =>
          SECRET_QUERY_PARAMS.has(k.toLowerCase())
            ? `${encodeURIComponent(k)}=[REDACTED]`
            : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
        )
        .join("&");
      // Rebuild the URL string with the updated query.
      // Use the url object for everything except the search, which we override.
      url.search = ""; // clear so we can do string manipulation
      const base = url.toString().replace(/\?$/, "");
      return `${base}?${newParams}`;
    }

    return changed ? url.toString() : dsn;
  } catch {
    // Not a valid URL — return a safe placeholder rather than the raw value.
    return "[REDACTED]";
  }
}

type Redacted<T> = T extends string
  ? string
  : T extends object
    ? { [K in keyof T]: Redacted<T[K]> }
    : T;

/**
 * Returns a deep copy of the config object with all secret fields replaced by
 * "[REDACTED]" and DSN fields scrubbed of embedded credentials.
 * Use this when including config in structured log output.
 */
export function redactConfig(config: AppConfig): Redacted<AppConfig> {
  return redactValue(config) as Redacted<AppConfig>;
}

function redactValue(value: unknown, key?: string): unknown {
  if (key !== undefined && SECRET_FIELD_NAMES.has(key)) {
    return value === undefined ? undefined : "[REDACTED]";
  }
  if (key !== undefined && DSN_FIELD_NAMES.has(key) && typeof value === "string") {
    return redactDsn(value);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item));
  }
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    result[k] = redactValue(v, k);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Loads and validates all application configuration from process.env.
 *
 * Throws `ConfigError` synchronously if any required variable is absent
 * or any variable fails type validation. This causes fast startup failure
 * before any connections are established.
 *
 * The returned object is frozen to prevent accidental mutation after load.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const errors: string[] = [];

  function safeRequire(name: string): string {
    try {
      return requireString(name, env);
    } catch (err) {
      errors.push(err instanceof ConfigError ? err.message : String(err));
      return "";
    }
  }

  function safeOptionalInt(name: string, fallback: number): number {
    try {
      return optionalInt(name, env, fallback);
    } catch (err) {
      errors.push(err instanceof ConfigError ? err.message : String(err));
      return fallback;
    }
  }

  function safeLogLevel(name: string, fallback: LogLevel): LogLevel {
    try {
      return optionalLogLevel(name, env, fallback);
    } catch (err) {
      errors.push(err instanceof ConfigError ? err.message : String(err));
      return fallback;
    }
  }

  function safeRequireUrl(name: string, acceptedSchemes: string[]): string {
    try {
      return requireUrl(name, env, acceptedSchemes);
    } catch (err) {
      errors.push(err instanceof ConfigError ? err.message : String(err));
      return "";
    }
  }

  function safeOptionalUrl(
    name: string,
    acceptedSchemes: string[],
  ): string | undefined {
    try {
      return optionalUrl(name, env, acceptedSchemes);
    } catch (err) {
      errors.push(err instanceof ConfigError ? err.message : String(err));
      return undefined;
    }
  }

  const database: DatabaseConfig = {
    url: safeRequireUrl("DATABASE_URL", ["postgres:", "postgresql:"]),
  };

  const rawRedisDb = optionalString("REDIS_DB", env);
  const redisParsedDb =
    rawRedisDb !== undefined ? Number(rawRedisDb) : undefined;
  const redisDb =
    redisParsedDb !== undefined && Number.isInteger(redisParsedDb) && redisParsedDb >= 0
      ? redisParsedDb
      : rawRedisDb !== undefined
        ? (() => {
            errors.push(
              `Environment variable REDIS_DB must be a non-negative integer, got: ${JSON.stringify(rawRedisDb)}`,
            );
            return undefined;
          })()
        : undefined;

  const redis: RedisConfig = {
    url: safeOptionalUrl("REDIS_URL", ["redis:", "rediss:"]),
    host: optionalString("REDIS_HOST", env, "localhost") as string,
    port: safeOptionalInt("REDIS_PORT", 6379),
    password: optionalString("REDIS_PASSWORD", env),
    username: optionalString("REDIS_USERNAME", env),
    db: redisDb,
  };

  const server: ServerConfig = {
    port: safeOptionalInt("MCP_SERVER_PORT", 3000),
    logLevel: safeLogLevel("LOG_LEVEL", "info"),
  };

  const worker: WorkerConfig = {
    concurrency: safeOptionalInt("WORKER_CONCURRENCY", 2),
  };

  const integrations: IntegrationConfig = {
    flightProviderApiKey: optionalString("FLIGHT_PROVIDER_API_KEY", env),
    accommodationProviderApiKey: optionalString("ACCOMMODATION_PROVIDER_API_KEY", env),
    redditResearchMcpUrl: safeOptionalUrl("REDDIT_RESEARCH_MCP_URL", ["http:", "https:"]),
    googleClientId: optionalString("GOOGLE_CLIENT_ID", env),
    googleClientSecret: optionalString("GOOGLE_CLIENT_SECRET", env),
  };

  if (errors.length > 0) {
    throw new ConfigError(
      `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`,
    );
  }

  const config: AppConfig = {
    database,
    redis,
    server,
    worker,
    integrations,
  };

  return Object.freeze(config) as AppConfig;
}

// ---------------------------------------------------------------------------
// Integration availability helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the flight provider integration is configured.
 * Use this to gate functionality rather than checking keys directly.
 */
export function isFlightProviderEnabled(config: AppConfig): boolean {
  return config.integrations.flightProviderApiKey !== undefined;
}

/**
 * Returns true when the accommodation provider integration is configured.
 */
export function isAccommodationProviderEnabled(config: AppConfig): boolean {
  return config.integrations.accommodationProviderApiKey !== undefined;
}

/**
 * Returns true when the Reddit research MCP integration is configured.
 */
export function isRedditResearchEnabled(config: AppConfig): boolean {
  return config.integrations.redditResearchMcpUrl !== undefined;
}

/**
 * Returns true when Google Calendar integration is fully configured.
 * Both client ID and secret must be present.
 */
export function isGoogleCalendarEnabled(config: AppConfig): boolean {
  return (
    config.integrations.googleClientId !== undefined &&
    config.integrations.googleClientSecret !== undefined
  );
}
