import { requireCtx } from "@/lib/session";
import { assertCan } from "@/lib/access";
import { getStyle } from "@/lib/services/style";
import { saveStyleAction } from "@/app/actions";
import { Flash, PageHead } from "@/components/ui";
import { StyleForm } from "@/components/StyleForm";

export default async function StylePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const ctx = await requireCtx();
  assertCan(ctx, "settings", "view");
  const sp = await searchParams;
  const s = await getStyle();
  return (
    <>
      <PageHead title="Look and night mode" sub="The company colours, logo, text size and spacing for everyone. Each person can still switch day or night mode for their own device with the ☀ / ☾ button at the top." />
      <Flash sp={sp} />
      <form action={saveStyleAction} encType="multipart/form-data">
        <StyleForm s={s} />
      </form>
    </>
  );
}
