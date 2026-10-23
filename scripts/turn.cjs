// 测试用本地 TURN 中继（node-turn）。用法：node scripts/turn.cjs [port]
const Turn = require('node-turn');
const port = Number(process.argv[2] || 3478);
const server = new Turn({ listeningPort: port, authMech: 'long-term', credentials: { holdem: 'holdem' }, debugLevel: 'ERROR', listeningIps: ['127.0.0.1'], relayIps: ['127.0.0.1'] });
server.start();
console.log('TURN listening ' + port);
