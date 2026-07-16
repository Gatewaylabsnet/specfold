import type { StudioApi } from "../shared/contracts";

declare global {
  interface Window {
    studio: StudioApi;
  }
}
