import { useTheme } from "../theme/ThemeContext";
import { Icon } from "./ui";

export function ThemeToggle({ className = "", showLabel = false }: { className?: string; showLabel?: boolean }) {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === "dark" ? "sáng" : "tối";
  return <button className={`theme-toggle ${showLabel ? "theme-toggle-labeled" : ""} ${className}`} type="button" onClick={toggleTheme} aria-label={`Chuyển sang chế độ ${nextTheme}`} title={`Chuyển sang chế độ ${nextTheme}`} aria-pressed={theme === "dark"}>
    <Icon name={theme === "dark" ? "sun" : "moon"} />
    {showLabel && <span>Chuyển sang chế độ {nextTheme}</span>}
  </button>;
}
