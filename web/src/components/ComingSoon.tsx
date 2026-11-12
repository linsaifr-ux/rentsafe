export function ComingSoon({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-xl font-bold text-gray-900">{title}</h1>
      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">這個功能正在準備中，很快就能用囉！</p>
    </section>
  );
}
