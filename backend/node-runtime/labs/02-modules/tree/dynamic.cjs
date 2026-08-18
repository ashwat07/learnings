// The same idea, built at runtime. The lexer cannot see through this.
const names = ['gamma', 'delta'];
for (const n of names) module.exports[n] = n.length;
