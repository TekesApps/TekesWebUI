import type { ServerResponse } from 'node:http';
import type { BridgeMessage } from './bridge.js';

// A view frame replaces the complete view. While the response is full, retain
// only its latest replacement; terminal frames still follow that replacement.
export function followView(
  res: ServerResponse,
  observe: (deliver: (message: BridgeMessage) => void) => () => void,
): void {
  let cancel: (() => void) | undefined;
  let cancelRequested = false;
  let cancelled = false;
  let closed = false;
  let blocked = false;
  let latest: BridgeMessage | undefined;
  let terminal: BridgeMessage | undefined;
  let terminalReceived = false;

  const cancelObservation = () => {
    cancelRequested = true;
    if (cancel && !cancelled) {
      cancelled = true;
      cancel();
    }
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    res.removeListener('drain', drain);
    res.removeListener('close', close);
    res.removeListener('finish', close);
    latest = terminal = undefined;
    cancelObservation();
  };
  const write = (message: BridgeMessage) => {
    const { id: _id, ...wire } = message;
    blocked = !res.write(JSON.stringify(wire) + '\n');
    if (blocked) res.once('drain', drain);
  };
  const flush = () => {
    if (closed || blocked) return;
    if (latest) {
      const message = latest;
      latest = undefined;
      write(message);
    }
    if (!blocked && terminal) {
      const message = terminal;
      terminal = undefined;
      if (message.error || message.value !== undefined) write(message);
      res.end();
    }
  };
  function drain() {
    blocked = false;
    flush();
  }
  const heartbeat = setInterval(() => {
    if (closed || terminalReceived || blocked || res.writableNeedDrain) return;
    blocked = !res.write('\n');
    if (blocked) res.once('drain', drain);
  }, 5000);
  res.once('close', close);
  res.once('finish', close);
  try {
    cancel = observe((message) => {
      if (closed || res.destroyed) {
        close();
        return;
      }
      if (terminalReceived) return;
      if (message.error || message.done) {
        terminalReceived = true;
        terminal = message;
        clearInterval(heartbeat);
        cancelObservation();
      } else {
        latest = message;
      }
      flush();
    });
  } catch (error) {
    close();
    throw error;
  }
  // observe may synchronously deliver its terminal frame before returning cancel.
  if (cancelRequested) cancelObservation();
  if (res.destroyed) close();
}
