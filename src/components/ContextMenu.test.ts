import { describe, expect, it } from "vitest";
import { getMenuSections } from "./ContextMenu";

function actionIds(type: Parameters<typeof getMenuSections>[0], data?: unknown): string[] {
  return getMenuSections(type, data).flatMap((section) => section.items.map((item) => item.id));
}

describe("resource and application context menus", () => {
  it("offers the complete Past Note mutation and clipboard actions", () => {
    expect(actionIds("past_note", { canPaste: true })).toEqual([
      "delete_past_note",
      "rename_past_note",
      "copy_past_note",
      "cut_past_note",
      "paste_past_note",
    ]);
    const paste = getMenuSections("past_note", { canPaste: false })[1].items[2];
    expect(paste.disabled).toBe(true);
  });

  it("limits curriculum sources to rename and delete without clipboard actions", () => {
    expect(actionIds("curriculum_source")).toEqual([
      "delete_curriculum",
      "rename_curriculum",
    ]);
  });

  it("offers tab lifecycle actions and reflects pin/history state", () => {
    expect(actionIds("app_tab", { pinned: false, canReopen: true })).toEqual([
      "open_new_tab",
      "close_all_tabs",
      "duplicate_tab",
      "pin_tab",
      "reopen_closed_tabs",
    ]);
    expect(getMenuSections("app_tab", { pinned: true, canReopen: false })[0].items)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "pin_tab", label: "Unpin tab" }),
        expect.objectContaining({ id: "reopen_closed_tabs", disabled: true }),
      ]));
  });
});
