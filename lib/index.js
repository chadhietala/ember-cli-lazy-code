'use strict';

var transform = require('babel-core').transform;
var MagicString = require('magic-string');
var traverse = require('babel-traverse')['default'];
var PersistentFilter = require('broccoli-persistent-filter');

function LazyCode(node, options) {
  this.wrapInIIFE = options.wrapInIIFE;
  this.mode = options.mode;
  PersistentFilter.call(this, node, options);
}

LazyCode.prototype = Object.create(PersistentFilter.prototype);
LazyCode.prototype.constructor = LazyCode;

LazyCode.prototype.extensions = ['js'];
LazyCode.prototype.targetExtension = 'js';

LazyCode.prototype.createPosition = function(start, end, wrapInIIFE, params) {
  return {
    start: start,
    end: end,
    wrapInIIFE: wrapInIIFE,
    arguments: params.map(function(identifier) {
      return identifier.name;
    })
  };
};

LazyCode.prototype.getModuleInfo = function(node) {
  var functionExpression = node.arguments[2];
  var functionBody = functionExpression.body.body;

  return {
    moduleId: node.arguments[0].value,
    imports: node.arguments[1].elements.map(function(el) { return el.value}),
    params: functionExpression.params.map(function(id) { return id.name;}),
    define: {
      start: node.start,
      end: node.end
    },
    body: {
      start: functionBody[0].start,
      end: functionBody[functionBody.length - 1].end
    }
  }
};

LazyCode.prototype.stringifyModule = function(node, options) {
  if (node.type === 'CallExpression' && node.callee.name === 'define') {
    options.modules.push(this.getModuleInfo(node));
  }
};

LazyCode.prototype.traverseAndStringify = function(ast, options) {
  var body = ast.program.body;

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
          this.stringifyModule(seqExp, options);
        }
      } else {
        // in dev mode, each expression node is its own define
        this.stringifyModule(node, options);
      }
    }
  }
};

LazyCode.prototype.traverseAndWrap = function(ast, options) {
  var self = this;
  var positions = options.positions;

  traverse(ast, {
    enter: function(path) {
      if (path.node.type === 'CallExpression') {
        if (path.node.callee.name === 'define') {
          var start = path.node.arguments[2].body.body[0].start;
          var end = path.node.arguments[2].body.body[path.node.arguments[2].body.body.length - 1].end;
          var moduleId = path.node.arguments[0].value;
          var params = path.node.arguments[2].params;
          if (self.wrapInIIFE.indexOf(moduleId) > -1) {
            positions.push(self.createPosition(start, end, true, params));
          } else {
            positions.push(self.createPosition(start, end, false, params));
          }
        }
      }
    }
  });
};

LazyCode.prototype.processString = function (content) {
  if (this.mode === 'none') {
    return content;
  }
  var ast = transform(content).ast;
  var positions = [];
  var modules = [];
  var s = new MagicString(content);
  var mode = this.mode;

  if (mode === 'eval' || mode === 'function') {
    this.traverseAndWrap(ast, {
      mode: mode,
      wrapInIIFE: this.wrapInIIFE,
      positions: positions
    });

    wrap(mode, positions, s);
  } else if (mode === 'strings') {
    this.traverseAndStringify(ast, {
      modules: modules
    });

    stringify(modules, s);
  }

  return s.toString();
};

function stringify(modules, s) {
  var stringRegistry = {};
  // default replacement if no AMD module is found
  var replacementChar = 13;
  modules.forEach(function(mod, index) {
    var defineStart = mod.define.start;
    var defineEnd = mod.define.end + 1;
    var bodyStart = mod.body.start;
    var bodyEnd = mod.body.end;
    var moduleBody = snipModuleBody(bodyStart, bodyEnd, s);
    // var params = mod.params.map(function(param) {
    //   return '\'' + param + '\'';
    // });

    stringRegistry[mod.moduleId] = JSON.stringify({
      imports: mod.imports,
      params: mod.params,
      body: moduleBody
    });

    if (index === 0) {
      // this is the first AMD module being processed
      // we need to replace all the AMD modules starting from here
      replacementChar = defineStart;
    }
    s.remove(defineStart, defineEnd);
  });

  var previousChar = s.snip(replacementChar-1, replacementChar).toString();
  if (previousChar === ',') {
    // prod builds add ',' to after each block and compress the new lines
    s.overwrite(replacementChar-1, replacementChar, ';');
  }
  // replace all AMD modules with their string equivalent representation to make v8 happy
  s.insert(replacementChar, '\n var stringRegistry = ' + JSON.stringify(stringRegistry) + '; \ndefineStringModule(stringRegistry);');
}

function snipModuleBody(start, end, s) {
  return s.snip(start, end).toString();
}

function wrap(mode, positions, s) {
  positions.forEach(function(position) {
    var start = position.start;
    var end = position.end;
    var content = snipModuleBody(start, end, s);

    s.overwrite(start, end, content);

    wrapString(s, position, mode);
  });
}

function wrapString(str, position, mode) {
  switch (mode) {
    case 'eval':
      wrapInEval(str, position);
      break;
    default:
      wrapInFunction(str, position);
      break;
  }
}

function wrapInEval(str, position) {
  var start = position.start;
  var end = position.end;
  var shouldIIFE = position.wrapInIIFE;
  if (shouldIIFE) {
    str.insert(start, 'return eval(\'(function() {');
    str.insert(end, '})()\');');
  } else {
    str.insert(start, 'eval(\'');
    str.insert(end, '\');');
  }
}

function wrapInFunction(str, position) {
  var start = position.start;
  var end = position.end;
  var shouldIIFE = position.wrapInIIFE;
  var args = position.arguments.map(function(i) { return '\''+ i + '\''; }).join(',');
  if (shouldIIFE) {
    str.insert(start, 'return new Function(' + args + ', \'');
    str.insert(end, '\')(' + position.arguments.join(',') + ');');
  } else {
    str.insert(start, 'new Function(' + args + ', \'');
    str.insert(end, '\')(' + position.arguments.join(',') + ');');
  }
}

module.exports = LazyCode;
