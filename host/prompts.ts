export async function secretQuestion(prompt: string): Promise<string> {
  if (!process.stdin.isTTY)
    throw new Error(
      'Run npm run setup interactively to configure the selected provider credential',
    );
  process.stdout.write(prompt);
  const input = process.stdin;
  const wasRaw = input.isRaw;
  input.setRawMode(true);
  input.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (cancelled: boolean) => {
      input.off('data', read);
      input.setRawMode(wasRaw);
      input.pause();
      process.stdout.write('\n');
      cancelled
        ? reject(new Error('Configuration cancelled'))
        : resolve(value.trim());
    };
    const read = (buffer: Buffer) => {
      for (const character of buffer.toString()) {
        if (character === '\u0003') {
          finish(true);
          return;
        }
        if (character === '\r' || character === '\n') {
          finish(false);
          return;
        }
        if (character === '\u007f' || character === '\b')
          value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    input.on('data', read);
  });
}
