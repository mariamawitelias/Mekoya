export interface AuthUser {
  id: string;
  role: string;
  permissions: string[];
  officeId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}