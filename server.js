const express = require('express');
const path = require('path');
const responseTime = require('response-time');
const genericPool = require('generic-pool');
const now = require('performance-now');
const puppeteer = require('puppeteer');
const minimalcss = require('minimalcss');
const LRU = require('lru-cache');
const morgan = require('morgan');
const request = require('request');
const GracefulShutdownManager = require('@moebius/http-graceful-shutdown')
  .GracefulShutdownManager;

const PORT = process.env.PORT || 5000;

const LRUCache = LRU({
  max: 10,
  // length: function (n, key) { return n * 2 + key.length }
  // , dispose: function (key, n) { n.close() }
  maxAge: 1000 * 60 * 60
});

const factory = {
  create: async () => {
    // const browser = await puppeteer.launch();
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    return browser;
  },
  destroy: async browser => {
    await browser.close();
  }
};

const POOL_SIZE_MAX = parseInt(process.env.POOL_SIZE_MAX || 5);
const POOL_SIZE_MIN = parseInt(process.env.POOL_SIZE_MIN || 2);
const POOL_MAX_WAITING_CLIENTS = parseInt(
  process.env.POOL_MAX_WAITING_CLIENTS || 10
);

const browserPool = genericPool.createPool(factory, {
  max: POOL_SIZE_MAX,
  min: POOL_SIZE_MIN,
  maxWaitingClients: POOL_MAX_WAITING_CLIENTS
});

const app = express();

// This sets an 'X-Response-Time' header to every request.
app.use(responseTime());

// So we can parse JSON bodies
// app.use(bodyParser());
app.use(express.json());

app.post('/minimize', async function(req, res) {
  const url = req.body.url;
  const preflight = !!(req.body.preflight || false);
  res.set('Content-Type', 'application/json');
  const cached = LRUCache.get(url);
  if (cached) {
    const full = JSON.parse(cached);
    full.result._took = 0.0;
    full.result._cache = 'hit';
    res.send(JSON.stringify(full));
    return;
  }

  if (!url) {
    res.status(400);
    res.send(
      JSON.stringify({
        error: "missing 'url' in JSON body"
      })
    );
  } else {
    // minimalcss can be quite a beast since it wraps puppeteer,
    // which wraps chromium. So to check that the URL is at all
    // accessible you can preflight there.
    if (preflight) {
      request(
        {
          uri: url,
          timeout: 5 * 1000
        },
        (error, response, body) => {
          if (error) {
            console.log(`Error trying to prefly to ${url}:`, error);
          } else {
            console.log('Prefly status code:', response && response.statusCode);
          }
        }
      );
    }
    console.log(`About to run minimalcss on ${url}`);
    const browser = await browserPool.acquire();
    const t0 = now();
    try {
      await minimalcss
        .minimize({
          urls: [url],
          browser: browser
        })
        .then(result => {
          // browser.close();
          browserPool.release(browser);
          const t1 = now();
          const took = t1 - t0;
          console.log(
            `Successfully ran minimalcss on ${url} (Took ${took.toFixed(1)}ms)`
          );
          result._url = url;
          result._took = t1 - t0;

          LRUCache.set(url, JSON.stringify({ result }));
          result._cache = 'miss';
          res.send(
            JSON.stringify({
              result
            })
          );
        })
        .catch(error => {
          // browser.close();
          // await browserPool.release(browser);
          browserPool.release(browser);
          console.error(`Failed the minimize CSS: ${error}`);
          res.status(500);
          res.send(
            JSON.stringify({
              error: error.toString()
            })
          );
        });
    } catch (ex) {
      browserPool.release(browser);
      console.error(ex);
      res.status(500);
      res.send(
        JSON.stringify({
          error: error.toString()
        })
      );
    }
  }
});

app.get('/', async function(req, res) {
  res.set('Content-Type', 'text/plain');
  res.send(
    `Yeah, it works and using minimalcss version ${minimalcss.version}.\n`
  );
});

const server = app.listen(PORT, () =>
  console.log(`Node server listening on port ${PORT}!`)
);

const shutdownManager = new GracefulShutdownManager(server);

const _shutdown = () => {
  console.warn('Draining browserPool');
  try {
    browserPool.drain().then(() => {
      console.warn('browserPool drained');
      browserPool.clear();
      shutdownManager.terminate(() => {
        console.log('Server is gracefully terminated');
      });
    });
  } catch (ex) {
    console.error(ex);
  }
};
process.on('SIGINT', _shutdown);
process.on('SIGTERM', _shutdown);
