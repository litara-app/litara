/**
 * Admin password reset script.
 *
 * Usage (from Docker host):
 *   docker exec <container> node dist/apps/api/src/scripts/reset-password.js --email user@example.com --password newpass
 *   docker exec <container> node dist/apps/api/src/scripts/reset-password.js --email user@example.com
 *     (omit --password to be prompted interactively)
 */

import * as readline from 'readline';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

function parseArgs(): {
  email: string | undefined;
  password: string | undefined;
} {
  const args = process.argv.slice(2);
  let email: string | undefined;
  let password: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email' && args[i + 1]) {
      email = args[++i];
    } else if (args[i] === '--password' && args[i + 1]) {
      password = args[++i];
    }
  }

  return { email, password };
}

function promptPassword(): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stderr,
    });

    // Hide input if TTY supports it
    if (process.stdin.isTTY) {
      process.stderr.write('New password: ');
      process.stdin.setRawMode(true);

      let input = '';
      process.stdin.on('data', (chunk: Buffer) => {
        const char = chunk.toString();
        if (char === '\r' || char === '\n') {
          process.stdin.setRawMode(false);
          process.stderr.write('\n');
          rl.close();
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
      });
    } else {
      rl.question('New password: ', (answer) => {
        rl.close();
        resolve(answer);
      });
    }
  });
}

async function main() {
  const { email, password: flagPassword } = parseArgs();

  if (!email) {
    console.error(
      'Usage: reset-password.js --email <email> [--password <newpass>]',
    );
    process.exit(1);
  }

  const password = flagPassword ?? (await promptPassword());

  if (!password) {
    console.error('Error: password cannot be empty.');
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
