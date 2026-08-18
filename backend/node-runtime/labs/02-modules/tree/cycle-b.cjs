const a = require('./cycle-a.cjs');
// a is the PARTIAL exports object of cycle-a: no error, just incomplete data.
exports.seenAtRequire = JSON.stringify(a);
