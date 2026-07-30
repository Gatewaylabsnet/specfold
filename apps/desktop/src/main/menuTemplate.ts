import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuAction } from "../shared/contracts";

interface ApplicationMenuActions {
  send(action: AppMenuAction): void;
  openDocumentation(): void;
  openReleaseNotes(): void;
}

export function buildApplicationMenuTemplate(
  isMac: boolean,
  actions: ApplicationMenuActions
): MenuItemConstructorOptions[] {
  const aboutItem: MenuItemConstructorOptions = {
    label: "About Specfold",
    click: () => actions.send("about")
  };

  return [
    ...(isMac
      ? [{
          label: "Specfold",
          submenu: [
            aboutItem,
            { type: "separator" as const },
            { role: "services" as const },
            { type: "separator" as const },
            { role: "hide" as const },
            { role: "hideOthers" as const },
            { role: "unhide" as const },
            { type: "separator" as const },
            { role: "quit" as const }
          ]
        }]
      : []),
    {
      label: "File",
      submenu: [
        {
          label: "Import...",
          accelerator: "CmdOrCtrl+O",
          click: () => actions.send("import")
        },
        {
          label: "Export...",
          accelerator: "CmdOrCtrl+Shift+E",
          click: () => actions.send("export")
        },
        {
          label: "Settings",
          accelerator: "CmdOrCtrl+,",
          click: () => actions.send("settings")
        },
        { type: "separator" },
        { role: isMac ? "close" : "quit" }
      ]
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" }
      ]
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(!isMac ? [aboutItem] : []),
        {
          label: "Check for Updates...",
          click: () => actions.send("check-for-updates")
        },
        { type: "separator" },
        {
          label: "Specfold Documentation",
          click: actions.openDocumentation
        },
        {
          label: "Release Notes",
          click: actions.openReleaseNotes
        }
      ]
    }
  ];
}
