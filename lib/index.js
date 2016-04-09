'use strict';

var transform = require('babel-core').transform;
var MagicString = require('magic-string');
var traverse = require('babel-traverse')['default'];
var PersistentFilter = require('broccoli-persistent-filter');

function LazyCode(node, options) {
  this.wrapInIIFE = options.wrapInIIFE;
  PersistentFilter.call(this, node, options);
}

LazyCode.prototype = Object.create(PersistentFilter.prototype);
LazyCode.prototype.constructor = LazyCode;

LazyCode.prototype.extensions = ['js'];
LazyCode.prototype.targetExtension = 'js';

LazyCode.prototype.processString = function (content) {
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
          if (self.wrapInIIFE.indexOf(moduleId) > -1) {
            positions.push([start, end, true]);
          } else {
            positions.push([start, end, false]);
          }
        }
      }
    }
  });


  positions.forEach(function(cords) {
    var content = s.snip(cords[0], cords[1]).toString();
    content = content.split('\n').map(function(piece) {
      return piece.trim().replace(/'/g, '\\\'').replace(/\\n/g, '\\\\n');
    }).join('');

    s.overwrite(cords[0], cords[1], content);

    if (cords[2]) {
      s.insert(cords[0], 'return eval(\'(function() {');
      s.insert(cords[1], '})()\');');
    } else {
      s.insert(cords[0], 'eval(\'');
      s.insert(cords[1], '\');');
    }
  });

  return s.toString();
};



module.exports = LazyCode;
