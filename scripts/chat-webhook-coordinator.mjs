#!/usr/bin/env node
// Google Chat Apps Script relay webhook for the "coordinator" agent.
// Receives: { chat: { messagePayload: { message: { text, sender: { displayName }, space: { displayName } } } } }
// Routes text into the agent's inbox and replies with a Chat-format ack.

import { createServer } from 'http';
import { execFile } from 'child_process';
import { homedir } from 'os';
import { join } from 'path';

const PORT = process.env.CHAT_WEBHOOK_PORT || 8790;
const TARGET_AGENT = 'coordinator';
const CLI = join(homedir(), 'ascendops', 'dist', 'cli.js');

function ack(text) {
  return JSON.stringify({
    hostAppDataAction: { chatDataAction: { createMessageAction: { message: { text } } } },
  });
}

function routeToInbox(text) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, 'bus', 'send-message', TARGET_AGENT, 'normal', text, '--skip-lint'],
      { env: { ...process.env, CTX_FRAMEWORK_ROOT: join(homedir(), 'ascendops'), CTX_ORG: 'gunn-property-services' } },
      (err, stdout, stderr) => {
        if (err) {
          console.error(`[chat-webhook-coordinator] send-message failed: ${stderr || err.message}`);
          resolve(false);
        } else {
          console.log(`[chat-webhook-coordinator] routed to ${TARGET_AGENT}: ${stdout.trim()}`);
          resolve(true);
        }
      },
    );
  });
}

const server = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'method not allowed' }));
    return;
  }

  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', async () => {
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    const chatEvent = payload.chat || payload;
    const messagePayload = chatEvent.messagePayload;
    const message = messagePayload?.message || {};
    const sender = message.sender?.displayName || 'someone';
    const text = message.text || message.argumentText || '';
    const spaceName = message.space?.displayName || 'the space';

    if (!text.trim()) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(ack('Got that, though there was no text to pass along.'));
      return;
    }

    const routed = await routeToInbox(`[Google Chat from ${sender} in ${spaceName}] ${text}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(ack(routed ? 'Got it — passed your message along.' : 'Got your message, but had trouble passing it along.'));
  });
});

server.listen(PORT, () => {
  console.log(`[chat-webhook-coordinator] listening on :${PORT}`);
});
