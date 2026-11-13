import type { Request } from 'express';

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
}

export interface RequestWithUser extends Request {
  user: AuthenticatedUser;
}
