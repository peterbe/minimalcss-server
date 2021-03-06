const express = require("express");
const responseTime = require("response-time");
const genericPool = require("generic-pool");
const now = require("performance-now");
const puppeteer = require("puppeteer");
const minimalcss = require("minimalcss");
const prettier = require("prettier");
const LRU = require("lru-cache");
const got = require("got");
const GracefulShutdownManager = require("@moebius/http-graceful-shutdown")
  .GracefulShutdownManager;

const PORT = process.env.PORT || 5000;

const LRUCache = new LRU({
  max: 10,
  // length: function (n, key) { return n * 2 + key.length }
  // , dispose: function (key, n) { n.close() }
  maxAge: 1000 * 60 * 60,
});

const factory = {
  create: async () => {
    // const browser = await puppeteer.launch();
    const browser = await puppeteer.launch({
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--enable-features=NetworkService",
      ],
    });
    return browser;
  },
  destroy: async (browser) => {
    await browser.close();
  },
};

const POOL_SIZE_MAX = parseInt(process.env.POOL_SIZE_MAX || 5);
const POOL_SIZE_MIN = parseInt(process.env.POOL_SIZE_MIN || 2);
const POOL_MAX_WAITING_CLIENTS = parseInt(
  process.env.POOL_MAX_WAITING_CLIENTS || 10
);

const browserPool = genericPool.createPool(factory, {
  max: POOL_SIZE_MAX,
  min: POOL_SIZE_MIN,
  maxWaitingClients: POOL_MAX_WAITING_CLIENTS,
});

const app = express();

// This sets an 'X-Response-Time' header to every request.
app.use(responseTime());

// So we can parse JSON bodies
// app.use(bodyParser());
app.use(express.json());

app.post("/minimize", async function (req, res) {
  const url = req.body.url;
  const preflight = !!(req.body.preflight || false);
  const includePrettier = !!(req.body.prettier || false);
  let skippableUrlPatterns = req.body.skippable_url_patterns || null;
  res.set("Content-Type", "application/json");
  const cached = LRUCache.get(url);
  if (cached) {
    const full = JSON.parse(cached);
    full.result._took = 0.0;
    full.result._cache = "hit";
    res.send(JSON.stringify(full));
    return;
  }

  if (!url) {
    res.status(400);
    res.send(
      JSON.stringify({
        error: "missing 'url' in JSON body",
      })
    );
  } else {
    // minimalcss can be quite a beast since it wraps puppeteer,
    // which wraps chromium. So to check that the URL is at all
    // accessible you can preflight there.
    if (preflight) {
      try {
        const response = await got(url, {
          timeout: 5 * 1000,
        });
        console.log(`Preflight status code: ${response.statusCode}`);
      } catch (ex) {
        console.log(`Error trying to prefly to ${url}:`, ex.toString());
      }
    }

    // Prep the skippableUrlPatterns array to avoid having to do this
    // prep-work for each individual request.
    if (skippableUrlPatterns) {
      // It's either a string or an array at this point.
      if (!Array.isArray(skippableUrlPatterns)) {
        skippableUrlPatterns = [skippableUrlPatterns];
      }
    } else {
      skippableUrlPatterns = [];
    }
    // Some good practice ones we can boldly skip.
    if (!skippableUrlPatterns.includes("google-analyics.com")) {
      skippableUrlPatterns.push("google-analyics.com");
    }
    if (!skippableUrlPatterns.includes("fonts.googleapis.com")) {
      // See https://github.com/peterbe/minimalcss/issues/164
      skippableUrlPatterns.push("fonts.googleapis.com");
    }

    // Return false if the request should be processed.
    // For example, there might certain URLs we definitely know should
    // be skipped. By contrast, minimalcss doesn't skip any. Even the ones
    // that are arguably good practice to skip. This function mixes
    // supplied patterns AND some good practice ones.
    const skippable = (request) => {
      if (!skippableUrlPatterns.length) {
        return false;
      }
      return skippableUrlPatterns.some((skip) => !!request.url().match(skip));
    };

    console.log(`About to run minimalcss on ${url}`);
    const browser = await browserPool.acquire();
    const t0 = now();
    await minimalcss
      .minimize({
        url,
        browser,
        skippable,
        withoutjavascript: false, // XXX this should be the default!
      })
      .then((result) => {
        const t1 = now();
        const took = t1 - t0;
        console.log(
          `Successfully ran minimalcss on ${url} (Took ${took.toFixed(1)}ms)`
        );
        result._url = url;
        result._took = t1 - t0;
        if (includePrettier) {
          result._prettier = prettier.format(result.finalCss, {
            parser: "css",
          });
        }
        LRUCache.set(url, JSON.stringify({ result }));
        result._cache = "miss";
        res.json({ result });
      })
      .catch((error) => {
        console.error(`Failed the minimize CSS: ${error}`);
        res.status(500);
        res.json({ error: error.toString() });
      })
      .finally(() => {
        browserPool.release(browser);
      });
  }
});

app.get("/", async function (req, res) {
  res.set("Content-Type", "text/plain");
  res.send(
    `Yeah, it works and using minimalcss version ${minimalcss.version}.\n`
  );
});

const server = app.listen(PORT, () =>
  console.log(`Node server listening on port ${PORT}!`)
);

const shutdownManager = new GracefulShutdownManager(server);

function _shutdown() {
  console.warn("Draining browserPool");
  try {
    return browserPool.drain().then(() => {
      console.warn("browserPool drained");
      browserPool.clear();
      shutdownManager.terminate(() => {
        console.log("Server is gracefully terminated");
      });
    });
  } catch (ex) {
    console.error(ex);
  }
}

process.on("SIGINT", _shutdown);
process.on("SIGTERM", _shutdown);

module.exports = { app, _shutdown };
