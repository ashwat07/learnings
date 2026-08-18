exports.done = false;
const b = require('./cycle-b.cjs');
exports.done = true;
exports.sawFromB = b.seenAtRequire;
