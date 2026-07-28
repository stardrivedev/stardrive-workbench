import type { Metadata } from "next";
import { getMenus } from "@/modules/menu/data";
import { MenuBlock } from "@/modules/menu/Menu";
import PageHeader from "@/components/ui/PageHeader";
import JsonLd from "@/components/seo/JsonLd";
import type { Menu } from "@/modules/menu/types";

export const metadata: Metadata = { title: "Menu" };
export const dynamic = "force-dynamic";

function menuJsonLd(menu: Menu): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "Menu",
    name: menu.name,
    ...(menu.description ? { description: menu.description } : {}),
    hasMenuSection: menu.courses.map((course) => ({
      "@type": "MenuSection",
      name: course.name,
      ...(course.description ? { description: course.description } : {}),
      hasMenuItem: course.dishes
        .filter((d) => !d.unavailable)
        .map((dish) => ({
          "@type": "MenuItem",
          name: dish.name,
          ...(dish.description ? { description: dish.description } : {}),
          // Prices stay display text (they can read "9 / 14"), so they are not
          // forced into a numeric offer that would misstate them.
          ...(dish.price ? { offers: { "@type": "Offer", price: dish.price } } : {}),
        })),
    })),
  };
}

export default async function MenuPage() {
  const menus = await getMenus();

  return (
    <>
      <PageHeader eyebrow="Menu" title="Menu" subtitle="What we are serving." slot="hero-menu" />
      {menus.map((m) => (
        <JsonLd key={m.id} data={menuJsonLd(m)} />
      ))}
      <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        {menus.length === 0 ? (
          <div className="rounded-md border border-heading/10 bg-surface px-6 py-8 text-sm text-muted">
            The menu is on its way.
          </div>
        ) : (
          <div className="space-y-16">
            {menus.map((m) => (
              <MenuBlock key={m.id} menu={m} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}
