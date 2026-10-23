import { createContext, useContext } from "react";

// The host element never changes when tooltips, dialogs or responsive layout change.
export const MeetingToolbarContext = createContext<HTMLElement | null>(null);
export function useRecordingToolbarHost() { return useContext(MeetingToolbarContext); }
