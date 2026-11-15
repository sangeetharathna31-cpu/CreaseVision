import type { HistoryEntry } from "../lib/storage";
import { fullTime, pct, timeAgo } from "../lib/format";
import { Avatar } from "./Avatar";
import { Icon } from "./Icon";

export function ActivityList({
  entries,
  start = 0,
  onOpen,
  empty,
}: {
  entries: HistoryEntry[];
  start?: number;
  onOpen: (title: string) => void;
  empty: string;
}) {
  if (!entries.length) return <div className="empty-note">{empty}</div>;
  return (
    <div className="activity-list">
      {entries.map((e, i) => (
        <div className="activity-row" key={e.id} data-known={e.known}>
          <div className="activity-num">{String(start + i + 1).padStart(2, "0")}</div>
          <Avatar title={e.known ? e.title : null} name={e.name} />
          <div className="activity-person">
            <b>{e.known ? e.name : `Unknown (closest: ${e.name})`}</b>
            <span>
              distance {e.dist.toFixed(4)} · limit {e.limit.toFixed(2)}
              {e.faces > 1 ? ` · face ${e.face} of ${e.faces}` : ""}
            </span>
          </div>
          <div className="activity-source">
            <Icon name={e.source === "camera" ? "video" : "image"} size={15} />
            <span>{e.source === "camera" ? "Live camera" : "Uploaded image"}</span>
          </div>
          <div className="activity-time" title={fullTime(e.ts)}>
            {timeAgo(e.ts)}
          </div>
          <div className="activity-score">
            <span>{pct(e.confidence)}%</span>
            <small className={e.known ? "" : "unk"}>{e.known ? "VERIFIED" : "NO MATCH"}</small>
          </div>
          <button aria-label={`Open ${e.name} record`} disabled={!e.known} onClick={() => onOpen(e.title)} title={e.known ? "Open career record" : "No verified match"}>
            <Icon name="chevron" size={15} />
          </button>
        </div>
      ))}
    </div>
  );
}
