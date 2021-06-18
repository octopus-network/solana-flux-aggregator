import fastify from 'fastify';
import client from 'prom-client'

// Create a Registry which registers the metrics
const register = new client.Registry()

// Enable the collection of default metrics
// client.collectDefaultMetrics({ register })

export const metricOracleFeedPrice = new client.Gauge({
  name: 'oracle_feed_price',
  help: 'Oracle feeds prices',
  labelNames: ['submitter', 'feed', 'source']
})

export const metricOracleLastSubmittedPrice = new client.Gauge({
  name: 'oracle_last_submitted_price',
  help: 'Oracle submitted and confirmed price on blockchain',
  labelNames: ['submitter', 'feed']
})

export const metricOracleSinceLastSubmitSeconds = new client.Gauge({
  name: 'oracle_since_last_submit_seconds',
  help: 'Time passed since last submit',
  labelNames: ['submitter', 'feed']
})

export const metricOracleBalanceSol = new client.Gauge({
  name: 'oracle_balance_sol',
  help: 'Oracle owner balance in SOL',
  labelNames: ['submitter']
})



register.registerMetric(metricOracleFeedPrice)
register.registerMetric(metricOracleLastSubmittedPrice)
register.registerMetric(metricOracleSinceLastSubmitSeconds)
register.registerMetric(metricOracleBalanceSol)

// Define the HTTP server
const metricServer = fastify()

metricServer.get('/metrics', async (req, res) =>  {
  try {
		res.header('Content-Type', register.contentType);
		res.send(await register.metrics());
	} catch (ex) {
		res.status(500).send(ex);
	}
})

export default metricServer;
