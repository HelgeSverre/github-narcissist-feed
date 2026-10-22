import { execFileSync } from "node:child_process";

/** Where the main GitHub token came from. Only the source is ever logged, never the token. */
export interface TokenSource {
  token: string;
  source: "GITHUB_TOKEN" | "gh auth token";
}

let cached: TokenSource | null | undefined;

/** `GITHUB_TOKEN`, else the output of `gh auth token`; `null` when neither is available. */
export function githubTokenSource(): TokenSource | null {
  if (cached !== undefined) return cached;
  const fromEnv = process.env.GITHUB_TOKEN?.trim();
  if (fromEnv) return (cached = { token: fromEnv, source: "GITHUB_TOKEN" });
  try {
    const token = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
    return (cached = token ? { token, source: "gh auth token" } : null);
  } catch {
    return (cached = null);
  }
}

export const githubToken = (): string | null => githubTokenSource()?.token ?? null;

/** A fine-grained token without stargazer access, for the "stars are missing" scenario. */
export const fineGrainedToken = (): string | null => process.env.GITHUB_FINE_GRAINED_TOKEN?.trim() || null;

export interface GithubViewer {
  login: string;
  publicRepos: number;
}

/** Who the token belongs to, asked of GitHub itself so no test hard-codes an account name. */
export async function fetchViewer(token: string): Promise<GithubViewer> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "github-narcissist-feed-e2e" },
  });
  if (!res.ok) throw new Error(`GET https://api.github.com/user answered ${res.status}; is the token valid?`);
  const body = (await res.json()) as { login: string; public_repos: number };
  return { login: body.login, publicRepos: body.public_repos };
}
