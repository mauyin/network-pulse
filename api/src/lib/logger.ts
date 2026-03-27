/**
 * Lightweight structured logger for non-Fastify entry points (worker, CLI).
 * Fastify routes use app.log (pino) directly.
 */
export function createLogger(name: string) {
  const log = (level: string, obj: Record<string, unknown> | string, msg?: string) => {
    const entry: Record<string, unknown> = {
      level,
      name,
      time: new Date().toISOString(),
    };
    if (typeof obj === "string") {
      entry.msg = obj;
    } else {
      Object.assign(entry, obj);
      if (msg) entry.msg = msg;
    }
    console.log(JSON.stringify(entry));
  };

  return {
    info: (obj: Record<string, unknown> | string, msg?: string) => log("info", obj, msg),
    warn: (obj: Record<string, unknown> | string, msg?: string) => log("warn", obj, msg),
    error: (obj: Record<string, unknown> | string, msg?: string) => log("error", obj, msg),
    debug: (obj: Record<string, unknown> | string, msg?: string) => {
      if (process.env.LOG_LEVEL === "debug") log("debug", obj, msg);
    },
  };
}
