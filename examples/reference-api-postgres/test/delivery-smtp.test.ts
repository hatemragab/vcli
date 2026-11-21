import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Socket } from 'node:net';
import { loadConfig } from '../dist/core/config/load-config.js';
import { SmtpMailService } from '../dist/modules/mail/smtp-mail.service.js';

// An isolated test-owned protocol peer. This proves Nodemailer submission, not hosted relay/inbox delivery.
test(
  'local SMTP protocol accepts one recipient and translates recipient rejection',
  { skip: process.env.REFERENCE_TEST_SMTP !== 'true' },
  async () => {
    const sockets = new Set<Socket>();
    let reject = false;
    let delivered = '';
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
      socket.setEncoding('utf8');
      socket.write('220 local-test ESMTP\r\n');
      let incoming = '';
      let data = false;
      socket.on('data', (chunk: string) => {
        incoming += chunk;
        while (incoming.includes('\r\n')) {
          const index = incoming.indexOf('\r\n');
          const line = incoming.slice(0, index);
          incoming = incoming.slice(index + 2);
          if (data) {
            if (line === '.') {
              data = false;
              socket.write('250 queued locally\r\n');
            } else delivered += `${line}\n`;
          } else if (/^EHLO/.test(line))
            socket.write('250-local-test\r\n250 SIZE 100000\r\n');
          else if (/^MAIL FROM:/.test(line))
            socket.write('250 sender accepted\r\n');
          else if (/^RCPT TO:/.test(line))
            socket.write(
              reject
                ? '550 no such recipient\r\n'
                : '250 recipient accepted\r\n',
            );
          else if (line === 'DATA') {
            data = true;
            socket.write('354 end with dot\r\n');
          } else if (line === 'QUIT') socket.end('221 goodbye\r\n');
          else socket.write('250 okay\r\n');
        }
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const config = loadConfig({
      DATABASE_URL: 'postgresql://unused.invalid/config',
    });
    const sender = new SmtpMailService(
      {
        ...config.mail,
        driver: 'smtp',
        host: '127.0.0.1',
        port: address.port,
        secure: false,
      },
      false,
    );
    const draft = {
      operationId: 'local-smtp-proof',
      to: 'person@example.test',
      subject: 'Local protocol evidence',
      text: 'private test content',
      purpose: 'notification' as const,
    };
    try {
      assert.equal((await sender.submit(draft)).status, 'accepted');
      assert.match(delivered, /private test content/);
      reject = true;
      assert.equal((await sender.submit(draft)).status, 'rejected');
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, fail) =>
        server.close((error) => (error ? fail(error) : resolve())),
      );
    }
  },
);
