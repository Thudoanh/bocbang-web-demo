import type { ButtonHTMLAttributes, ReactNode } from "react";
export function Button({ tone = "light", children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: "light" | "dark" | "danger" }) { return <button className={`btn btn-${tone}`} type="button" {...props}>{children}</button>; }
export function PageHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: ReactNode }) { return <div className="heading"><div><small>{eyebrow}</small><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="heading-actions">{actions}</div>}</div>; }
export function Loading({ label = "Đang tải dữ liệu…" }: { label?: string }) { return <div className="state">{label}</div>; }
export function Failure({ error, retry }: { error: Error; retry?: () => void }) { return <div className="state state-error"><strong>Không thể tải dữ liệu</strong><span>{error.message}</span>{retry && <Button onClick={retry}>Thử lại</Button>}</div>; }
export function Empty({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) { return <div className="state"><strong>{title}</strong><span>{detail}</span>{action}</div>; }
export function Status({ children, value }: { children: ReactNode; value?: string }) { return <span className={`status ${value ?? ""}`}>{children}</span>; }
