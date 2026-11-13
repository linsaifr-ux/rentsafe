import { Construction, House } from "lucide-react";
import { EmptyState, LinkButton, PageHeader } from "./ui.tsx";

export function ComingSoon({ title }: { title: string }) {
  return (
    <section className="animate-enter">
      <PageHeader title={title} />
      <EmptyState icon={Construction} tone="amber" title="準備中" desc="這個功能正在準備中，很快就能用囉！">
        <LinkButton href="/" variant="secondary" icon={House}>
          回首頁
        </LinkButton>
      </EmptyState>
    </section>
  );
}
