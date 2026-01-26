export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8">School Scheduler</h1>
        <p className="text-gray-600 mb-8">
          Generate optimized K-11th grade school schedules using constraint programming.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <a
            href="/teachers"
            className="block p-6 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <h2 className="text-xl font-semibold mb-2">Teachers</h2>
            <p className="text-gray-600">Manage teacher profiles and availability</p>
          </a>

          <a
            href="/classes"
            className="block p-6 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <h2 className="text-xl font-semibold mb-2">Classes</h2>
            <p className="text-gray-600">Configure class assignments and requirements</p>
          </a>

          <a
            href="/rules"
            className="block p-6 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <h2 className="text-xl font-semibold mb-2">Rules</h2>
            <p className="text-gray-600">Set scheduling constraints and preferences</p>
          </a>

          <a
            href="/generate"
            className="block p-6 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <h2 className="text-xl font-semibold mb-2">Generate</h2>
            <p className="text-gray-600">Create optimized schedule options</p>
          </a>

          <a
            href="/history"
            className="block p-6 bg-white rounded-lg border border-gray-200 hover:bg-gray-50"
          >
            <h2 className="text-xl font-semibold mb-2">History</h2>
            <p className="text-gray-600">View and export past schedules</p>
          </a>
        </div>
      </div>
    </main>
  )
}
