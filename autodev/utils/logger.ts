type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const configuredLevel = (process.env.AUTODEV_LOG_LEVEL?.toLowerCase() as LogLevel | undefined) ?? "info";
const activeLevel = LOG_LEVELS[configuredLevel] ?? LOG_LEVELS.info;

type LogFields = Record<string, unknown>;

function normalizeFields(fields?: LogFields) {
  if (!fields) {
    return undefined;
  }

  const next: LogFields = { ...fields };

  if (next.error instanceof Error) {
    next.error = {
      name: next.error.name,
      message: next.error.message,
      stack: next.error.stack,
    };
  }

  return next;
}

function shouldLog(level: LogLevel) {
  return LOG_LEVELS[level] >= activeLevel;
}

function write(level: LogLevel, message: string, fields?: LogFields) {
  if (!shouldLog(level)) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(normalizeFields(fields) ?? {}),
  };

  const line = JSON.stringify(payload);

  if (level === "error") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  debug(message: string, fields?: LogFields) {
    write("debug", message, fields);
  },
  info(message: string, fields?: LogFields) {
    write("info", message, fields);
  },
  warn(message: string, fields?: LogFields) {
    write("warn", message, fields);
  },
  error(message: string, fields?: LogFields) {
    write("error", message, fields);
  },
  child(baseFields: LogFields) {
    return {
      debug(message: string, fields?: LogFields) {
        write("debug", message, { ...baseFields, ...(fields ?? {}) });
      },
      info(message: string, fields?: LogFields) {
        write("info", message, { ...baseFields, ...(fields ?? {}) });
      },
      warn(message: string, fields?: LogFields) {
        write("warn", message, { ...baseFields, ...(fields ?? {}) });
      },
      error(message: string, fields?: LogFields) {
        write("error", message, { ...baseFields, ...(fields ?? {}) });
      },
    };
  },
};
