import type { ChangeReport } from '../types.js';

interface ChangeReportViewProps {
  report: ChangeReport | null;
}

export function ChangeReportView({ report }: ChangeReportViewProps) {
  if (!report) {
    return <div className="alpha-empty">No snapshot selected for change comparison.</div>;
  }

  const breakingItems = report.items.filter((item) => item.breaking);
  const nonBreakingItems = report.items.filter((item) => !item.breaking);

  return (
    <div className="alpha-changes">
      <section className="alpha-change-summary">
        <div className="alpha-change-card">
          <div className="alpha-change-label">Snapshot</div>
          <div className="alpha-change-value">{report.snapshotName}</div>
          <div className="alpha-change-subtle">{report.createdAt}</div>
        </div>
        <div className="alpha-change-card">
          <div className="alpha-change-label">Breaking</div>
          <div className="alpha-change-value">{report.breakingCount}</div>
          <div className="alpha-change-subtle">Requires attention</div>
        </div>
        <div className="alpha-change-card">
          <div className="alpha-change-label">Total Changes</div>
          <div className="alpha-change-value">{report.items.length}</div>
          <div className="alpha-change-subtle">Request + response combined</div>
        </div>
      </section>

      <section className="alpha-change-section">
        <div className="alpha-inline-heading">
          <strong>Breaking Changes</strong>
          <span className="alpha-meta">{breakingItems.length} items</span>
        </div>
        {breakingItems.length === 0 ? (
          <div className="alpha-empty">No breaking changes detected.</div>
        ) : (
          <div className="alpha-change-list">
            {breakingItems.map((item, index) => (
              <article key={`breaking-${item.path}-${index}`} className="alpha-change-row alpha-change-row-breaking">
                <div className="alpha-change-row-meta">
                  <span className="alpha-badge alpha-badge-danger">{item.scope}</span>
                  <span className="alpha-badge">{item.type}</span>
                  <code>{item.path}</code>
                </div>
                <div className="alpha-change-row-values">
                  <span>Before: {item.before ?? '-'}</span>
                  <span>After: {item.after ?? '-'}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="alpha-change-section">
        <div className="alpha-inline-heading">
          <strong>All Changes</strong>
          <span className="alpha-meta">{nonBreakingItems.length} non-breaking</span>
        </div>
        <div className="alpha-change-table-wrap">
          <table className="alpha-change-table">
            <thead>
              <tr>
                <th>Scope</th>
                <th>Path</th>
                <th>Type</th>
                <th>Before</th>
                <th>After</th>
                <th>Breaking</th>
              </tr>
            </thead>
            <tbody>
              {report.items.map((item, index) => (
                <tr key={`${item.path}-${item.type}-${index}`}>
                  <td>{item.scope}</td>
                  <td><code>{item.path}</code></td>
                  <td>{item.type}</td>
                  <td>{item.before ?? '-'}</td>
                  <td>{item.after ?? '-'}</td>
                  <td>{item.breaking ? 'YES' : 'NO'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
