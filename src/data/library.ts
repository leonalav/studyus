export interface NoteItem {
  type: "note";
  label: string;
}

export interface FolderItem {
  type: "folder";
  label: string;
  children: (NoteItem | FolderItem)[];
}

export type TreeItem = NoteItem | FolderItem;

export const PRIVATE_TREE: TreeItem[] = [
  {
    type: "folder",
    label: "college study plans",
    children: [
      { type: "note", label: "AP Physics study guide" },
      { type: "note", label: "Calculus exam schedule" },
      { type: "note", label: "homework and assignments" },
    ],
  },
  {
    type: "folder",
    label: "coding and stuff",
    children: [
      { type: "note", label: "Python cheat sheet" },
      { type: "note", label: "Git workflow notes" },
      {
        type: "folder",
        label: "project ideas",
        children: [
          { type: "note", label: "AI flashcard app" },
          { type: "note", label: "Study timer concept" },
        ],
      },
    ],
  },
  {
    type: "folder",
    label: "leetcode prep",
    children: [
      { type: "note", label: "arrays & hashing" },
      { type: "note", label: "two pointers patterns" },
      { type: "note", label: "sliding window tricks" },
    ],
  },
  {
    type: "folder",
    label: "research",
    children: [
      { type: "note", label: "spaced repetition paper" },
      { type: "note", label: "active recall methods" },
    ],
  },
];

export const GROUPS_TREE: TreeItem[] = [
  {
    type: "folder",
    label: "pre-college study plans",
    children: [
      {
        type: "folder",
        label: "the math & physical science suites",
        children: [
          { type: "note", label: "kinematics formula sheet" },
          { type: "note", label: "integral techniques" },
        ],
      },
      {
        type: "folder",
        label: "the fundamental CS core",
        children: [
          { type: "note", label: "Big-O cheat sheet" },
          { type: "note", label: "data structures overview" },
        ],
      },
      {
        type: "folder",
        label: "suite of frameworks for ml",
        children: [{ type: "note", label: "PyTorch vs TensorFlow" }],
      },
    ],
  },
];

/* ── Flattened, searchable index ── */

export type Recency = "today" | "past30" | "older";

export interface SearchItem {
  id: string;
  label: string;
  type: "note" | "folder";
  path: string;
  space: "Private" | "Study Groups";
  recency: Recency;
  accent: string;
}

const ACCENTS = ["#7dd3fc", "#86efac", "#fcd34d", "#f9a8d4", "#a5b4fc", "#fca5a5"];

function flatten(items: TreeItem[], space: SearchItem["space"], trail: string[], out: SearchItem[]) {
  for (const item of items) {
    const id = `${space}/${[...trail, item.label].join("/")}`;
    out.push({
      id,
      label: item.label,
      type: item.type,
      path: trail.join(" / "),
      space,
      recency: "today",
      accent: ACCENTS[out.length % ACCENTS.length],
    });
    if (item.type === "folder") flatten(item.children, space, [...trail, item.label], out);
  }
}

export const SEARCH_INDEX: SearchItem[] = (() => {
  const out: SearchItem[] = [];
  flatten(PRIVATE_TREE, "Private", [], out);
  flatten(GROUPS_TREE, "Study Groups", [], out);
  // deterministic recency buckets so the grouped UI always has content
  return out.map((item, i) => ({
    ...item,
    recency: i < 5 ? "today" : i < 14 ? "past30" : "older",
  }));
})();

export const RECENCY_LABEL: Record<Recency, string> = {
  today: "Today",
  past30: "Past 30 days",
  older: "Older",
};
