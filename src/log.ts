import logger from "winston"
import { format } from "winston"
import Sentry from 'winston-transport-sentry-node';

logger.add(
  new logger.transports.Console({
    // format: logger.format.cli(),
    format: format.combine(format.timestamp(), format.cli(), format.simple()),
    level: process.env.LOG_LEVEL?.toLocaleLowerCase() || "info",
  }),
)

logger.add(
  new logger.transports.File({
    filename: 'logs/fatal.log',
    format: format.combine(format.timestamp(), format.simple()),
    level: 'error'
  })
)

if(process.env.SENTRY_DNS) {
  logger.add(
    new Sentry({
      sentry: {
        dsn: process.env.SENTRY_DNS,
      },
      format: format.combine(format.timestamp(), format.cli(), format.simple()),
      level: 'error'
    })
  )
}

export const log = logger
