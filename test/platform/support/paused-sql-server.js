import net from 'node:net';

// A stand-in for an Azure SQL database that is paused: it answers the TDS handshake and then refuses
// every login with error 40613, which is what the real service does while the database resumes.
// A real mssql pool pointed at it produces the exact error the API sees in the test environment.
export const NOT_AVAILABLE_MESSAGE = "Database 'emg-apps' on server 'emg-data-dev' is not currently available.  Please retry the connection later.  If the problem persists, contact customer support, and provide them the session tracing ID of '{AAAAAAAA-0000-0000-0000-000000000000}'.";

const PRELOGIN = 0x12;
const LOGIN7 = 0x10;
const TABULAR_RESULT = 0x04;

export async function startPausedSqlServer({ number = 40613, message = NOT_AVAILABLE_MESSAGE } = {}) {
  let logins = 0;
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      if (chunk[0] === PRELOGIN) socket.write(packet(TABULAR_RESULT, preloginReply()));
      if (chunk[0] === LOGIN7) {
        logins += 1;
        socket.write(packet(TABULAR_RESULT, refusal(number, message)));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: server.address().port,
    logins: () => logins,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function packet(type, payload) {
  const header = Buffer.alloc(8);
  header[0] = type;
  header[1] = 0x01; // end of message
  header.writeUInt16BE(payload.length + 8, 2);
  header[6] = 1;
  return Buffer.concat([header, payload]);
}

// VERSION and ENCRYPTION options; encryption "not supported" keeps the test client off TLS.
function preloginReply() {
  const options = Buffer.alloc(11);
  options[0] = 0x00;
  options.writeUInt16BE(11, 1);
  options.writeUInt16BE(6, 3);
  options[5] = 0x01;
  options.writeUInt16BE(17, 6);
  options.writeUInt16BE(1, 8);
  options[10] = 0xff;
  return Buffer.concat([options, Buffer.from([16, 0, 0, 0, 0, 0]), Buffer.from([0x02])]);
}

// An ERROR token followed by DONE with the error flag, as SQL Server sends for a refused login.
function refusal(number, message) {
  const text = Buffer.from(message, 'utf16le');
  const server = Buffer.from('emg-data-dev', 'utf16le');
  const fixed = Buffer.alloc(6);
  fixed.writeUInt32LE(number, 0);
  fixed[4] = 1; // state
  fixed[5] = 20; // class
  const length = Buffer.alloc(2);
  length.writeUInt16LE(message.length, 0);
  const line = Buffer.alloc(4);
  line.writeUInt32LE(1, 0);
  const body = Buffer.concat([fixed, length, text, Buffer.from([server.length / 2]), server, Buffer.from([0]), line]);
  const token = Buffer.alloc(3);
  token[0] = 0xaa;
  token.writeUInt16LE(body.length, 1);
  const done = Buffer.alloc(13);
  done[0] = 0xfd;
  done.writeUInt16LE(0x0002, 1);
  return Buffer.concat([token, body, done]);
}
