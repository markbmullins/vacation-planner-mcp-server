/**
 * Tests for the shared config module.
 *
 * Covers:
 * - loadDotenv() — .env file loading and process.env population
 * - loadConfig() — required variable enforcement, optional defaults,
 *   invalid value rejection, and accumulated error reporting
 * - redactConfig() — secret field redaction
 * - redactDsn() — DSN credential stripping (userinfo and query params)
 * - integration availability helpers
 *
 * Uses Node's built-in test runner (node:test) and assertion library
 * (node:assert) so no additional test dependencies are needed.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadDotenv,
  loadConfig,
  redactConfig,
  redactDsn,
  ConfigError,
  isFlightProviderEnabled,
  isAccommodationProviderEnabled,
  isRedditResearchEnabled,
  isGoogleCalendarEnabled,
} from "./index.js";

// ---------------------------------------------------------------------------
// Minimal valid env that satisfies all required fields
// ---------------------------------------------------------------------------

function validEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    DATABASE_URL: "postgres://user:pass@localhost:5432/dive_planner",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// loadDotenv — .env file loading
// ---------------------------------------------------------------------------

describe("loadDotenv", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dive-planner-config-test-"));
    // Snapshot any env vars we might clobber.
    savedEnv = {
      DOTENV_TEST_KEY: process.env["DOTENV_TEST_KEY"],
      DOTENV_TEST_QUOTED: process.env["DOTENV_TEST_QUOTED"],
      DOTENV_EXISTING: process.env["DOTENV_EXISTING"],
      DOTENV_OVERLAY_KEY: process.env["DOTENV_OVERLAY_KEY"],
      NODE_ENV: process.env["NODE_ENV"],
    };
  });

  after(() => {
    // Restore env vars after this suite.
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("loads KEY=value pairs from a .env file into process.env", () => {
    delete process.env["DOTENV_TEST_KEY"];
    const envFile = join(tmpDir, ".env.basic");
    writeFileSync(envFile, "DOTENV_TEST_KEY=hello\n");
    loadDotenv(envFile, { envName: "" });
    assert.strictEqual(process.env["DOTENV_TEST_KEY"], "hello");
  });

  it("strips double-quotes from quoted values", () => {
    delete process.env["DOTENV_TEST_QUOTED"];
    const envFile = join(tmpDir, ".env.quoted");
    writeFileSync(envFile, 'DOTENV_TEST_QUOTED="world"\n');
    loadDotenv(envFile, { envName: "" });
    assert.strictEqual(process.env["DOTENV_TEST_QUOTED"], "world");
  });

  it("does not overwrite existing process.env variables by default", () => {
    process.env["DOTENV_EXISTING"] = "original";
    const envFile = join(tmpDir, ".env.nooverride");
    writeFileSync(envFile, "DOTENV_EXISTING=new-value\n");
    loadDotenv(envFile, { envName: "" });
    assert.strictEqual(process.env["DOTENV_EXISTING"], "original");
  });

  it("overwrites existing variables when override=true", () => {
    process.env["DOTENV_EXISTING"] = "original";
    const envFile = join(tmpDir, ".env.override");
    writeFileSync(envFile, "DOTENV_EXISTING=replaced\n");
    loadDotenv(envFile, { override: true, envName: "" });
    assert.strictEqual(process.env["DOTENV_EXISTING"], "replaced");
  });

  it("ignores comment lines starting with #", () => {
    delete process.env["DOTENV_TEST_KEY"];
    const envFile = join(tmpDir, ".env.comments");
    writeFileSync(envFile, "# this is a comment\nDOTENV_TEST_KEY=from-file\n");
    loadDotenv(envFile, { envName: "" });
    assert.strictEqual(process.env["DOTENV_TEST_KEY"], "from-file");
  });

  it("silently returns when the file is missing and silent=true", () => {
    assert.doesNotThrow(() => {
      loadDotenv("/nonexistent/.env", { silent: true, envName: "" });
    });
  });

  it("returns without throwing when the file is missing and silent=false", () => {
    // Should warn to stderr but not throw.
    assert.doesNotThrow(() => {
      loadDotenv("/nonexistent/.env", { silent: false, envName: "" });
    });
  });

  it("populates process.env so that a subsequent loadConfig picks up values", () => {
    delete process.env["DOTENV_TEST_KEY"];
    const envFile = join(tmpDir, ".env.loadconfig");
    writeFileSync(
      envFile,
      [
        "DATABASE_URL=postgres://envuser:envpass@envhost:5432/envdb",
        "REDIS_URL=redis://envredis:6380",
      ].join("\n"),
    );
    // Temporarily remove DATABASE_URL to ensure it comes from the file.
    const prevDb = process.env["DATABASE_URL"];
    const prevRedis = process.env["REDIS_URL"];
    delete process.env["DATABASE_URL"];
    delete process.env["REDIS_URL"];
    try {
      loadDotenv(envFile, { envName: "" });
      const cfg = loadConfig();
      assert.strictEqual(cfg.database.url, "postgres://envuser:envpass@envhost:5432/envdb");
      assert.strictEqual(cfg.redis.url, "redis://envredis:6380");
    } finally {
      if (prevDb !== undefined) process.env["DATABASE_URL"] = prevDb;
      else delete process.env["DATABASE_URL"];
      if (prevRedis !== undefined) process.env["REDIS_URL"] = prevRedis;
      else delete process.env["REDIS_URL"];
    }
  });
});

// ---------------------------------------------------------------------------
// loadDotenv — per-environment overlay loading
// ---------------------------------------------------------------------------

describe("loadDotenv — per-environment overlay", () => {
  let tmpDir: string;
  let savedEnv: Record<string, string | undefined>;

  before(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "dive-planner-env-overlay-"));
    savedEnv = {
      DOTENV_BASE_VAR: process.env["DOTENV_BASE_VAR"],
      DOTENV_OVERLAY_VAR: process.env["DOTENV_OVERLAY_VAR"],
      DOTENV_OVERRIDE_VAR: process.env["DOTENV_OVERRIDE_VAR"],
      NODE_ENV: process.env["NODE_ENV"],
    };
  });

  after(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  });

  it("loads .env.<envName> overlay and its values take precedence over the base .env", () => {
    delete process.env["DOTENV_BASE_VAR"];
    delete process.env["DOTENV_OVERLAY_VAR"];
    delete process.env["DOTENV_OVERRIDE_VAR"];

    const baseFile = join(tmpDir, ".env");
    const overlayFile = join(tmpDir, ".env.test");
    writeFileSync(baseFile, "DOTENV_BASE_VAR=base\nDOTENV_OVERRIDE_VAR=from-base\n");
    writeFileSync(overlayFile, "DOTENV_OVERLAY_VAR=from-overlay\nDOTENV_OVERRIDE_VAR=from-overlay\n");

    loadDotenv(baseFile, { envName: "test" });

    // Base-only var is populated from the base file.
    assert.strictEqual(process.env["DOTENV_BASE_VAR"], "base");
    // Overlay-only var is populated from the overlay file.
    assert.strictEqual(process.env["DOTENV_OVERLAY_VAR"], "from-overlay");
    // Overlay value wins over base file for the same key.
    assert.strictEqual(process.env["DOTENV_OVERRIDE_VAR"], "from-overlay");
  });

  it("uses NODE_ENV as the default envName when options.envName is not provided", () => {
    delete process.env["DOTENV_BASE_VAR"];
    delete process.env["DOTENV_OVERLAY_VAR"];

    process.env["NODE_ENV"] = "development";
    const baseFile = join(tmpDir, ".env.nodeenv-base");
    const overlayFile = join(tmpDir, ".env.development");
    writeFileSync(baseFile, "DOTENV_BASE_VAR=base-nodeenv\n");
    writeFileSync(overlayFile, "DOTENV_OVERLAY_VAR=from-development-overlay\n");

    loadDotenv(baseFile);

    assert.strictEqual(process.env["DOTENV_BASE_VAR"], "base-nodeenv");
    assert.strictEqual(process.env["DOTENV_OVERLAY_VAR"], "from-development-overlay");
  });

  it("overlay file absence is silent — does not throw or warn", () => {
    delete process.env["DOTENV_BASE_VAR"];
    const baseFile = join(tmpDir, ".env.no-overlay-base");
    writeFileSync(baseFile, "DOTENV_BASE_VAR=base-only\n");

    // "staging" overlay does not exist — should not throw.
    assert.doesNotThrow(() => {
      loadDotenv(baseFile, { envName: "staging" });
    });
    assert.strictEqual(process.env["DOTENV_BASE_VAR"], "base-only");
  });

  it("passing envName='' disables overlay loading entirely", () => {
    delete process.env["DOTENV_BASE_VAR"];
    delete process.env["DOTENV_OVERLAY_VAR"];

    const baseFile = join(tmpDir, ".env.no-overlay-empty");
    const overlayFile = join(tmpDir, ".env.");
    writeFileSync(baseFile, "DOTENV_BASE_VAR=base-empty-env\n");
    // Even if a file named ".env." somehow existed, it must not be loaded.
    writeFileSync(overlayFile, "DOTENV_OVERLAY_VAR=should-not-be-loaded\n");

    loadDotenv(baseFile, { envName: "" });

    assert.strictEqual(process.env["DOTENV_BASE_VAR"], "base-empty-env");
    assert.strictEqual(process.env["DOTENV_OVERLAY_VAR"], undefined);
  });

  it("overlay does not overwrite variables already present in the process environment", () => {
    // Real environment always wins: base sets a var, overlay tries to override,
    // but the process env value should be preserved.
    process.env["DOTENV_OVERRIDE_VAR"] = "process-env-value";

    const baseFile = join(tmpDir, ".env.process-wins");
    const overlayFile = join(tmpDir, ".env.production");
    writeFileSync(baseFile, "DOTENV_OVERRIDE_VAR=base-value\n");
    writeFileSync(overlayFile, "DOTENV_OVERRIDE_VAR=overlay-value\n");

    loadDotenv(baseFile, { envName: "production" });

    // Process env takes precedence over both base and overlay files.
    assert.strictEqual(process.env["DOTENV_OVERRIDE_VAR"], "process-env-value");
  });
});

// ---------------------------------------------------------------------------
// loadConfig — required variable enforcement
// ---------------------------------------------------------------------------

describe("loadConfig — required variables", () => {
  it("throws ConfigError when DATABASE_URL is missing", () => {
    assert.throws(
      () => loadConfig({}),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError, "expected ConfigError");
        assert.match(err.message, /DATABASE_URL/);
        return true;
      },
    );
  });

  it("throws ConfigError when DATABASE_URL is blank", () => {
    assert.throws(
      () => loadConfig({ DATABASE_URL: "   " }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        return true;
      },
    );
  });

  it("does not throw when all required variables are set", () => {
    assert.doesNotThrow(() => loadConfig(validEnv()));
  });
});

// ---------------------------------------------------------------------------
// loadConfig — optional variable defaults
// ---------------------------------------------------------------------------

describe("loadConfig — optional variable defaults", () => {
  it("defaults server.port to 3000", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.server.port, 3000);
  });

  it("defaults server.logLevel to 'info'", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.server.logLevel, "info");
  });

  it("defaults worker.concurrency to 2", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.worker.concurrency, 2);
  });

  it("defaults redis.host to 'localhost'", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.redis.host, "localhost");
  });

  it("defaults redis.port to 6379", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.redis.port, 6379);
  });

  it("defaults redis.url to undefined when absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.redis.url, undefined);
  });

  it("reads REDIS_URL when provided", () => {
    const cfg = loadConfig(validEnv({ REDIS_URL: "redis://redis-host:6380/1" }));
    assert.strictEqual(cfg.redis.url, "redis://redis-host:6380/1");
  });

  it("defaults redis.password to undefined when absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.redis.password, undefined);
  });

  it("defaults integration fields to undefined when absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(cfg.integrations.flightProviderApiKey, undefined);
    assert.strictEqual(cfg.integrations.accommodationProviderApiKey, undefined);
    assert.strictEqual(cfg.integrations.redditResearchMcpUrl, undefined);
    assert.strictEqual(cfg.integrations.googleClientId, undefined);
    assert.strictEqual(cfg.integrations.googleClientSecret, undefined);
  });

  it("reads overridden optional values correctly", () => {
    const cfg = loadConfig(
      validEnv({
        MCP_SERVER_PORT: "4000",
        LOG_LEVEL: "debug",
        WORKER_CONCURRENCY: "5",
        REDIS_HOST: "redis-host",
        REDIS_PORT: "6380",
        REDIS_PASSWORD: "secret",
        REDIS_USERNAME: "ruser",
        REDIS_DB: "1",
      }),
    );
    assert.strictEqual(cfg.server.port, 4000);
    assert.strictEqual(cfg.server.logLevel, "debug");
    assert.strictEqual(cfg.worker.concurrency, 5);
    assert.strictEqual(cfg.redis.host, "redis-host");
    assert.strictEqual(cfg.redis.port, 6380);
    assert.strictEqual(cfg.redis.password, "secret");
    assert.strictEqual(cfg.redis.username, "ruser");
    assert.strictEqual(cfg.redis.db, 1);
  });
});

// ---------------------------------------------------------------------------
// loadConfig — URL format validation
// ---------------------------------------------------------------------------

describe("loadConfig — URL format validation", () => {
  it("accepts a well-formed postgres:// DATABASE_URL", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ DATABASE_URL: "postgres://user:pass@localhost:5432/db" })),
    );
  });

  it("accepts a well-formed postgresql:// DATABASE_URL", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ DATABASE_URL: "postgresql://localhost:5432/db" })),
    );
  });

  it("rejects a malformed DATABASE_URL that is not a URL", () => {
    assert.throws(
      () => loadConfig(validEnv({ DATABASE_URL: "not-a-url" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        assert.match(err.message, /valid URL/);
        return true;
      },
    );
  });

  it("rejects a DATABASE_URL with a non-postgres scheme", () => {
    assert.throws(
      () => loadConfig(validEnv({ DATABASE_URL: "mysql://localhost:3306/db" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        return true;
      },
    );
  });

  it("rejects a DATABASE_URL that is only a hostname without scheme", () => {
    assert.throws(
      () => loadConfig(validEnv({ DATABASE_URL: "localhost:5432/db" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        return true;
      },
    );
  });

  it("accepts a well-formed redis:// REDIS_URL when provided", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ REDIS_URL: "redis://localhost:6379" })),
    );
  });

  it("accepts a well-formed rediss:// REDIS_URL when provided", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ REDIS_URL: "rediss://redis-host:6380/0" })),
    );
  });

  it("rejects a malformed REDIS_URL that is not a URL", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDIS_URL: "not-a-url" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDIS_URL/);
        assert.match(err.message, /valid URL/);
        return true;
      },
    );
  });

  it("rejects a REDIS_URL with an unrecognised scheme", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDIS_URL: "http://localhost:6379" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDIS_URL/);
        return true;
      },
    );
  });

  it("does not reject an absent REDIS_URL — it is optional", () => {
    assert.doesNotThrow(() => loadConfig(validEnv()));
  });

  it("accepts a well-formed http:// REDDIT_RESEARCH_MCP_URL when provided", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ REDDIT_RESEARCH_MCP_URL: "http://localhost:9000" })),
    );
  });

  it("accepts a well-formed https:// REDDIT_RESEARCH_MCP_URL when provided", () => {
    assert.doesNotThrow(() =>
      loadConfig(validEnv({ REDDIT_RESEARCH_MCP_URL: "https://research.example.com/mcp" })),
    );
  });

  it("rejects a malformed REDDIT_RESEARCH_MCP_URL that is not a URL", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDDIT_RESEARCH_MCP_URL: "not-a-url" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDDIT_RESEARCH_MCP_URL/);
        assert.match(err.message, /valid URL/);
        return true;
      },
    );
  });

  it("rejects a REDDIT_RESEARCH_MCP_URL with an unrecognised scheme", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDDIT_RESEARCH_MCP_URL: "ftp://localhost:9000" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDDIT_RESEARCH_MCP_URL/);
        return true;
      },
    );
  });

  it("does not reject an absent REDDIT_RESEARCH_MCP_URL — it is optional", () => {
    assert.doesNotThrow(() => loadConfig(validEnv()));
  });

  it("accumulates URL validation errors together with other errors", () => {
    assert.throws(
      () =>
        loadConfig({
          DATABASE_URL: "not-a-db-url",
          REDIS_URL: "not-a-redis-url",
          REDDIT_RESEARCH_MCP_URL: "not-a-url",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        assert.match(err.message, /REDIS_URL/);
        assert.match(err.message, /REDDIT_RESEARCH_MCP_URL/);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — invalid value rejection
// ---------------------------------------------------------------------------

describe("loadConfig — invalid value rejection", () => {
  it("throws ConfigError for non-integer MCP_SERVER_PORT", () => {
    assert.throws(
      () => loadConfig(validEnv({ MCP_SERVER_PORT: "abc" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /MCP_SERVER_PORT/);
        return true;
      },
    );
  });

  it("throws ConfigError for non-positive MCP_SERVER_PORT", () => {
    assert.throws(
      () => loadConfig(validEnv({ MCP_SERVER_PORT: "0" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /MCP_SERVER_PORT/);
        return true;
      },
    );
  });

  it("throws ConfigError for invalid LOG_LEVEL value", () => {
    assert.throws(
      () => loadConfig(validEnv({ LOG_LEVEL: "verbose" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /LOG_LEVEL/);
        return true;
      },
    );
  });

  it("throws ConfigError for non-integer WORKER_CONCURRENCY", () => {
    assert.throws(
      () => loadConfig(validEnv({ WORKER_CONCURRENCY: "1.5" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /WORKER_CONCURRENCY/);
        return true;
      },
    );
  });

  it("throws ConfigError for non-integer REDIS_PORT", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDIS_PORT: "not-a-port" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDIS_PORT/);
        return true;
      },
    );
  });

  it("throws ConfigError for negative REDIS_DB", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDIS_DB: "-1" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDIS_DB/);
        return true;
      },
    );
  });

  it("throws ConfigError for non-integer REDIS_DB", () => {
    assert.throws(
      () => loadConfig(validEnv({ REDIS_DB: "two" })),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /REDIS_DB/);
        return true;
      },
    );
  });

  it("accumulates multiple errors into a single ConfigError", () => {
    assert.throws(
      () =>
        loadConfig({
          // Missing DATABASE_URL (required) + invalid LOG_LEVEL
          LOG_LEVEL: "bad",
        }),
      (err: unknown) => {
        assert.ok(err instanceof ConfigError);
        assert.match(err.message, /DATABASE_URL/);
        assert.match(err.message, /LOG_LEVEL/);
        return true;
      },
    );
  });
});

// ---------------------------------------------------------------------------
// loadConfig — accepts all valid LOG_LEVEL values
// ---------------------------------------------------------------------------

describe("loadConfig — LOG_LEVEL enumeration", () => {
  for (const level of ["error", "warn", "info", "debug"] as const) {
    it(`accepts LOG_LEVEL=${level}`, () => {
      const cfg = loadConfig(validEnv({ LOG_LEVEL: level }));
      assert.strictEqual(cfg.server.logLevel, level);
    });
  }
});

// ---------------------------------------------------------------------------
// redactDsn
// ---------------------------------------------------------------------------

describe("redactDsn", () => {
  it("strips username and password from a full Postgres DSN", () => {
    const result = redactDsn("postgres://admin:s3cr3t@db.example.com:5432/mydb");
    assert.ok(!result.includes("admin"), "username must not appear");
    assert.ok(!result.includes("s3cr3t"), "password must not appear");
    assert.ok(result.includes("db.example.com"), "host should remain visible");
    assert.ok(result.includes("5432"), "port should remain visible");
    assert.ok(result.includes("mydb"), "database name should remain visible");
  });

  it("leaves a DSN without credentials unchanged", () => {
    const dsn = "postgres://localhost:5432/mydb";
    assert.strictEqual(redactDsn(dsn), dsn);
  });

  it("returns [REDACTED] for a non-URL string", () => {
    assert.strictEqual(redactDsn("not-a-url"), "[REDACTED]");
  });

  it("handles a DSN with only a username and no password", () => {
    const result = redactDsn("postgres://user@localhost/mydb");
    assert.ok(!result.includes("user"), "username must not appear");
    assert.ok(result.includes("localhost"), "host should remain visible");
  });

  it("redacts a password query parameter", () => {
    const result = redactDsn("postgres://localhost/mydb?password=secret");
    assert.ok(!result.includes("secret"), "password query param value must not appear");
    assert.ok(result.includes("password=[REDACTED]"), "parameter name should be preserved");
    assert.ok(result.includes("localhost"), "host should remain visible");
  });

  it("redacts a token query parameter", () => {
    const result = redactDsn("redis://localhost?token=abc123&db=0");
    assert.ok(!result.includes("abc123"), "token value must not appear");
    assert.ok(result.includes("token=[REDACTED]"), "parameter name should be preserved");
    assert.ok(result.includes("db=0"), "non-secret params should be unchanged");
  });

  it("redacts both userinfo and a secret query parameter", () => {
    const result = redactDsn("postgres://user:s3cr3t@host:5432/db?password=extra-secret");
    assert.ok(!result.includes("user"), "username must not appear");
    assert.ok(!result.includes("s3cr3t"), "userinfo password must not appear");
    assert.ok(!result.includes("extra-secret"), "query param secret value must not appear");
    assert.ok(result.includes("host"), "host should remain visible");
    assert.ok(result.includes("password=[REDACTED]"), "query param name should be preserved");
  });

  it("leaves non-secret query parameters unchanged", () => {
    const dsn = "postgres://localhost/mydb?sslmode=require&connect_timeout=10";
    const result = redactDsn(dsn);
    assert.ok(result.includes("sslmode=require"), "non-secret params must be preserved");
    assert.ok(result.includes("connect_timeout=10"), "non-secret params must be preserved");
  });
});

// ---------------------------------------------------------------------------
// redactConfig — field-level secret redaction
// ---------------------------------------------------------------------------

describe("redactConfig — secret field redaction", () => {
  it("redacts redis.password", () => {
    const cfg = loadConfig(validEnv({ REDIS_PASSWORD: "redis-secret" }));
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.redis.password, "[REDACTED]");
  });

  it("leaves redis.password as undefined when not set", () => {
    const cfg = loadConfig(validEnv());
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.redis.password, undefined);
  });

  it("redacts integrations.flightProviderApiKey", () => {
    const cfg = loadConfig(validEnv({ FLIGHT_PROVIDER_API_KEY: "flight-key" }));
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.integrations.flightProviderApiKey, "[REDACTED]");
  });

  it("redacts integrations.accommodationProviderApiKey", () => {
    const cfg = loadConfig(validEnv({ ACCOMMODATION_PROVIDER_API_KEY: "acc-key" }));
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.integrations.accommodationProviderApiKey, "[REDACTED]");
  });

  it("redacts integrations.googleClientSecret", () => {
    const cfg = loadConfig(
      validEnv({ GOOGLE_CLIENT_ID: "gcid", GOOGLE_CLIENT_SECRET: "gsecret" }),
    );
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.integrations.googleClientSecret, "[REDACTED]");
  });

  it("does not mutate the original config object", () => {
    const cfg = loadConfig(validEnv({ REDIS_PASSWORD: "original-password" }));
    redactConfig(cfg);
    assert.strictEqual(cfg.redis.password, "original-password");
  });
});

// ---------------------------------------------------------------------------
// redactConfig — redis.url credential stripping
// ---------------------------------------------------------------------------

describe("redactConfig — redis.url credential stripping", () => {
  it("strips credentials from redis.url containing username and password", () => {
    const cfg = loadConfig(
      validEnv({ REDIS_URL: "redis://ruser:rpass@redis-host:6380" }),
    );
    const redacted = redactConfig(cfg);
    assert.ok(redacted.redis.url !== undefined, "url field should be present");
    assert.ok(!redacted.redis.url!.includes("ruser"), "username must not appear");
    assert.ok(!redacted.redis.url!.includes("rpass"), "password must not appear");
    assert.ok(redacted.redis.url!.includes("redis-host"), "host should remain visible");
  });

  it("redacts password query param from redis.url", () => {
    const cfg = loadConfig(
      validEnv({ REDIS_URL: "redis://redis-host:6379?password=secret" }),
    );
    const redacted = redactConfig(cfg);
    assert.ok(redacted.redis.url !== undefined);
    assert.ok(!redacted.redis.url!.includes("secret"), "secret must not appear");
  });

  it("leaves redis.url undefined when not set", () => {
    const cfg = loadConfig(validEnv());
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.redis.url, undefined);
  });
});

// ---------------------------------------------------------------------------
// redactConfig — DATABASE_URL credential stripping
// ---------------------------------------------------------------------------

describe("redactConfig — database.url credential stripping", () => {
  it("strips credentials from database.url containing username and password", () => {
    const cfg = loadConfig(
      validEnv({ DATABASE_URL: "postgres://dbuser:dbpass@host:5432/dive" }),
    );
    const redacted = redactConfig(cfg);
    assert.ok(!redacted.database.url.includes("dbuser"), "username must not appear in logged url");
    assert.ok(!redacted.database.url.includes("dbpass"), "password must not appear in logged url");
    assert.ok(redacted.database.url.includes("host"), "host should remain visible");
    assert.ok(redacted.database.url.includes("dive"), "database name should remain visible");
  });

  it("leaves database.url unchanged when no credentials are embedded", () => {
    const dsn = "postgres://host:5432/dive";
    const cfg = loadConfig(validEnv({ DATABASE_URL: dsn }));
    const redacted = redactConfig(cfg);
    assert.strictEqual(redacted.database.url, dsn);
  });
});

// ---------------------------------------------------------------------------
// Integration availability helpers
// ---------------------------------------------------------------------------

describe("integration availability helpers", () => {
  it("isFlightProviderEnabled returns false when key is absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(isFlightProviderEnabled(cfg), false);
  });

  it("isFlightProviderEnabled returns true when key is set", () => {
    const cfg = loadConfig(validEnv({ FLIGHT_PROVIDER_API_KEY: "key" }));
    assert.strictEqual(isFlightProviderEnabled(cfg), true);
  });

  it("isAccommodationProviderEnabled returns false when key is absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(isAccommodationProviderEnabled(cfg), false);
  });

  it("isAccommodationProviderEnabled returns true when key is set", () => {
    const cfg = loadConfig(validEnv({ ACCOMMODATION_PROVIDER_API_KEY: "key" }));
    assert.strictEqual(isAccommodationProviderEnabled(cfg), true);
  });

  it("isRedditResearchEnabled returns false when URL is absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(isRedditResearchEnabled(cfg), false);
  });

  it("isRedditResearchEnabled returns true when URL is set", () => {
    const cfg = loadConfig(validEnv({ REDDIT_RESEARCH_MCP_URL: "http://localhost:9000" }));
    assert.strictEqual(isRedditResearchEnabled(cfg), true);
  });

  it("isGoogleCalendarEnabled returns false when both credentials are absent", () => {
    const cfg = loadConfig(validEnv());
    assert.strictEqual(isGoogleCalendarEnabled(cfg), false);
  });

  it("isGoogleCalendarEnabled returns false when only client ID is set", () => {
    const cfg = loadConfig(validEnv({ GOOGLE_CLIENT_ID: "id" }));
    assert.strictEqual(isGoogleCalendarEnabled(cfg), false);
  });

  it("isGoogleCalendarEnabled returns false when only client secret is set", () => {
    const cfg = loadConfig(validEnv({ GOOGLE_CLIENT_SECRET: "secret" }));
    assert.strictEqual(isGoogleCalendarEnabled(cfg), false);
  });

  it("isGoogleCalendarEnabled returns true when both credentials are set", () => {
    const cfg = loadConfig(
      validEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret" }),
    );
    assert.strictEqual(isGoogleCalendarEnabled(cfg), true);
  });
});
