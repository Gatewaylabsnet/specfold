import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { buildApplicationMenuTemplate } from "./menuTemplate";

function submenu(item: MenuItemConstructorOptions): MenuItemConstructorOptions[] {
  return Array.isArray(item.submenu) ? item.submenu : [];
}

describe("application menu template", () => {
  it("adds workflow actions and Help items on Windows and Linux", () => {
    const send = vi.fn();
    const template = buildApplicationMenuTemplate(false, {
      send,
      openDocumentation: vi.fn(),
      openReleaseNotes: vi.fn()
    });

    const fileMenu = template.find((item) => item.label === "File");
    const helpMenu = template.find((item) => item.role === "help");
    expect(submenu(fileMenu!).map((item) => item.label).filter(Boolean)).toEqual([
      "Import...",
      "Export...",
      "Settings"
    ]);
    expect(submenu(helpMenu!).map((item) => item.label).filter(Boolean)).toEqual([
      "About Specfold",
      "Check for Updates...",
      "Specfold Documentation",
      "Release Notes"
    ]);

    submenu(helpMenu!).find((item) => item.label === "About Specfold")?.click?.(
      {} as never,
      undefined,
      {} as never
    );
    expect(send).toHaveBeenCalledWith("about");
  });

  it("places About in the macOS application menu", () => {
    const template = buildApplicationMenuTemplate(true, {
      send: vi.fn(),
      openDocumentation: vi.fn(),
      openReleaseNotes: vi.fn()
    });

    expect(template[0].label).toBe("Specfold");
    expect(submenu(template[0]).some((item) => item.label === "About Specfold")).toBe(true);
    const helpMenu = template.find((item) => item.role === "help");
    expect(submenu(helpMenu!).some((item) => item.label === "About Specfold")).toBe(false);
  });
});
