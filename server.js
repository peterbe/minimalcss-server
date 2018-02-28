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

const PORT = process.env.PORT || 5000;

const LRUCache = LRU({
  max: 10,
  // length: function (n, key) { return n * 2 + key.length }
  // , dispose: function (key, n) { n.close() }
  maxAge: 1000 * 60 * 60
});

const factory = {
  create: async function() {
    // const browser = await puppeteer.launch();
    const browser = await puppeteer.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    return browser;
  },
  destroy: function(puppeteer) {
    puppeteer.close();
  }
};

const browserPool = genericPool.createPool(factory, {
  max: 10,
  min: 2,
  maxWaitingClients: 50
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
          console.log(`Successfully ran minimalcss on ${url}`);
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
  res.send('Yeah, it works.\n');
});

app.listen(PORT, function() {
  console.error(
    `Node cluster worker ${process.pid}: listening on port ${PORT}`
  );
});
