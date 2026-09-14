/** The room screen, in outline, while the stay is resolved. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-2xl px-4 pt-7" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-8 w-56" />

      <div className="mt-8 space-y-3">
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-3 px-4 py-4">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-3 w-24" />
            <div className="skeleton h-2 w-full rounded-full" />
          </div>
        ))}
      </div>

      <div className="mt-8 grid grid-cols-2 gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-[74px] rounded-[18px]" />
        ))}
      </div>
    </div>
  )
}
