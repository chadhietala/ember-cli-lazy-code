/* jshint node: true */
'use strict';

var LazyCode = require('./lib');
var stew = require('broccoli-stew');
var merge = require('broccoli-merge-trees');
var find = stew.find;

module.exports = {
  name: 'ember-cli-lazy-code',
  included: function(app) {
    this.app = app;
  },
  postprocessTree: function(type, tree) {
    if (type === 'all') {
      var app = find(tree, { include: ['assets/' + this.app.name + '.js']});
      var lazyApp = new LazyCode(app, {
        description: 'ember-cli-lazy-code'
      });

      return merge([tree, lazyApp], { overwrite: true });
    }
    return tree;
  }
};
