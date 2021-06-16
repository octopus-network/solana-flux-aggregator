import * as Sentry from "@sentry/node";
import * as Tracing from "@sentry/tracing";
import { RewriteFrames } from "@sentry/integrations";

declare global {
  namespace NodeJS {
    interface Global {
      __rootdir__: string;
    }
  }
}

global.__rootdir__ = __dirname || process.cwd();

if (process.env.SENTRY_DNS) {
  Sentry.init({
    dsn: process.env.SENTRY_DNS,
    integrations: [
      new RewriteFrames({
        root: global.__rootdir__,
      }),
    ],
  });
}
