/**
 * Admin password reset script.
 *
 * Must be run interactively from a terminal (TTY required).
 * Passwords are never accepted via command-line arguments to prevent
 * exposure in process listings (ps aux) and shell history.
 *
 * Usage (from Docker host):
 *   docker exec -it <container> node dist/apps/api/src/scripts/reset-password.js --email user@example.com
 */

import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const MIN_PASSWORD_LENGTH = 8;

function parseArgs(): { email: string | undefined } {
  const args = process.argv.slice(2);
  let email: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === '--password') {
      console.error(
        'Error: --password flag is not supported. Passwords must be entered interactively to avoid exposure in process listings and shell history.',
      );
      process.exit(1);
    }
  }

  return { email };
}

function promptPasswordHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stderr.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let input = '';
    const onData = (chunk: Buffer) => {
      const char = chunk.toString();
      if (char === '\r' || char === '\n') {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener('data', onData);
        process.stderr.write('\n');
        resolve(input);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.stderr.write('\nAborted.\n');
        process.exit(1);
      } else if (char === '\u007f' || char === '\b') {
        input = input.slice(0, -1);
      } else {
        input += char;
      }
    };
    process.stdin.on('data', onData);
  });
}

async function main() {
  // Require a real interactive terminal — prevents piped/scripted invocation
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.error(
      'Error: this script must be run in an interactive terminal (TTY). ' +
        'Use `docker exec -it` (note the -t flag) if running inside a container.',
    );
    process.exit(1);
  }

  const { email } = parseArgs();

  if (!email) {
    console.error('Usage: reset-password.js --email <email>');
    process.exit(1);
  }

  const password = await promptPasswordHidden('New password: ');
  const confirm = await promptPasswordHidden('Confirm new password: ');

  if (password !== confirm) {
    console.error('Error: passwords do not match.');
    process.exit(1);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `Error: password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    await prisma.$connect();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`Error: no user found with email "${email}".`);
      process.exit(1);
    }

    const hash = await bcrypt.hash(password, 10);
    await prisma.user.update({ where: { email }, data: { password: hash } });

    console.log(`Password reset successfully for ${email}.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
