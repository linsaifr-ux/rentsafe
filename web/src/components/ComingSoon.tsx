import { LinkButton } from "./ui.tsx";

export function ComingSoon({ title }: { title: string }) {
  return (
    <section>
      <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
      <div className="mt-4 rounded-2xl bg-white p-5 text-center shadow-sm">
        <p className="text-4xl" aria-hidden="true">
          🚧
        </p>
        <p className="mt-2 text-gray-600">這個功能正在準備中，很快就能用囉！</p>
        <LinkButton href="/" variant="secondary" className="mt-4">
          回首頁
        </LinkButton>
      </div>
    </section>
  );
}
