export interface LegalPage {
  /** URL segment: "privacy", "terms", "cookies". */
  slug: string;
  title: string;
  /** Markdown. Rendered through the cms-core renderer, which escapes HTML. */
  body: string;
  /**
   * The gate. A page ships as an unreviewed draft and stays off the site until
   * the owner (or their solicitor) says otherwise. A generated privacy policy
   * that goes live unread is worse than having no page at all, because it
   * makes promises to visitors that nobody has checked.
   */
  reviewed?: boolean;
  /** ISO date the owner last approved it, shown to visitors. */
  updatedAt?: string;
}
