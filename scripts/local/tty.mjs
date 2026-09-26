import { emitKeypressEvents } from 'node:readline';

export class TerminalInputError extends Error {
  constructor(code) { super(code === 'cancelled' ? 'Installation cancelled.' : code === 'input_too_long' ? 'Input exceeds its length limit.' : 'An interactive terminal is required.'); this.code = code; }
}

/** Secret input is held in this process only; no argv/env/file input and no echo. */
export function createTerminalIO({ input = process.stdin, output = process.stdout } = {}) {
  function read(prompt, { secret = false, maximumBytes = 1024 } = {}) {
    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') return Promise.reject(new TerminalInputError('terminal_required'));
    return new Promise((resolve, reject) => {
      let value = '', settled = false;
      const wasRaw = input.isRaw, wasFlowing = input.readableFlowing === true;
      const cleanup = () => {
        input.removeListener('keypress', onKey); input.removeListener('end', onEnd); input.removeListener('error', onError);
        input.setRawMode(Boolean(wasRaw)); if (!wasFlowing) input.pause();
      };
      const finish = (error) => {
        if (settled) return; settled = true; cleanup(); output.write('\n');
        const captured = value; value = '';
        if (error) reject(error); else resolve(captured);
      };
      const onEnd = () => finish(new TerminalInputError('cancelled'));
      const onError = () => finish(new TerminalInputError('terminal_required'));
      const onKey = (text = '', key = {}) => {
        if ((key.ctrl && ['c', 'd'].includes(key.name)) || key.name === 'escape') return finish(new TerminalInputError('cancelled'));
        if (key.name === 'return' || key.name === 'enter') return finish();
        if (key.name === 'backspace') { const chars = [...value]; chars.pop(); value = chars.join(''); if (!secret) output.write('\b \b'); return; }
        // Never interpret terminal control sequences as password data.
        if (key.ctrl || key.meta || !text || /[\u0000-\u001f\u007f-\u009f]/u.test(text)) return;
        if (Buffer.byteLength(value + text, 'utf8') > maximumBytes) return finish(new TerminalInputError('input_too_long'));
        value += text; if (!secret) output.write(text);
      };
      emitKeypressEvents(input); output.write(prompt); input.on('keypress', onKey); input.once('end', onEnd); input.once('error', onError);
      input.setRawMode(true); input.resume();
    });
  }
  return Object.freeze({
    interactive: Boolean(input.isTTY && output.isTTY && typeof input.setRawMode === 'function'),
    write(message) { output.write(String(message) + '\n'); },
    readLine(prompt) { return read(prompt, { maximumBytes: 1024 }); },
    readSecret(prompt) { return read(prompt, { secret: true, maximumBytes: 1024 }); },
    async confirm(prompt) { return (await read(prompt, { maximumBytes: 32 })) === 'INSTALLER'; },
  });
}
