"use client";

import { useEffect, useState } from "react";
import ImageDropzone from "@/components/cms/ImageDropzone";
import { getPaymentItemsAction, savePaymentItemsAction } from "../actions";
import { isStripeHost, safePaymentUrl } from "../types";
import type { PaymentItem } from "../types";

const inputClass =
  "w-full rounded-md border border-heading/15 bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function emptyItem(): PaymentItem {
  return { id: `pay-${Date.now().toString(36)}`, name: "", url: "" };
}

export default function PaymentsEditor() {
  const [items, setItems] = useState<PaymentItem[]>([]);
  const [editing, setEditing] = useState<PaymentItem | null>(null);
  const [status, setStatus] = useState("");

  useEffect(() => {
    getPaymentItemsAction().then((res) => {
      if (res.error) setStatus(res.error);
      else setItems(res.items);
    });
  }, []);

  async function persist(next: PaymentItem[]) {
    setItems(next);
    setStatus("Saving…");
    const res = await savePaymentItemsAction(next);
    setStatus(res.success ? "Saved." : res.error ?? "Save failed.");
  }

  function submitEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const data = new FormData(e.currentTarget);
    const url = String(data.get("url") ?? "").trim();
    const updated: PaymentItem = {
      ...editing,
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim() || undefined,
      price: String(data.get("price") ?? "").trim() || undefined,
      url,
      hidden: data.get("hidden") === "on",
    };
    if (!updated.name) {
      setStatus("This item needs a name.");
      return;
    }
    if (!safePaymentUrl(url)) {
      setStatus("The payment link must be a full https address, copied from Stripe.");
      return;
    }
    const exists = items.some((i) => i.id === updated.id);
    persist(exists ? items.map((i) => (i.id === updated.id ? updated : i)) : [...items, updated]);
    setEditing(null);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Payments</h2>
        <button
          type="button"
          onClick={() => setEditing(emptyItem())}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong"
        >
          Add item
        </button>
      </div>

      {status && <p className="text-sm text-muted">{status}</p>}

      <div className="rounded-md border border-heading/10 bg-surface p-4 text-sm text-muted">
        <p className="font-medium text-body">How this works</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>In your own Stripe dashboard, create a Payment Link for the thing you are selling.</li>
          <li>Copy the link Stripe gives you and paste it below.</li>
          <li>Customers pay on Stripe&rsquo;s page, and the money arrives in your Stripe account.</li>
        </ol>
        <p className="mt-2">
          The price customers are charged is the one set in Stripe. The price typed here is display
          text only, so keep the two in step.
        </p>
      </div>

      {editing && (
        <form onSubmit={submitEdit} className="space-y-4 rounded-lg border border-heading/15 bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="name">Item name</label>
              <input id="name" name="name" defaultValue={editing.name} className={inputClass} required />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium" htmlFor="price">Price as shown (optional)</label>
              <input id="price" name="price" defaultValue={editing.price ?? ""} placeholder="£40" className={inputClass} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="url">Stripe Payment Link</label>
            <input id="url" name="url" type="url" defaultValue={editing.url} placeholder="https://buy.stripe.com/..." className={inputClass} required />
            {editing.url && safePaymentUrl(editing.url) && !isStripeHost(editing.url) ? (
              <p className="mt-1 text-xs">
                This is not one of Stripe&rsquo;s own addresses. That is fine if you use a custom
                checkout domain, but worth checking.
              </p>
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium" htmlFor="description">Description (optional)</label>
            <textarea id="description" name="description" rows={3} defaultValue={editing.description ?? ""} className={inputClass} />
          </div>

          <div>
            <span className="mb-1 block text-sm font-medium">Image (optional)</span>
            {editing.image ? (
              <div className="mb-2 flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={editing.image} alt="" className="h-16 w-24 rounded object-cover" />
                <button type="button" onClick={() => setEditing({ ...editing, image: undefined })} className="text-sm text-muted underline">Remove</button>
              </div>
            ) : null}
            <ImageDropzone onUploaded={(url) => setEditing({ ...editing, image: url })} label="Add a photo" />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="hidden" defaultChecked={editing.hidden} />
            Hide from the payments page
          </label>

          <div className="flex gap-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong">Save item</button>
            <button type="button" onClick={() => setEditing(null)} className="rounded-md border border-heading/15 px-4 py-2 text-sm">Cancel</button>
          </div>
        </form>
      )}

      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing set up yet. Add the first item above.</p>
      ) : (
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-4 rounded-lg border border-heading/10 bg-surface p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {i.name}
                  {i.price ? <span className="ml-2 font-normal text-muted">{i.price}</span> : null}
                  {i.hidden ? <span className="ml-2 text-xs font-normal text-muted">hidden</span> : null}
                </p>
                <p className="truncate text-xs text-muted">{i.url}</p>
                <p className="mt-1 text-xs text-muted">Embed anywhere with: &lt;PayButton itemId=&quot;{i.id}&quot; /&gt;</p>
              </div>
              <div className="flex shrink-0 gap-3 text-sm">
                <button type="button" onClick={() => setEditing(i)} className="underline">Edit</button>
                <button type="button" onClick={() => persist(items.filter((x) => x.id !== i.id))} className="text-muted underline">Delete</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
