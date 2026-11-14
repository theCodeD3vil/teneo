/** The history's tabs, as on desktop */
export const tabValues = ["all", "files", "image", "color", "text"] as const;
export type TabVariant = (typeof tabValues)[number];

export const emptyMessages: Record<TabVariant, string> = {
  all: "No clipboard history yet.",
  files: "No copied files yet.",
  image: "No copied images yet.",
  color: "No copied colors yet.",
  text: "No copied text yet.",
};
