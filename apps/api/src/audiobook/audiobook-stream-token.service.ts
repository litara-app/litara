import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'crypto';

interface StreamToken {
  userId: string;
  expiresAt: number;
}

// Tokens last 4 hours so long listening sessions don't get interrupted
const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
const PURGE_INTERVAL_MS = 30 * 60 * 1000;

@Injectable()
export class AudiobookStreamTokenService implements OnModuleDestroy {
  private readonly tokens = new Map<string, StreamToken>();
  private readonly purgeTimer: NodeJS.Timeout;

  constructor() {
    this.purgeTimer = setInterval(() => this.purgeExpired(), PURGE_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.purgeTimer);
  }

  generate(userId: string): { token: string; expiresAt: Date } {
    const token = randomUUID();
    const expiresAt = Date.now() + TOKEN_TTL_MS;
    this.tokens.set(token, { userId, expiresAt });
    return { token, expiresAt: new Date(expiresAt) };
  }

  validate(token: string): string | null {
    this.purgeExpired();
    const entry = this.tokens.get(token);
    if (!entry || entry.expiresAt < Date.now()) {
      this.tokens.delete(token);
      return null;
    }
    return entry.userId;
  }

  private purgeExpired() {
    const now = Date.now();
    for (const [token, entry] of this.tokens) {
      if (entry.expiresAt < now) this.tokens.delete(token);
    }
  }
}
