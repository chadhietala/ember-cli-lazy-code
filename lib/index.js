/* jshint node: true */
'use strict';

var transform = require('babel-core').transform;
var MagicString = require('magic-string');
var traverse = require('babel-traverse')['default'];
var PersistentFilter = require('broccoli-persistent-filter');

function LazyCode(node, options) {
  this.wrapInIIFE = options.wrapInIIFE;
  this.appInitializerRegex = new RegExp('^' + options.appName + '\/((?:instance-)?initializers)\/');
  this.mode = options.mode;
  if (this.mode !== 'strings') {
    throw new Error('Mode' + this.mode + ' is not applicable for this addon.');
  }
  // default replacement character if none is found
  this.replacementChar = 13;
  this.isFirstDefineSeen = false;
  PersistentFilter.call(this, node, options);
}

LazyCode.prototype = Object.create(PersistentFilter.prototype);
LazyCode.prototype.constructor = LazyCode;

LazyCode.prototype.extensions = ['js'];
LazyCode.prototype.targetExtension = 'js';

LazyCode.prototype.getModuleInfo = function(node) {
  var functionExpression = node.arguments[2];
  var functionBody = functionExpression.body.body;
  var moduleId = node.arguments[0].value;
  var imports = node.arguments[1].elements.map(function(el) { return el.value});
  var params = functionExpression.params.map(function(id) { return id.name; });
  var start = functionBody[0].start;
  var end = functionBody[functionBody.length - 1].end;

  return {
    moduleId: moduleId,
    imports: imports,
    params: params,
    define: {
      start: node.start,
      end: node.end
    },
    body: {
      start: start,
      end: end
    }
  }
};

LazyCode.prototype.addInitializerModule = function(moduleName, initializerModules) {
  // logic is copied from ember-load-initializers and moved to build time to save user's time
  var matches = this.appInitializerRegex.exec(moduleName);

  if (matches && matches.length === 2) {
    initializerModules.push({
      moduleName: moduleName,
      matches: matches
    });
  }
}

LazyCode.prototype.stringifyModule = function(node, options, stringRegistry, initializerModules) {
  if (node.type === 'CallExpression' && node.callee.name === 'define') {
    var mod = this.getModuleInfo(node);
    var defineStart = mod.define.start;
    var defineEnd = mod.define.end + 1;
    var bodyStart = mod.body.start;
    var bodyEnd = mod.body.end;
    var moduleBody = snipModuleBody(bodyStart, bodyEnd, options.s);

    if (!this.isFirstDefineSeen) {
      // this is the first AMD module seen, grab its start position for replacement
      this.replacementChar = defineStart;
      this.isFirstDefineSeen = true;
    }

    stringRegistry[mod.moduleId] = JSON.stringify({
      imports: mod.imports,
      params: mod.params,
      body: moduleBody
    });

    this.addInitializerModule(mod.moduleId, initializerModules);

    options.s.remove(defineStart, defineEnd);
  }
};

LazyCode.prototype.traverseAndStringify = function(ast, options) {
  var body = ast.program.body;
  var stringRegistry = {};
  var initializerModules = [];

  for (var i=0; i<body.length; i++) {
    var parentNode = body[i];

    if (parentNode.type === 'ExpressionStatement') {
      var node = parentNode.expression;
      if (node.type === 'SequenceExpression') {
        // in prod mode, all the defines are under the sequence expression node
        var seqExpressions = node.expressions;
        for (var j=0; j<seqExpressions.length; j++) {
          // loop through each sequence expression that contains a call expression
          var seqExp = seqExpressions[j];
          this.stringifyModule(seqExp, options, stringRegistry, initializerModules);
        }
      } else {
        // in dev mode, each expression node is its own define
        this.stringifyModule(node, options, stringRegistry, initializerModules);
      }
    }
  }

  var previousChar = options.s.snip(this.replacementChar - 1, this.replacementChar).toString();
  if (previousChar === ',') {
    // prod builds add ',' to after each block and compress the new lines
    options.s.overwrite(this.replacementChar - 1, this.replacementChar, ';');
  }
  // replace all AMD modules with their string equivalent representation to make v8 happy
  var replacementString = '\nvar stringRegistry = ' + JSON.stringify(stringRegistry) + ';' +
                          '\ndefineStringModule(stringRegistry);' +
                          '\nvar initializerRegistry = ' + JSON.stringify(initializerModules) + ';' +
                          '\ndefineInitializerRegistry(initializerRegistry);';
  options.s.insert(this.replacementChar, replacementString);
};

LazyCode.prototype.processString = function (content) {
  if (this.mode === 'none') {
    return content;
  }
  var ast = transform(content).ast;
  var s = new MagicString(content);

  this.traverseAndStringify(ast, {
    s: s
  });

  return s.toString();
};

function snipModuleBody(start, end, s) {
  return s.snip(start, end).toString();
}

module.exports = LazyCode;
