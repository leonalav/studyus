import { useEffect, useRef, useState } from "react";
import {
  Copy,
  Scissors,
  Clipboard,
  Trash2,
  ChevronRight,
  Plus,
  Edit,
  Download,
  HelpCircle,
  Layers,
  Sparkles,
  BookOpen,
  MessageSquare,
  FileText,
  Eye,
  RotateCcw,
  CheckSquare,
  AlertTriangle,
  Grid,
  Pin,
  PanelTopOpen,
  History,
} from "lucide-react";

export type ContextType =
  | "chalkboard_bg"
  | "board_object"
  | "graph"
  | "curriculum_node"
  | "chat_message"
  | "assessment_item"
  | "past_note"
  | "curriculum_source"
  | "app_tab";

export interface ContextMenuTarget {
  type: ContextType;
  x: number;
  y: number;
  data?: any;
}

interface ContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onAction: (actionId: string, data?: any) => void;
}

interface MenuItem {
  id: string;
  label: string;
  icon?: any;
  shortcut?: string;
  disabled?: boolean;
  disabledReason?: string;
  children?: MenuItem[];
}

interface MenuSection {
  items: MenuItem[];
}

export function ContextMenu({ target, onClose, onAction }: ContextMenuProps) {
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [hoveredDisabled, setHoveredDisabled] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleBlur = () => onClose();

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("mousedown", handleClickOutside);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("mousedown", handleClickOutside);
      window.removeEventListener("blur", handleBlur);
    };
  }, [target, onClose]);

  if (!target) return null;

  const sections = getMenuSections(target.type, target.data);

  // Position calculation with edge flip
  const screenW = typeof window !== "undefined" ? window.innerWidth : 1000;
  const screenH = typeof window !== "undefined" ? window.innerHeight : 800;
  const menuWidth = 240;
  const menuHeight = 320;

  const left = target.x + menuWidth > screenW ? Math.max(10, target.x - menuWidth) : target.x;
  const top = target.y + menuHeight > screenH ? Math.max(10, target.y - menuHeight) : target.y;

  return (
    <div
      ref={menuRef}
      className="anim-toast fixed z-[100] w-[240px] overflow-hidden rounded-xl border border-[#3a3a3a] bg-[#1e1e20]/96 font-sans text-[12.5px] text-fg shadow-[0_20px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl select-none"
      style={{ left, top }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="p-1 space-y-1">
        {sections.map((sec, sIdx) => (
          <div key={sIdx}>
            {sIdx > 0 && <div className="my-1 border-t border-white/[0.08]" />}
            <div className="space-y-[1px]">
              {sec.items.map((item) => {
                const Icon = item.icon;
                const hasChildren = item.children && item.children.length > 0;

                return (
                  <div key={item.id} className="relative group">
                    <button
                      disabled={item.disabled}
                      onMouseEnter={() => {
                        if (hasChildren) setActiveSubmenu(item.id);
                        else setActiveSubmenu(null);
                        if (item.disabled && item.disabledReason) {
                          setHoveredDisabled(item.disabledReason);
                        } else {
                          setHoveredDisabled(null);
                        }
                      }}
                      onClick={() => {
                        if (!item.disabled && !hasChildren) {
                          onAction(item.id, target.data);
                          onClose();
                        }
                      }}
                      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
                        item.disabled
                          ? "opacity-40 cursor-not-allowed"
                          : "hover:bg-accent/20 hover:text-fg text-mut"
                      }`}
                    >
                      {Icon && <Icon size={14} className="shrink-0 text-dim group-hover:text-fg" />}
                      <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
                      {item.shortcut && (
                        <span className="ml-auto font-mono text-[10px] text-dim">{item.shortcut}</span>
                      )}
                      {hasChildren && <ChevronRight size={12} className="text-dim" />}
                    </button>

                    {/* Submenu */}
                    {hasChildren && activeSubmenu === item.id && (
                      <div className="absolute left-full top-0 ml-1 w-[200px] rounded-xl border border-[#3a3a3a] bg-[#1e1e20]/98 p-1 shadow-2xl backdrop-blur-xl space-y-[1px]">
                        {item.children!.map((sub) => {
                          const SubIcon = sub.icon;
                          return (
                            <button
                              key={sub.id}
                              onClick={() => {
                                onAction(sub.id, target.data);
                                onClose();
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-mut hover:bg-accent/20 hover:text-fg"
                            >
                              {SubIcon && <SubIcon size={13} className="shrink-0 text-dim" />}
                              <span className="truncate">{sub.label}</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {hoveredDisabled && (
        <div className="border-t border-white/[0.08] bg-black/40 px-2.5 py-1.5 font-mono text-[10px] text-[#fca5a5]">
          {hoveredDisabled}
        </div>
      )}
    </div>
  );
}

export function getMenuSections(type: ContextType, data?: any): MenuSection[] {
  switch (type) {
    case "past_note":
      return [
        {
          items: [
            { id: "delete_past_note", label: "Delete", icon: Trash2 },
            { id: "rename_past_note", label: "Rename", icon: Edit },
          ],
        },
        {
          items: [
            { id: "copy_past_note", label: "Copy", icon: Copy, shortcut: "⌘C" },
            { id: "cut_past_note", label: "Cut", icon: Scissors, shortcut: "⌘X" },
            {
              id: "paste_past_note",
              label: "Paste",
              icon: Clipboard,
              shortcut: "⌘V",
              disabled: data?.canPaste === false,
              disabledReason: data?.canPaste === false ? "Copy or cut a Past Note first" : undefined,
            },
          ],
        },
      ];

    case "curriculum_source":
      return [
        {
          items: [
            { id: "delete_curriculum", label: "Delete", icon: Trash2 },
            { id: "rename_curriculum", label: "Rename", icon: Edit },
          ],
        },
      ];

    case "app_tab":
      return [
        {
          items: [
            { id: "open_new_tab", label: "Open new tab", icon: PanelTopOpen },
            { id: "close_all_tabs", label: "Close all tabs", icon: Trash2 },
            { id: "duplicate_tab", label: "Duplicate", icon: Copy },
            { id: "pin_tab", label: data?.pinned ? "Unpin tab" : "Pin tab", icon: Pin },
            {
              id: "reopen_closed_tabs",
              label: "Reopen closed tabs",
              icon: History,
              disabled: data?.canReopen === false,
              disabledReason: data?.canReopen === false ? "No recently closed tabs" : undefined,
            },
          ],
        },
      ];

    case "chalkboard_bg":
      return [
        {
          items: [
            { id: "paste", label: "Paste", icon: Clipboard, shortcut: "⌘V" },
            { id: "select_all", label: "Select all", icon: CheckSquare, shortcut: "⌘A" },
            { id: "clear_board", label: "Clear board", icon: Trash2 },
          ],
        },
        {
          items: [
            {
              id: "insert",
              label: "Insert",
              icon: Plus,
              children: [
                { id: "insert_shape", label: "Shape (Vector/Arc/Polygon)" },
                { id: "insert_graph2d", label: "2D Function Plot" },
                { id: "insert_graph3d", label: "3D Surface" },
                { id: "insert_text", label: "Text / Math Block" },
                { id: "insert_image", label: "Image / Diagram" },
              ],
            },
            { id: "toggle_grid", label: "Toggle grid", icon: Grid },
            { id: "toggle_axes", label: "Toggle axes" },
            { id: "snap_grid", label: "Snap to grid" },
          ],
        },
        {
          items: [
            { id: "ask_tutor_board", label: "Ask tutor about this board", icon: Sparkles },
            { id: "export_board_image", label: "Export board as image", icon: Download },
          ],
        },
      ];

    case "board_object":
      return [
        {
          items: [
            { id: "cut", label: "Cut", icon: Scissors, shortcut: "⌘X" },
            { id: "copy", label: "Copy", icon: Copy, shortcut: "⌘C" },
            { id: "duplicate", label: "Duplicate", icon: Plus, shortcut: "⌘D" },
            { id: "delete", label: "Delete", icon: Trash2, shortcut: "Del" },
          ],
        },
        {
          items: [
            { id: "bring_forward", label: "Bring forward", icon: Layers },
            { id: "send_backward", label: "Send backward" },
            { id: "edit_label", label: "Edit label", icon: Edit },
            { id: "change_color", label: "Change color" },
          ],
        },
        {
          items: [
            { id: "ask_tutor_obj", label: "Ask tutor about this object", icon: Sparkles },
            { id: "convert_graph", label: "Convert to graph" },
          ],
        },
      ];

    case "graph":
      return [
        {
          items: [
            { id: "edit_function", label: "Edit function", icon: Edit },
            { id: "add_function", label: "Add function", icon: Plus },
            { id: "adjust_domain", label: "Adjust domain and range" },
            { id: "reset_view", label: "Reset view", icon: RotateCcw },
          ],
        },
        {
          items: [
            { id: "add_tangent", label: "Add tangent line" },
            { id: "add_point", label: "Add point" },
            { id: "shade_region", label: "Shade region" },
            { id: "switch_3d", label: "Switch 2D / 3D" },
          ],
        },
        {
          items: [
            { id: "export_graph_img", label: "Export as image", icon: Download },
            { id: "attach_chat", label: "Attach to chat", icon: MessageSquare },
          ],
        },
      ];

    case "curriculum_node":
      return [
        {
          items: [
            { id: "open_chalkboard", label: "Open in chalkboard", icon: BookOpen },
            { id: "add_selection", label: "Add to selection", icon: Plus },
            { id: "generate_practice", label: "Generate practice from this section", icon: Sparkles },
          ],
        },
        {
          items: [
            { id: "expand_all", label: "Expand all" },
            { id: "collapse_all", label: "Collapse all" },
            { id: "view_source_pages", label: "View source pages", icon: Eye },
            { id: "copy_reference", label: "Copy section reference", icon: Copy },
          ],
        },
      ];

    case "chat_message":
      return [
        {
          items: [
            { id: "copy_text", label: "Copy", icon: Copy, shortcut: "⌘C" },
            { id: "copy_markdown", label: "Copy as Markdown" },
            { id: "quote_reply", label: "Quote in reply", icon: MessageSquare },
            { id: "render_board", label: "Render to board", icon: FileText },
            { id: "report_unclear", label: "Report as unclear", icon: AlertTriangle },
          ],
        },
      ];

    case "assessment_item":
      return [
        {
          items: [
            { id: "view_rubric", label: "View rubric", icon: FileText },
            { id: "view_evidence", label: "View evidence source", icon: BookOpen },
            { id: "challenge_mark", label: "Challenge this mark", icon: HelpCircle },
            { id: "start_remediation", label: "Start remediation", icon: Sparkles },
            { id: "show_original", label: "Show my original answer", icon: Eye },
          ],
        },
      ];
  }
}
