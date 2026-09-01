const fs = require('fs');
const lines = fs.readFileSync(process.argv[2], 'utf8').split(/\r?\n/);
const lineNum = Number(process.argv[3]) - 1;
const line = lines[lineNum];
console.log(JSON.stringify(line));
console.log('len=' + line.length);
for (let i = 50; i < Math.min(80, line.length); i++) {
  const c = line.charCodeAt(i);
  console.log(`Col ${i}: ${c} = '${line[i]}'`);
}
