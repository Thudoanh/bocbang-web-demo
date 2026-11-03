import { createContext, useContext } from "react";

// Only header presentation moves here; workspace/controllers stay mounted in main.
export const WorkspaceHeaderContext = createContext<HTMLElement | null>(null);
export function useWorkspaceHeaderHost() { return useContext(WorkspaceHeaderContext); }
