import logger from "winston"
import { format } from "winston"

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
    level: 'error'
  })
)

export const log = logger
