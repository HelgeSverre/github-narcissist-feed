export type Kind = "star" | "unstar" | "fork" | "unfork" | "issue" | "pr" | "comment" | "review" | "release";

export interface FeedEvent {
  id: string;
  kind: Kind;
  /** ISO timestamp the row is sorted by (star time, fork time, issue/PR updatedAt, comment time, …) */
  at: string;
  repo: string;
  private: boolean;
  actor: string;
  avatar: string;
  bot: boolean;
  url: string;
  title?: string | null;
  number?: number | null;
  /** issue: OPEN/CLOSED, pr: OPEN/DRAFT/MERGED/CLOSED, review: APPROVED/CHANGES_REQUESTED/COMMENTED/…, comment: ISSUE/PR */
  state?: string | null;
  created?: string | null;
  closed?: string | null;
  merged?: string | null;
  comments?: number;
  stars?: number;
  forks?: number;
  tag?: string | null;
}

export type Period = "today" | "7" | "30" | "90" | "180" | "365" | "all";
export type Group = "day" | "week" | "month";
export type StackScope = "repo" | "org" | "type";

export interface OwnerConfig {
  login: string;
  type: "user" | "org";
  /** show this owner's repositories in the feed (rail checkbox) */
  on: boolean;
}

export interface Settings {
  username: string;
  owners: OwnerConfig[];
  includePrivate: boolean;
  refreshMinutes: 0 | 5 | 10 | 30;
  showUnstars: boolean;
  trends: boolean;
  stack: boolean;
  stackScope: StackScope;
  stackRepoWindow: number;
  stackOrgWindow: number;
  dateFormat: "system" | "iso" | "dmy" | "mdy";
  timeFormat: "24" | "12";
  weekStart: 0 | 1;
  theme: "system" | "light" | "dark";
  /** "" for Chrome blue, otherwise a lowercase "#rrggbb" seed (see src/lib/accent.ts) */
  accent: string;
  density: "default" | "compact";
}

/** Per-owner metadata resolved by the service worker. */
export interface OwnerMeta {
  login: string;
  type: "user" | "org";
  avatar: string;
  privateAccess: boolean;
  repoCount?: number;
}

export interface Person {
  login: string;
  avatar: string;
  type: "user" | "org";
  group: "Your organizations" | "People you follow";
  privateAccess: boolean;
}

export interface Status {
  publicCoverage?: { checked: number; total: number };
  viewer?: string;
  tokenOk?: boolean;
  tokenError?: string;
  tokenExpiresAt?: string | null;
  /** false when the token cannot list stargazers (fine-grained tokens need Contents: write) */
  starsAccess?: boolean;
  rateRemaining?: number;
  rateLimit?: number;
  rateResetAt?: string;
  lastQuickAt?: string;
  lastFullAt?: string;
  refreshing?: "quick" | "full" | null;
  refreshingSince?: string;
  lastError?: string | null;
}

/** Per-repo ledger used to detect unstars / deleted forks and star bursts. */
export interface RepoLedger {
  private: boolean;
  stars: number;
  forks: number;
  stargazers: string[];
  forkNames: string[];
  pushedAt?: string;
}

/** Device-only UI state (chrome.storage.local `device`). Synced UI state lives in prefs.ts. */
export interface DeviceState {
  onboardingComplete?: boolean;
  lastOpenedAt?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  username: "",
  owners: [],
  includePrivate: true,
  refreshMinutes: 10,
  showUnstars: false,
  trends: true,
  stack: true,
  stackScope: "org",
  stackRepoWindow: 60,
  stackOrgWindow: 180,
  dateFormat: "system",
  timeFormat: "24",
  weekStart: 1,
  theme: "system",
  accent: "",
  density: "default",
};

export type Message =
  | { type: "refresh"; mode: "quick" | "full" }
  | { type: "validateToken"; token?: string }
  | { type: "searchOwners"; q: string }
  | { type: "resolveOwner"; login: string }
  | { type: "loadPeople" };
