import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { AuthProvider } from "./auth/AuthContext";
import { ThemeProvider } from "./theme/ThemeContext";
import "./app/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><ThemeProvider><AuthProvider><App /></AuthProvider></ThemeProvider></StrictMode>,
);
