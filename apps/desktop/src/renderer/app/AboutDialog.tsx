import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw, X } from "lucide-react";
import type { AppInfo, UpdateCheckResult } from "../../shared/contracts";
import { BrandMark } from "./BrandMark";

export function AboutDialog({
  updateCheckRequestId = 0,
  onClose
}: {
  updateCheckRequestId?: number;
  onClose(): void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const handledUpdateCheckRef = useRef(0);
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult>();
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

  const checkForUpdates = useCallback(async () => {
    setCheckingForUpdates(true);
    setUpdateCheck(undefined);
    try {
      setUpdateCheck(await window.studio.checkForUpdates());
    } finally {
      setCheckingForUpdates(false);
    }
  }, []);

  useEffect(() => {
    void window.studio.getAppInfo().then(setAppInfo);
    closeButtonRef.current?.focus();

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  useEffect(() => {
    if (
      updateCheckRequestId > 0 &&
      handledUpdateCheckRef.current !== updateCheckRequestId
    ) {
      handledUpdateCheckRef.current = updateCheckRequestId;
      void checkForUpdates();
    }
  }, [checkForUpdates, updateCheckRequestId]);

  const openExternal = (url?: string) => {
    if (url) {
      void window.studio.openExternal(url);
    }
  };

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="presentation"
    >
      <section
        aria-labelledby="about-title"
        aria-modal="true"
        className="about-dialog"
        role="dialog"
      >
        <div className="about-dialog__header">
          <h2 id="about-title">About Specfold</h2>
          <button
            aria-label="Close About"
            className="icon-button"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X size={17} />
          </button>
        </div>
        <div className="about-card">
          <BrandMark />
          <div className="about-card__body">
            <div className="about-card__title">
              <strong>{appInfo?.name ?? "Specfold"}</strong>
              <span>v{appInfo?.version ?? "..."}</span>
            </div>
            <div className="about-card__meta">
              <span>{appInfo ? `${appInfo.platform} / ${appInfo.arch}` : "Loading app details..."}</span>
              <span>{appInfo?.license ?? "Apache-2.0"}</span>
            </div>
          </div>
        </div>
        <p className="about-dialog__description">
          A local-first workspace for importing, editing, testing, and exporting REST API collections.
        </p>
        <div className="settings-actions">
          <button className="secondary-button" disabled={checkingForUpdates} onClick={checkForUpdates} type="button">
            <RefreshCw size={16} />
            {checkingForUpdates ? "Checking..." : "Check for updates"}
          </button>
          <button className="secondary-button" onClick={() => openExternal(appInfo?.downloadUrl)} type="button">
            <ExternalLink size={16} />
            Download page
          </button>
          <button className="secondary-button" onClick={() => openExternal(appInfo?.releaseUrl)} type="button">
            <ExternalLink size={16} />
            Current release
          </button>
        </div>
        {updateCheck && (
          <div className={`status-box ${updateCheck.ok && updateCheck.updateAvailable ? "" : updateCheck.ok ? "status-box--success" : "status-box--error"}`}>
            {updateCheck.ok ? (
              updateCheck.updateAvailable ? (
                <>
                  <strong>v{updateCheck.latestVersion} is available.</strong>
                  <span> Current version is v{updateCheck.currentVersion}.</span>
                  <div className="settings-actions settings-actions--compact">
                    <button className="secondary-button" onClick={() => openExternal(updateCheck.releaseUrl)} type="button">
                      <ExternalLink size={16} />
                      Release notes
                    </button>
                    <button className="secondary-button" onClick={() => openExternal(appInfo?.downloadUrl)} type="button">
                      <ExternalLink size={16} />
                      Open download page
                    </button>
                  </div>
                </>
              ) : (
                <>Specfold is up to date. Latest release is v{updateCheck.latestVersion}.</>
              )
            ) : (
              <>Could not check for updates: {updateCheck.error}</>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
