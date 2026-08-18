// CommonJS. `module.exports` is a value that gets COPIED at require time.
let count = 0;
function increment() { count++; }
module.exports = { count, increment, read: () => count };
