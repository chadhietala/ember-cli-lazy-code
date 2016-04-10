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

LazyCode.prototype.traverseAndStringify = function(ast, options) {
  traverse(ast, {
    enter: function(path) {
      if (path.node.type === 'CallExpression') {
        if (path.node.callee.name === 'define') {
          var functionExpression = path.node.arguments[2];
          var functionBody = functionExpression.body.body;
          options.modules.push({
            moduleId: path.node.arguments[0].value,
            imports: path.node.arguments[1].elements.map(function(el) { return el.value; }),
            params: functionExpression.params.map(function(id) { return id.name; }),
            define: {
              start: path.node.start,
              end: path.node.end
            },
            body: {
              start: functionBody[0].start,
              end: functionBody[functionBody.length - 1].end
            }
          });
        }
      }
    }
  });
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
  modules.forEach(function(mod) {
    var defineStart = mod.define.start;
    var defineEnd = mod.define.end + 1;
    var bodyStart = mod.body.start;
    var bodyEnd = mod.body.end;
    var moduleBody = snipModuleBody(bodyStart, bodyEnd, s);
    var params = mod.params.map(function(param) {
      return '\'' + param + '\'';
    });
    stringRegistry[mod.moduleId] = {
      imports: mod.imports,
      body: 'new Function(' + params.join(',') + ',' + moduleBody + ')'
    };

    s.remove(defineStart, defineEnd);
  });

  s.insert(13, '\nvar stringRegistry = ' + JSON.stringify(stringRegistry, null, 2) + ';');
}

function snipModuleBody(start, end, s) {
  var content = s.snip(start, end).toString();
  return content.split('\n').map(function(piece) {
    return piece.trim().replace(/'/g, '\\\'').replace(/\\n/g, '\\\\n');
  }).join('');
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
