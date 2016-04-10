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

LazyCode.prototype.processString = function (content) {
  if (this.mode === 'none') {
    return content;
  }
  var ast = transform(content).ast;
  var positions = [];
  var s = new MagicString(content);
  var self = this;

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

  positions.forEach(function(position) {
    var start = position.start;
    var end = position.end;
    var content = s.snip(start, end).toString();

    content = content.split('\n').map(function(piece) {
      return piece.trim().replace(/'/g, '\\\'').replace(/\\n/g, '\\\\n');
    }).join('');

    s.overwrite(start, end, content);

    wrapString(s, position, self.mode);
  });

  return s.toString();
};

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
