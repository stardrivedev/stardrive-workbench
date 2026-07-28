/**
 * Emits one structured-data block.
 *
 * The `<` escape is not decorative: JSON-LD goes into the page as raw script
 * text, so any string in the data containing `</script>` would otherwise close
 * the tag early and put attacker-controlled markup into the document. Owners
 * type their own business copy into these fields, so the data is never
 * guaranteed safe.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
