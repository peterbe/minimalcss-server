# minimalcss-server

[![NPM version](https://img.shields.io/npm/v/minimalcss-server.svg)](https://www.npmjs.com/package/minimalcss-server)

A Node Express server with a pool of `puppeteer` browsers
sent into [`minimalcss`](https://github.com/peterbe/minimalcss) that
analyzes the minimal CSS for a URL.

To run:

```sh
$ node server.js
```

To test:

```sh
curl -X POST  -H 'Content-Type: application/json' \
  -d '{"url": "https://news.ycombinator.com"}' \
  http://localhost:5000/minimize
```

It uses a pool of opened puppeteer `browser` instances created with
launch args `args: ['--no-sandbox', '--disable-setuid-sandbox']`.
These are then sent to `minimalcss` and its output is returned as JSON
by this server. It looks something like this:

```json
{
    "result": {
        "finalCss": "[SNIP]",
        "stylesheetContents": {
            "https://news.ycombinator.com/news.css?tcSCuEkwhnkVn0z07QWM":
                "[SNIP]"
        },
        "_url": "https://news.ycombinator.com",
        "_took": 3454.6355110000004,
        "_cache": "miss"
    }
}
```

An LRU cache protects for repeated calls. If there's a cache hit on the LRU
the exact same output is returned by `result._took === 0.0` and
`result._cache === 'hit'`.

## License

Copyright (c) 2017-2018 [Peter Bengtsson](https://www.peterbe.com).
See the [LICENSE](/LICENSE) file for license rights and limitations (MIT).
