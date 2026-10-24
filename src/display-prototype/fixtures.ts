/** Illustrative activity only. These are not actual events on Helge's repositories. */
export const screens = [
  { id: "spotlight", name: "Spotlight", icon: "star" },
  { id: "activity", name: "Activity", icon: "comment" },
  { id: "repositories", name: "Repositories", icon: "repo-forked" },
] as const;
export type Screen = (typeof screens)[number]["id"];
export interface DisplayEvent {
  id: number;
  actor: string;
  initials: string;
  kind: "star" | "fork" | "issue" | "pr" | "comment" | "release";
  action: string;
  repo: string;
  time: string;
  title?: string;
  detail: string;
}
export const activity: DisplayEvent[] = [
  {
    id: 1,
    actor: "alex",
    initials: "AL",
    kind: "star",
    action: "starred",
    repo: "github-narcissist-feed",
    time: "2 min ago",
    detail: "A new star on your repository. In the connected app, this opens the person’s profile or the repository.",
  },
  {
    id: 2,
    actor: "mona",
    initials: "MO",
    kind: "issue",
    action: "opened an issue in",
    repo: "github-narcissist-feed",
    time: "8 min ago",
    title: "A home for the feed on my desk",
    detail: "Could the feed show one event at a time on a small touchscreen? I’d love to leave it running next to my monitor.",
  },
  {
    id: 3,
    actor: "riley",
    initials: "RI",
    kind: "fork",
    action: "forked",
    repo: "devnull-tv",
    time: "18 min ago",
    detail: "A new fork of your repository. This sample stays inside the sketch; no GitHub account is connected.",
  },
  {
    id: 4,
    actor: "sam",
    initials: "SA",
    kind: "pr",
    action: "opened a pull request in",
    repo: "logobox",
    time: "34 min ago",
    title: "Remember the last selected collection",
    detail:
      "Keep the selected collection when returning to the dashboard. This is illustrative pull request content for trying touch browsing.",
  },
  {
    id: 5,
    actor: "jules",
    initials: "JU",
    kind: "comment",
    action: "left a comment in",
    repo: "devnull-tv",
    time: "51 min ago",
    title: "The ambient view looks great in portrait",
    detail:
      "I’m using a little tablet in portrait orientation. Keeping the screen controls near the bottom makes it much easier to browse.",
  },
  {
    id: 6,
    actor: "casey",
    initials: "CA",
    kind: "star",
    action: "starred",
    repo: "logobox",
    time: "1 hour ago",
    detail: "Someone found your work useful. The ambient view gives even a small event room to breathe.",
  },
  {
    id: 7,
    actor: "taylor",
    initials: "TA",
    kind: "release",
    action: "published a release in",
    repo: "github-narcissist-feed",
    time: "2 hours ago",
    title: "A quieter way to keep up",
    detail: "Sample release notes: public activity, a guided setup, and a feed that feels at home on a dedicated screen.",
  },
  {
    id: 8,
    actor: "morgan",
    initials: "MG",
    kind: "star",
    action: "starred",
    repo: "devnull-tv",
    time: "3 hours ago",
    detail: "A sample star, shown here to try paging through older activity.",
  },
];
export const kindIcons: Record<DisplayEvent["kind"], string> = {
  star: "star",
  fork: "repo-forked",
  issue: "issue-opened",
  pr: "git-pull-request",
  comment: "comment",
  release: "tag",
};
export const repositories = [
  {
    name: "github-narcissist-feed",
    description: "Your GitHub, about you.",
    stars: 18,
    forks: 3,
    conversations: 7,
    trend: [2, 4, 3, 7, 5, 8, 6],
  },
  {
    name: "devnull-tv",
    description: "A little developer life on the big screen.",
    stars: 12,
    forks: 2,
    conversations: 4,
    trend: [1, 2, 1, 4, 3, 2, 5],
  },
  {
    name: "logobox",
    description: "A place for the marks you collect.",
    stars: 6,
    forks: 1,
    conversations: 3,
    trend: [1, 0, 2, 1, 3, 2, 2],
  },
];
