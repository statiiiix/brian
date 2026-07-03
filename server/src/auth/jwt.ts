import jwt from "jsonwebtoken";

export interface TokenUser { id: string; email: string; role: string; }

export function signUserToken(u: TokenUser, secret: string): string {
  return jwt.sign({ sub: u.id, email: u.email, role: u.role }, secret, {
    algorithm: "HS256", expiresIn: "7d",
  });
}

export function verifyUserToken(token: string, secret: string): TokenUser | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ["HS256"] }) as jwt.JwtPayload;
    if (!p.sub || typeof p.email !== "string") return null;
    return { id: String(p.sub), email: p.email, role: String(p.role ?? "admin") };
  } catch {
    return null;
  }
}
