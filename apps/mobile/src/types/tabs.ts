/** The history's tabs, as on desktop without Files: a file is never synced
 *  to the phone or copied on it */
export const tabValues = ["all", "image", "color", "text"] as const;
export type TabVariant = (typeof tabValues)[number];

export const emptyMessages: Record<TabVariant, string> = {
  all: "No clipboard history yet.",
  image: "No copied images yet.",
  color: "No copied colors yet.",
  text: "No copied text yet.",
};
