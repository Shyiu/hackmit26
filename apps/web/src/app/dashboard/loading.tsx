export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Loading</span>
      <div className="flex flex-col gap-2 border-b border-border pb-4">
        <div className="h-8 w-48 rounded-md bg-muted" />
        <div className="h-4 w-72 max-w-full rounded-md bg-muted" />
      </div>
      <div className="flex flex-col divide-y divide-border border-y border-border">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="flex flex-col gap-2 px-2 py-4">
            <div className="h-4 w-40 rounded-md bg-muted" />
            <div className="h-3 w-64 max-w-full rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}
