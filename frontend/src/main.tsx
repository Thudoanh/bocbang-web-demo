import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AuthProvider } from "./auth/AuthContext";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><AuthProvider><App /></AuthProvider></StrictMode>,
);
