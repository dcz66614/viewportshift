// T009: the app shell re-exports the T009 local Web UI. All viewport
// logic lives in the frozen domain; src/ui/ only renders it.
export { ViewportShiftApp as App } from "./ui/App";
