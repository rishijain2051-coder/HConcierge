/**
 * Every staff screen is force-dynamic, so a navigation waits on the database
 * before anything paints. Without this the app looks frozen for the round
 * trip; with it, the shape of the answer is already on screen.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6" aria-busy="true" aria-label="Loading">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div className="w-full max-w-sm">
          <div className="skeleton h-7 w-40" />
          <div className="skeleton mt-2.5 h-4 w-full max-w-xs" />
        </div>
        <div className="skeleton h-10 w-32 rounded-xl" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="bg-surface border-line space-y-3 rounded-2xl border p-4">
            <div className="skeleton h-3 w-20" />
            <div className="skeleton h-16 w-full rounded-[14px]" />
            <div className="skeleton h-16 w-full rounded-[14px]" />
            <div className="skeleton h-16 w-full rounded-[14px]" />
          </div>
        ))}
      </div>
    </div>
  )
}
