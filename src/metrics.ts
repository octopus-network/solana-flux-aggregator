import fastify from 'fastify';
import client from 'prom-client'

// Create a Registry which registers the metrics
const register = new client.Registry()

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'oracle_submitter'
})

// Enable the collection of default metrics
// client.collectDefaultMetrics({ register })

export const metricOracleFeedPrice = new client.Gauge({
  name: 'oracle_feed_price',
  help: 'Oracle feeds prices',
  labelNames: ['submitter', 'feed', 'source']
})

export const metricOracleBalanceSol = new client.Gauge({
  name: 'oracle_balance_sol',
  help: 'Oracle owner balance in SOL',
  labelNames: ['submitter']
})

register.registerMetric(metricOracleFeedPrice)
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
