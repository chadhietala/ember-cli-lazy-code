# Ember-cli-lazy-code

This addon is an inspiration from Google's startup latency [blog](http://googlecode.blogspot.com/2009/09/gmail-for-mobile-html5-series-reducing.html).

This addon converts the app file's AMD modules into a string equivalent format. It primarily is used to
lazily evaluate AMD modules by converting into an Object literal format that can be JSON stringified.
This is very useful on low powered devices where we want to lazily evaluate javascript and only evaluate Javascript that is needed in the initial load.

Consider the following AMD modules:
```javascript
define('a', ['exports', 'b', 'c'], function(_exports, _a, _b) {
  _exports.add = function add(n1, n2) {
    return _a.default(n1) + _b.default(n2);
  }
});
define('b', ['exports', 'c'], function(_exports, _c) {
  _exports.default = function addOne(n) {
    return _c.default(n) + 1;
  }
});
define('c', ['exports'], function(_exports) {
  _exports.default = function id(n) {
    return n;
  }
});
```

With an AMD module there 3 parts of the signature:

1. The module id `string`
2. The modules dependencies ids `Array<string>`
3. The anonymous function that executes the modules code. Called with the reified dependecies.

With this addon, we write an AST transform that captures the call of the `define` and re-writes it into an Object literal structure that can be `JSON.stringify`ed.

After the build, all app's AMD modules will be in this format by default:
```javascript
{
  "a": {
    "imports": ["exports", "b", "c"],
    "arguments": ["_exports", "_b", "_c"],
    "body": "_exports.add = function add(n1, n2) { return _a.default(n1) + _b.default(n2); }"
  },
  "b": {
    "imports": ["exports", "c"],
    "arguments": ["_exports", "_c"],
    "body": "_exports.default = function addOne(n) { return _c.default(n) + 1; }"
  },
  "c": {
    "imports": ["exports"],
    "arguments": ["_exports"],
    "body": "_exports.default = function id(n) { return n;}"
  }
}
```

This addon only supports the `strings` mode currently. In future, we may add variations to this.

Since the format of the modules has been changed, we need to teach the [loader.js](https://github.com/kratiahuja/loader.js/blob/master/lib/loader/loader.js#L284) to recognize this new format.

## Note
When using this addon, please use [ember-cli-string-module-loader](https://github.com/kratiahuja/ember-cli-string-module-loader) addon instead of [loader.js](https://github.com/ember-cli/loader.js) addon.

## Installation

* `git clone` this repository
* `npm install`
* `bower install`

## Running

* `ember server`
* Visit your app at http://localhost:4200.

## Running Tests

* `npm test` (Runs `ember try:testall` to test your addon against multiple Ember versions)
* `ember test`
* `ember test --server`

## Building

* `ember build`

For more information on using ember-cli, visit [http://www.ember-cli.com/](http://www.ember-cli.com/).
