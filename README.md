# **UPDATE** THIS PROJECT HAS BEEN DISCONTINUED

[![NPM version](https://img.shields.io/npm/v/minimalcss-server.svg)](https://www.npmjs.com/package/minimalcss-server)
![Node.js CI](https://github.com/peterbe/minimalcss-server/workflows/Node.js%20CI/badge.svg)

A Node Express server with a pool of `puppeteer` browsers
sent into [`minimalcss`](https://github.com/peterbe/minimalcss) that
analyzes the minimal CSS for a URL.

To run:

```sh
node server.js
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

## Skippable URLs

By default `minimalcss` doesn't skip any URLs. However, there are some good
defaults that almost everyone should skip. One of them is Google Analytics JS
and another is Google Fonts.

The reason you should skip Google Fonts is because a URL like
`https://fonts.googleapis.com/css?family=Lato` is dynamic. It's content is
different depending the browser. If you let `minimalcss` include its content
it will be based on the user agent that `minimalcss` is.

If you want to add other patterns, you can pass in `skippable_url_patterns`.
For example:

```sh
curl -X POST  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "skippable_url_patterns": ["ads.example.com"]}' \
  http://localhost:5000/minimize
```

## Prettier

If you include `"prettier": true` in your JSON body POST, the returning
JSON will have one additional key called `_prettier` which is the result
of running `prettier.format(result.finalCss, {parser: "css"})`.

## License

Copyright (c) 2017-2020 [Peter Bengtsson](https://www.peterbe.com).
See the [LICENSE](/LICENSE) file for license rights and limitations (MIT).
