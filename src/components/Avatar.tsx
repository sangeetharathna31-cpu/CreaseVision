import { useEffect, useState } from "react";
import { getRole, getSummary, type WikiSummary } from "../lib/wikipedia";
import { initials } from "../lib/format";

/** Wikipedia summary (portrait, description) for a gallery/record title; null until/unless available. */
export function useSummary(title: string | null | undefined) {
  const [s, setS] = useState<WikiSummary | null>(null);
  useEffect(() => {
    let live = true;
    setS(null);
    if (title) getSummary(title).then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, [title]);
  return s;
}
export function useRole(title: string | null | undefined) {
  const [r, setR] = useState("");
  useEffect(() => {
    let live = true;
    setR("");
    if (title) getRole(title).then((v) => live && setR(v));
    return () => {
      live = false;
    };
  }, [title]);
  return r;
}

/** Square-ish avatar: Wikipedia portrait when online, monogram otherwise. Renders a direct <img> or <span class="mono"> so the
 *  existing list styles (activity rows / candidates) apply unchanged. */
export function Avatar({ title, name, className = "" }: { title?: string | null; name: string; className?: string }) {
  const s = useSummary(title);
  return s?.thumbnail ? (
    <img src={s.thumbnail.source} alt="" className={className} />
  ) : (
    <span className={`mono ${className}`} aria-hidden="true">
      {title ? initials(name) : "?"}
    </span>
  );
}
